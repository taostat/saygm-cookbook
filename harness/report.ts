import type { Usage } from "#harness/budget.ts";

export interface RunReport {
  usage: Usage[];
  facts: Record<string, unknown>;
  problems: string[];
}

type Json = Record<string, unknown>;

const TOKEN_FIELDS = [
  "input_tokens",
  "output_tokens",
  "cache_read_input_tokens",
  "cache_creation_input_tokens",
] as const;

function parseUsage(record: Json, model: string, where: string): Usage {
  const counts: Record<string, number> = {};
  for (const field of TOKEN_FIELDS) {
    const value = record[field] ?? (field.startsWith("cache_") ? 0 : undefined);
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
      throw new Error(
        `${where}: usage ${field} must be a non-negative integer (got ${JSON.stringify(value)})`,
      );
    }
    counts[field] = value;
  }
  return {
    model,
    input_tokens: counts["input_tokens"] ?? 0,
    output_tokens: counts["output_tokens"] ?? 0,
    cache_read_input_tokens: counts["cache_read_input_tokens"] ?? 0,
    cache_creation_input_tokens: counts["cache_creation_input_tokens"] ?? 0,
  };
}

interface Call {
  model: string;
  resolved: boolean;
}

class ReportReader {
  readonly report: RunReport = { usage: [], facts: {}, problems: [] };
  private readonly calls = new Map<number, Call>();

  read(record: Json, where: string): void {
    const kind = record["kind"];
    if (kind === "fact") {
      this.fact(record, where);
      return;
    }
    if (kind !== "request" && kind !== "usage" && kind !== "no_charge" && kind !== "unmetered") {
      throw new Error(`${where}: unknown kind ${JSON.stringify(kind)}`);
    }
    const id = record["id"];
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
      throw new Error(`${where}: ${kind} id must be a positive integer`);
    }
    if (kind === "request") {
      if (this.calls.has(id)) {
        throw new Error(`${where}: duplicate request id ${id}`);
      }
      const model = typeof record["model"] === "string" ? record["model"] : "unknown";
      this.calls.set(id, { model, resolved: false });
      return;
    }
    const call = this.calls.get(id);
    if (call === undefined) {
      throw new Error(`${where}: ${kind} for unknown request ${id}`);
    }
    if (call.resolved) {
      throw new Error(`${where}: request ${id} already has an outcome`);
    }
    call.resolved = true;
    if (kind === "no_charge") {
      const status = record["status"];
      if (typeof status !== "number" || status < 400) {
        throw new Error(`${where}: no_charge needs an HTTP error status (got ${String(status)})`);
      }
    } else if (kind === "usage") {
      this.report.usage.push(parseUsage(record, call.model, where));
    } else if (kind === "unmetered") {
      this.report.problems.push(
        `request ${id} to "${call.model}" is unmetered: ${String(record["reason"])}`,
      );
    }
  }

  private fact(record: Json, where: string): void {
    const name = record["name"];
    if (typeof name !== "string" || name === "") {
      throw new Error(`${where}: fact has no name`);
    }
    if (name in this.report.facts) {
      throw new Error(`${where}: fact "${name}" reported twice`);
    }
    this.report.facts[name] = record["value"];
  }

  finish(): RunReport {
    for (const [id, call] of this.calls) {
      if (!call.resolved) {
        this.report.problems.push(
          `request ${id} to "${call.model}" has no usage, so its cost is unknown`,
        );
      }
    }
    return this.report;
  }
}

/** Pairs each metered request with its outcome; anything that leaves spend unknown is a problem. */
export function parseReport(text: string): RunReport {
  const reader = new ReportReader();
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") {
      continue;
    }
    const where = `report line ${index + 1}`;
    try {
      let record: Json;
      try {
        record = JSON.parse(line) as Json;
      } catch {
        throw new Error(`${where} is not valid JSON`);
      }
      reader.read(record, where);
    } catch (error) {
      reader.report.problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  return reader.finish();
}

type FactCheck = { min: number } | { equals: unknown };

function parseChecks(checks: unknown): Record<string, FactCheck> {
  const facts = (checks as { facts?: unknown } | null)?.facts;
  if (typeof facts !== "object" || facts === null || Array.isArray(facts)) {
    throw new Error('checks.json must be {"facts": {"<name>": {"min": n} | {"equals": value}}}');
  }
  const entries = Object.entries(facts as Json);
  if (entries.length === 0) {
    throw new Error("checks.json must check at least one fact");
  }
  for (const [name, check] of entries) {
    const keys = typeof check === "object" && check !== null ? Object.keys(check) : [];
    const valid =
      keys.length === 1 &&
      (keys[0] === "equals" ||
        (keys[0] === "min" && typeof (check as { min: unknown }).min === "number"));
    if (!valid) {
      throw new Error(`checks.json facts.${name} must be {"min": <number>} or {"equals": <value>}`);
    }
  }
  return facts as Record<string, FactCheck>;
}

export function evaluateChecks(checks: unknown, facts: Record<string, unknown>): string[] {
  const failures: string[] = [];
  for (const [name, check] of Object.entries(parseChecks(checks))) {
    if (!(name in facts)) {
      failures.push(`fact ${name} was not reported`);
      continue;
    }
    const actual = facts[name];
    const shown = JSON.stringify(actual);
    if ("min" in check) {
      if (typeof actual !== "number" || actual < check.min) {
        failures.push(`fact ${name} = ${shown}, expected at least ${check.min}`);
      }
    } else if (shown !== JSON.stringify(check.equals)) {
      failures.push(`fact ${name} = ${shown}, expected ${JSON.stringify(check.equals)}`);
    }
  }
  return failures;
}
