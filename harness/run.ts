import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { costNdollars, formatUsd, isOverCap } from "#harness/budget.ts";
import type { Usage } from "#harness/budget.ts";
import { budgetRatesFor, parseCatalog } from "#harness/catalog.ts";
import type { Catalog } from "#harness/catalog.ts";
import { evaluateChecks, parseReport } from "#harness/report.ts";
import type { RunReport } from "#harness/report.ts";

export type ExampleStatus = "passed" | "failed" | "skipped";

export interface ExampleResult {
  slug: string;
  status: ExampleStatus;
  costNdollars: bigint;
  errors: string[];
  usage: Usage[];
}

export interface RunSummary {
  ok: boolean;
  results: ExampleResult[];
  totalNdollars: bigint;
  capNdollars: bigint;
}

export interface RunOptions {
  repoRoot: string;
  slugs: string[];
  capNdollars: bigint;
  timeoutMs: number;
  env: Record<string, string | undefined>;
  log: (line: string) => void;
}

type TokenTotals = Omit<Usage, "model">;

export type Status = Record<string, { verifiedAt: string; usage: Record<string, TokenTotals> }>;

const STDERR_TAIL_LINES = 20;
const QUIET_ENV = { PYDANTIC_AI_NO_BANNER: "1" };

interface Exit {
  code: number | null;
  timedOut: boolean;
  stderrTail: string[];
}

function commandFor(dir: string): [string, string[]] | null {
  if (existsSync(join(dir, "package.json"))) {
    return [process.execPath, ["main.ts"]];
  }
  if (existsSync(join(dir, "pyproject.toml"))) {
    return ["uv", ["run", "--locked", "python", "main.py"]];
  }
  return null;
}

function execute(
  slug: string,
  dir: string,
  command: [string, string[]],
  env: RunOptions["env"],
  options: RunOptions,
) {
  return new Promise<Exit>((resolve) => {
    const [program, args] = command;
    const child = spawn(program, args, { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
    const stderrTail: string[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);
    const emit = (line: string, keep: boolean): void => {
      options.log(`[${slug}] ${line}`);
      if (keep) {
        stderrTail.push(line);
        stderrTail.splice(0, Math.max(0, stderrTail.length - STDERR_TAIL_LINES));
      }
    };
    // Streamed output arrives in fragments; log whole lines so CI output reads like the terminal.
    const partial = { stdout: "", stderr: "" };
    const forward = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
      const lines = (partial[stream] + chunk.toString()).split("\n");
      partial[stream] = lines.pop() ?? "";
      for (const line of lines.filter((text) => text !== "")) {
        emit(line, stream === "stderr");
      }
    };
    child.stdout.on("data", forward("stdout"));
    child.stderr.on("data", forward("stderr"));
    child.on("error", (error) => {
      stderrTail.push(`cannot start ${program}: ${error.message}`);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      for (const stream of ["stdout", "stderr"] as const) {
        if (partial[stream] !== "") {
          emit(partial[stream], stream === "stderr");
        }
      }
      resolve({ code, timedOut, stderrTail });
    });
  });
}

function readReport(path: string): RunReport {
  return parseReport(existsSync(path) ? readFileSync(path, "utf8") : "");
}

function price(
  catalog: Catalog,
  report: RunReport,
  errors: string[],
): { cost: bigint; priced: boolean } {
  let cost = 0n;
  let priced = report.problems.length === 0;
  errors.push(...report.problems);
  for (const usage of report.usage) {
    try {
      cost += costNdollars(usage, budgetRatesFor(catalog, usage.model));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      priced = false;
    }
  }
  return { cost, priced };
}

function checkOutcome(dir: string, exit: Exit, report: RunReport, options: RunOptions): string[] {
  if (exit.timedOut) {
    return [`timed out after ${options.timeoutMs} ms`];
  }
  if (exit.code !== 0) {
    return [`exited with code ${String(exit.code)}`, ...exit.stderrTail];
  }
  if (report.usage.length === 0) {
    return ["example made no metered API calls"];
  }
  const checksPath = join(dir, "checks.json");
  try {
    return evaluateChecks(JSON.parse(readFileSync(checksPath, "utf8")), report.facts);
  } catch (error) {
    return [`${checksPath}: ${error instanceof Error ? error.message : String(error)}`];
  }
}

async function runOne(slug: string, catalog: Catalog, options: RunOptions) {
  const dir = join(options.repoRoot, "examples", slug);
  const command = existsSync(dir) ? commandFor(dir) : null;
  if (command === null) {
    const errors = [
      `no runnable example at examples/${slug} (needs package.json or pyproject.toml)`,
    ];
    const result = { slug, status: "failed" as const, costNdollars: 0n, errors, usage: [] };
    return { result, priced: true };
  }
  const reportPath = join(mkdtempSync(join(tmpdir(), `saygm-${slug}-`)), "report.ndjson");
  const exit = await execute(
    slug,
    dir,
    command,
    { ...options.env, ...QUIET_ENV, SAYGM_REPORT_FILE: reportPath },
    options,
  );
  const errors: string[] = [];
  const report = readReport(reportPath);
  const { cost, priced } = price(catalog, report, errors);
  errors.push(...checkOutcome(dir, exit, report, options));
  const status: ExampleStatus = errors.length === 0 ? "passed" : "failed";
  return { result: { slug, status, costNdollars: cost, errors, usage: report.usage }, priced };
}

export async function runExamples(options: RunOptions): Promise<RunSummary> {
  const catalog = parseCatalog(
    JSON.parse(readFileSync(join(options.repoRoot, "catalog.json"), "utf8")),
  );
  const results: ExampleResult[] = [];
  let total = 0n;
  let stopped = false;
  for (const slug of options.slugs) {
    if (stopped) {
      results.push({
        slug,
        status: "skipped",
        usage: [],
        costNdollars: 0n,
        errors: ["skipped: the run already stopped"],
      });
      continue;
    }
    // Examples run one at a time so the cap is checked before the next one spends anything.
    // oxlint-disable-next-line no-await-in-loop
    const { result, priced } = await runOne(slug, catalog, options);
    total += result.costNdollars;
    if (isOverCap(total, options.capNdollars)) {
      result.status = "failed";
      result.errors.push(
        `run spend ${formatUsd(total)} is over the ${formatUsd(options.capNdollars)} cap after this example`,
      );
    }
    stopped = !priced || isOverCap(total, options.capNdollars);
    results.push(result);
  }
  const ok = results.every((result) => result.status === "passed");
  return { ok, results, totalNdollars: total, capNdollars: options.capNdollars };
}

/** Names the SAYGM_MODEL_<ROLE> overrides in effect; a run with any cannot vouch for the snippets. */
export function modelOverrides(env: RunOptions["env"]): string[] {
  return Object.keys(env)
    .filter((name) => name.startsWith("SAYGM_MODEL_") && Boolean(env[name]))
    .toSorted();
}

function totalsByModel(usage: Usage[]): Record<string, TokenTotals> {
  const totals: Record<string, TokenTotals> = {};
  for (const { model, ...tokens } of usage) {
    const sum = totals[model] ?? {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };
    sum.input_tokens += tokens.input_tokens;
    sum.output_tokens += tokens.output_tokens;
    sum.cache_read_input_tokens += tokens.cache_read_input_tokens;
    sum.cache_creation_input_tokens += tokens.cache_creation_input_tokens;
    totals[model] = sum;
  }
  return Object.fromEntries(Object.entries(totals).toSorted(([a], [b]) => (a < b ? -1 : 1)));
}

/** Records today and the token usage by model for passed examples; others keep their last entry. */
export function updateStatus(previous: Status, results: ExampleResult[], now: Date): Status {
  const today = now.toISOString().slice(0, 10);
  const next: Status = { ...previous };
  for (const result of results) {
    if (result.status === "passed") {
      next[result.slug] = { verifiedAt: today, usage: totalsByModel(result.usage) };
    }
  }
  return Object.fromEntries(Object.entries(next).toSorted(([a], [b]) => (a < b ? -1 : 1)));
}
