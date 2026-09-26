import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { modelId, reportFact } from "@saygm-cookbook/shared";

const catalogFile = (content: unknown): string => {
  const path = join(mkdtempSync(join(tmpdir(), "catalog-")), "catalog.json");
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
};

const catalog = {
  roles: { chat_cheap: { model: "qwen3.6-35b-a3b" }, claude: { model: "claude-haiku-4-5" } },
};

describe("modelId", () => {
  it("resolves a role from the catalog", () => {
    expect(modelId("chat_cheap", { catalogPath: catalogFile(catalog), env: {} })).toBe(
      "qwen3.6-35b-a3b",
    );
  });

  it("prefers a SAYGM_MODEL_<ROLE> override", () => {
    const env = { SAYGM_MODEL_CHAT_CHEAP: "gpt-5.4-nano" };
    expect(modelId("chat_cheap", { catalogPath: catalogFile(catalog), env })).toBe("gpt-5.4-nano");
  });

  it("ignores an empty override", () => {
    const env = { SAYGM_MODEL_CHAT_CHEAP: "" };
    expect(modelId("chat_cheap", { catalogPath: catalogFile(catalog), env })).toBe(
      "qwen3.6-35b-a3b",
    );
  });

  it("names the known roles when a role is unknown", () => {
    expect(() => modelId("gemini", { catalogPath: catalogFile(catalog), env: {} })).toThrow(
      /unknown model role "gemini"; known roles: chat_cheap, claude/,
    );
  });

  it("explains a missing catalog file", () => {
    expect(() => modelId("claude", { catalogPath: "/nonexistent/catalog.json", env: {} })).toThrow(
      /cannot read \/nonexistent\/catalog\.json/,
    );
  });

  it("rejects a catalog that is not valid JSON", () => {
    expect(() => modelId("claude", { catalogPath: catalogFile("{"), env: {} })).toThrow(
      /not valid JSON/,
    );
  });

  it("rejects a role entry without a model", () => {
    const path = catalogFile({ roles: { claude: {} } });
    expect(() => modelId("claude", { catalogPath: path, env: {} })).toThrow(
      /role "claude" has no model/,
    );
  });

  it("finds the repository catalog by default", () => {
    expect(modelId("claude", { env: {} })).toMatch(/^claude-/);
  });
});

const reportFile = (): string => join(mkdtempSync(join(tmpdir(), "report-")), "report.ndjson");
const lines = (path: string): unknown[] =>
  readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

describe("reportFact", () => {
  it("appends a fact as a JSON line", () => {
    const path = reportFile();
    reportFact("tool_calls", 1, { SAYGM_REPORT_FILE: path });
    expect(lines(path)).toEqual([{ kind: "fact", name: "tool_calls", value: 1 }]);
  });

  it("does nothing without SAYGM_REPORT_FILE", () => {
    expect(() => reportFact("tool_calls", 1, {})).not.toThrow();
  });
});
