import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { modelOverrides, runExamples, updateStatus } from "#harness/run.ts";

const oneNdollarPerToken = {
  input: 1_000_000,
  output: 1_000_000,
  cache_read: 1_000_000,
  cache_write: 1_000_000,
};

interface FakeExample {
  body: string;
  checks?: unknown;
}

const repoWith = (examples: Record<string, FakeExample>): string => {
  const root = mkdtempSync(join(tmpdir(), "examples-repo-"));
  writeFileSync(
    join(root, "catalog.json"),
    JSON.stringify({
      base_urls: { openai: "https://api.saygm.com/v1" },
      roles: {},
      models: {
        m: {
          api_shapes: ["chat.completions"],
          available: true,
          tools: true,
          pricing: {},
          budget_rates: oneNdollarPerToken,
        },
      },
    }),
  );
  for (const [slug, example] of Object.entries(examples)) {
    const dir = join(root, "examples", slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: slug, type: "module" }));
    writeFileSync(
      join(dir, "main.ts"),
      [
        'import { appendFileSync } from "node:fs";',
        "const out = (record: unknown): void => appendFileSync(process.env.SAYGM_REPORT_FILE!, JSON.stringify(record) + '\\n');",
        "let nextId = 0;",
        example.body,
      ].join("\n"),
    );
    if (example.checks !== undefined) {
      writeFileSync(join(dir, "checks.json"), JSON.stringify(example.checks));
    }
  }
  return root;
};

const request = (model = "m"): string =>
  `nextId += 1; out({ kind: "request", id: nextId, model: "${model}", path: "/v1/responses" });`;
const usage = (tokens: number, model = "m"): string =>
  `${request(model)} out({ kind: "usage", id: nextId, model: "${model}", input_tokens: ${tokens}, output_tokens: 0 });`;
const fact = (name: string, value: unknown): string =>
  `out({ kind: "fact", name: "${name}", value: ${JSON.stringify(value)} });`;
const okChecks = { facts: { done: { equals: true } } };
const passing = (tokens: number): FakeExample => ({
  body: `${usage(tokens)}\n${fact("done", true)}`,
  checks: okChecks,
});

const run = (root: string, slugs: string[], capNdollars = 1_000n, timeoutMs = 20_000) =>
  runExamples({
    repoRoot: root,
    slugs,
    capNdollars,
    timeoutMs,
    env: { PATH: process.env["PATH"] ?? "" },
    log: () => {},
  });

describe("runExamples", () => {
  it("passes an example that reports usage and meets its checks", async () => {
    const summary = await run(repoWith({ a: passing(40) }), ["a"]);
    expect(summary.ok).toBe(true);
    expect(summary.results).toEqual([
      { slug: "a", status: "passed", costNdollars: 40n, errors: [] },
    ]);
    expect(summary.totalNdollars).toBe(40n);
  });

  it("passes when spend lands exactly on the cap", async () => {
    const summary = await run(
      repoWith({ a: passing(600_000), b: passing(400_000) }),
      ["a", "b"],
      1_000_000n,
    );
    expect(summary.ok).toBe(true);
    expect(summary.totalNdollars).toBe(1_000_000n);
  });

  it("fails the run one nano-dollar past the cap and skips what is left", async () => {
    const summary = await run(
      repoWith({ a: passing(600_000), b: passing(400_001), c: passing(1) }),
      ["a", "b", "c"],
      1_000_000n,
    );
    expect(summary.ok).toBe(false);
    expect(summary.results.map((r) => r.status)).toEqual(["passed", "failed", "skipped"]);
    expect(summary.results[1]?.errors).toEqual([
      "run spend $0.001001 is over the $0.001000 cap after this example",
    ]);
  });

  it("fails an example that exits non-zero and keeps its stderr", async () => {
    const summary = await run(
      repoWith({ a: { body: 'console.error("boom"); process.exit(3);', checks: okChecks } }),
      ["a"],
    );
    expect(summary.ok).toBe(false);
    expect(summary.results[0]?.errors.join("\n")).toMatch(/exited with code 3[\s\S]*boom/);
  });

  it("still counts the spend of an example that fails after calling the API", async () => {
    const summary = await run(
      repoWith({ a: { body: `${usage(30)}\nprocess.exit(1);`, checks: okChecks } }),
      ["a"],
    );
    expect(summary.results[0]?.costNdollars).toBe(30n);
    expect(summary.totalNdollars).toBe(30n);
  });

  it("stops the run when an example's spend is unknown", async () => {
    const summary = await run(
      repoWith({ a: { body: `${request()}\nprocess.exit(1);`, checks: okChecks }, b: passing(1) }),
      ["a", "b"],
    );
    expect(summary.results.map((r) => r.status)).toEqual(["failed", "skipped"]);
    expect(summary.results[0]?.errors).toContain(
      'request 1 to "m" has no usage, so its cost is unknown',
    );
  });

  it("keeps counting valid usage when the report has a malformed line", async () => {
    const body = `${usage(700)}\nappendFileSync(process.env.SAYGM_REPORT_FILE!, "nope\\n");\n${fact("done", true)}`;
    const summary = await run(repoWith({ a: { body, checks: okChecks }, b: passing(1) }), [
      "a",
      "b",
    ]);
    expect(summary.results[0]?.costNdollars).toBe(700n);
    expect(summary.results.map((r) => r.status)).toEqual(["failed", "skipped"]);
  });

  it("fails an example that reports no usage", async () => {
    const summary = await run(repoWith({ a: { body: fact("done", true), checks: okChecks } }), [
      "a",
    ]);
    expect(summary.results[0]?.errors).toContain("example made no metered API calls");
  });

  it("fails an example whose checks do not hold", async () => {
    const summary = await run(
      repoWith({ a: { body: `${usage(1)}\n${fact("done", false)}`, checks: okChecks } }),
      ["a"],
    );
    expect(summary.results[0]?.errors).toEqual(["fact done = false, expected true"]);
  });

  it("fails an example without checks.json", async () => {
    const summary = await run(repoWith({ a: { body: usage(1) } }), ["a"]);
    expect(summary.results[0]?.errors.join()).toMatch(/checks\.json/);
  });

  it("fails an example that uses a model the catalog cannot price", async () => {
    const summary = await run(
      repoWith({ a: { body: `${usage(1, "unknown")}\n${fact("done", true)}`, checks: okChecks } }),
      ["a"],
    );
    expect(summary.results[0]?.errors.join()).toMatch(/model "unknown" is not in catalog\.json/);
    expect(summary.ok).toBe(false);
  });

  it("kills an example that runs past the timeout", async () => {
    const summary = await run(
      repoWith({ a: { body: "setTimeout(() => {}, 60_000);", checks: okChecks } }),
      ["a"],
      1_000n,
      500,
    );
    expect(summary.results[0]?.errors.join()).toMatch(/timed out after 500 ms/);
  });

  it("fails for an unknown slug", async () => {
    const summary = await run(repoWith({}), ["missing"]);
    expect(summary.results[0]?.errors.join()).toMatch(/examples\/missing/);
  });
});

describe("updateStatus", () => {
  it("records today for passed examples and keeps earlier dates for the rest", () => {
    const previous = { a: { verifiedAt: "2026-09-01" }, b: { verifiedAt: "2026-09-01" } };
    const results = [
      { slug: "a", status: "passed" as const, costNdollars: 0n, errors: [] },
      { slug: "b", status: "failed" as const, costNdollars: 0n, errors: ["x"] },
      { slug: "c", status: "passed" as const, costNdollars: 0n, errors: [] },
    ];
    expect(updateStatus(previous, results, new Date("2026-09-26T12:00:00Z"))).toEqual({
      a: { verifiedAt: "2026-09-26" },
      b: { verifiedAt: "2026-09-01" },
      c: { verifiedAt: "2026-09-26" },
    });
  });

  it("sorts slugs so the file diffs cleanly", () => {
    const results = [
      { slug: "b", status: "passed" as const, costNdollars: 0n, errors: [] },
      { slug: "a", status: "passed" as const, costNdollars: 0n, errors: [] },
    ];
    expect(Object.keys(updateStatus({}, results, new Date("2026-09-26T00:00:00Z")))).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("modelOverrides", () => {
  it("lists the SAYGM_MODEL_ overrides that are set", () => {
    const env = { SAYGM_MODEL_CLAUDE: "claude-sonnet-5", SAYGM_MODEL_CHAT_CHEAP: "", PATH: "/bin" };
    expect(modelOverrides(env)).toEqual(["SAYGM_MODEL_CLAUDE"]);
    expect(modelOverrides({ PATH: "/bin" })).toEqual([]);
  });
});
