import { describe, expect, it } from "vitest";
import { selectExamples } from "#harness/select.ts";

const all = ["claude-tools", "pydantic-ai-agent", "vercel-ai-sdk-chat"];

describe("selectExamples", () => {
  it("selects only the examples whose files changed", () => {
    expect(
      selectExamples(
        ["examples/claude-tools/main.ts", "examples/claude-tools/README.md", "README.md"],
        all,
      ),
    ).toEqual(["claude-tools"]);
  });

  it("selects every example when shared code or the catalog changes", () => {
    for (const path of [
      "harness/run.ts",
      "shared/ts/index.ts",
      "shared/python/src/saygm_cookbook_shared/__init__.py",
      "catalog.json",
      "pnpm-lock.yaml",
      "uv.lock",
      "package.json",
      "pyproject.toml",
      ".github/workflows/examples.yml",
    ]) {
      expect({ path, selected: selectExamples([path], all) }).toEqual({ path, selected: all });
    }
  });

  it("selects nothing for docs and generated snippets", () => {
    expect(selectExamples(["README.md", "snippets/claude-tools.json", "LICENSE"], all)).toEqual([]);
  });

  it("ignores examples that no longer exist", () => {
    expect(selectExamples(["examples/removed/main.ts"], all)).toEqual([]);
  });

  it("returns slugs sorted and without duplicates", () => {
    expect(
      selectExamples(
        [
          "examples/vercel-ai-sdk-chat/main.ts",
          "examples/claude-tools/main.ts",
          "examples/claude-tools/x",
        ],
        all,
      ),
    ).toEqual(["claude-tools", "vercel-ai-sdk-chat"]);
  });
});
