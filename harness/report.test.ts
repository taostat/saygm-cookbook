import { describe, expect, it } from "vitest";
import { evaluateChecks, parseReport } from "#harness/report.ts";

const line = (record: object): string => JSON.stringify(record);
const request = (id: number, model = "a") =>
  line({ kind: "request", id, model, path: "/v1/responses" });
const usage = (id: number, input: number, output: number, model = "a") =>
  line({
    kind: "usage",
    id,
    model,
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  });
const priced = (model: string, input: number, output: number) => ({
  model,
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
});

describe("parseReport", () => {
  it("pairs each request with its usage and collects facts", () => {
    const text = [
      request(1),
      usage(1, 1, 2),
      request(2, "b"),
      usage(2, 3, 4, "b"),
      line({ kind: "fact", name: "chunks", value: 5 }),
      "",
    ].join("\n");
    expect(parseReport(text)).toEqual({
      usage: [priced("a", 1, 2), priced("b", 3, 4)],
      facts: { chunks: 5 },
      problems: [],
    });
  });

  it("returns an empty report for empty input", () => {
    expect(parseReport("")).toEqual({ usage: [], facts: {}, problems: [] });
  });

  it("treats a request answered with an error status as free", () => {
    const text = [request(1), line({ kind: "no_charge", id: 1, status: 401 })].join("\n");
    expect(parseReport(text)).toEqual({ usage: [], facts: {}, problems: [] });
  });

  it("flags a request that never got usage", () => {
    expect(parseReport(request(1)).problems).toEqual([
      'request 1 to "a" has no usage, so its cost is unknown',
    ]);
  });

  it("flags an unmetered response", () => {
    const text = [
      request(1),
      line({ kind: "unmetered", id: 1, reason: "response has no usage" }),
    ].join("\n");
    expect(parseReport(text).problems).toEqual([
      'request 1 to "a" is unmetered: response has no usage',
    ]);
  });

  it("keeps valid usage when another line is malformed", () => {
    const report = parseReport([request(1), usage(1, 5, 5), "nope"].join("\n"));
    expect(report.usage).toEqual([priced("a", 5, 5)]);
    expect(report.problems).toEqual(["report line 3 is not valid JSON"]);
  });

  it("flags an unknown record kind", () => {
    expect(parseReport(line({ kind: "other" })).problems).toEqual([
      'report line 1: unknown kind "other"',
    ]);
  });

  it("flags usage with a bad token count or no matching request", () => {
    for (const bad of [
      { kind: "usage", id: 1, model: "a", input_tokens: -1, output_tokens: 0 },
      { kind: "usage", id: 1, model: "a", input_tokens: 1.5, output_tokens: 0 },
      { kind: "usage", id: 1, model: "a", output_tokens: 0 },
    ]) {
      expect(parseReport([request(1), line(bad)].join("\n")).problems[0]).toMatch(/report line 2/);
    }
    expect(parseReport(usage(9, 1, 1)).problems).toEqual([
      "report line 1: usage for unknown request 9",
    ]);
  });

  it("flags duplicate or malformed request ids", () => {
    expect(parseReport([request(1), request(1), usage(1, 1, 1)].join("\n")).problems).toEqual([
      "report line 2: duplicate request id 1",
    ]);
    expect(parseReport(line({ kind: "request", model: "a" })).problems).toEqual([
      "report line 1: request id must be a positive integer",
    ]);
  });

  it("flags a second outcome for the same request", () => {
    const text = [request(1), usage(1, 1, 1), line({ kind: "no_charge", id: 1, status: 500 })].join(
      "\n",
    );
    expect(parseReport(text).problems).toEqual(["report line 3: request 1 already has an outcome"]);
  });

  it("flags a no_charge record without an error status", () => {
    const text = [request(1), line({ kind: "no_charge", id: 1, status: 200 })].join("\n");
    expect(parseReport(text).problems).toEqual([
      "report line 2: no_charge needs an HTTP error status (got 200)",
    ]);
  });

  it("flags a fact reported twice", () => {
    const fact = line({ kind: "fact", name: "x", value: 1 });
    expect(parseReport(`${fact}\n${fact}`).problems).toEqual([
      'report line 2: fact "x" reported twice',
    ]);
  });
});

describe("evaluateChecks", () => {
  it("passes when every fact meets its check", () => {
    const checks = { facts: { chunks: { min: 2 }, schema_valid: { equals: true } } };
    expect(evaluateChecks(checks, { chunks: 2, schema_valid: true })).toEqual([]);
  });

  it("reports a fact below its minimum", () => {
    expect(evaluateChecks({ facts: { chunks: { min: 2 } } }, { chunks: 1 })).toEqual([
      "fact chunks = 1, expected at least 2",
    ]);
  });

  it("reports a fact that does not equal its expected value", () => {
    expect(evaluateChecks({ facts: { city: { equals: "Paris" } } }, { city: "Lyon" })).toEqual([
      'fact city = "Lyon", expected "Paris"',
    ]);
  });

  it("reports a missing fact", () => {
    expect(evaluateChecks({ facts: { chunks: { min: 2 } } }, {})).toEqual([
      "fact chunks was not reported",
    ]);
  });

  it("treats a non-numeric value as failing a minimum", () => {
    expect(evaluateChecks({ facts: { chunks: { min: 2 } } }, { chunks: "3" })).toEqual([
      'fact chunks = "3", expected at least 2',
    ]);
  });

  it("rejects malformed checks", () => {
    expect(() => evaluateChecks({}, {})).toThrow(/checks\.json/);
    expect(() => evaluateChecks({ facts: {} }, {})).toThrow(/at least one fact/);
    expect(() => evaluateChecks({ facts: { a: {} } }, {})).toThrow(/facts\.a/);
    expect(() => evaluateChecks({ facts: { a: { min: "2" } } }, {})).toThrow(/facts\.a/);
    expect(() => evaluateChecks({ facts: { a: { min: 1, equals: 1 } } }, {})).toThrow(/facts\.a/);
  });
});
