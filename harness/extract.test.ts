import { describe, expect, it } from "vitest";
import { ExtractError, buildSnippetFile, extractRegions, langForFile } from "#harness/extract.ts";

const ts = (lines: string[]): string => lines.join("\n");

describe("extractRegions", () => {
  it("extracts a TypeScript region without its markers", () => {
    const source = ts([
      'import x from "x";',
      "// region: setup",
      "const a = 1;",
      "const b = 2;",
      "// endregion",
      "console.log(a);",
    ]);
    expect(extractRegions(source, "examples/demo/main.ts")).toEqual([
      [
        "setup",
        { lang: "typescript", file: "examples/demo/main.ts", code: "const a = 1;\nconst b = 2;" },
      ],
    ]);
  });

  it("extracts Python regions with # markers", () => {
    const source = ["# region: call", "print('hi')", "# endregion", ""].join("\n");
    expect(extractRegions(source, "examples/demo/main.py")).toEqual([
      ["call", { lang: "python", file: "examples/demo/main.py", code: "print('hi')" }],
    ]);
  });

  it("dedents indented regions and keeps relative indentation", () => {
    const source = ts([
      "async function main() {",
      "  // region: body",
      "  if (ok) {",
      "    run();",
      "  }",
      "  // endregion",
      "}",
    ]);
    const [[, region] = []] = extractRegions(source, "main.ts");
    expect(region?.code).toBe("if (ok) {\n  run();\n}");
  });

  it("normalises CRLF line endings", () => {
    const source = "// region: a\r\nconst a = 1;\r\n\r\nconst b = 2;\r\n// endregion\r\n";
    const [[, region] = []] = extractRegions(source, "main.ts");
    expect(region?.code).toBe("const a = 1;\n\nconst b = 2;");
  });

  it("trims blank lines at the edges of a region", () => {
    const source = ts(["// region: a", "", "const a = 1;", "", "// endregion"]);
    const [[, region] = []] = extractRegions(source, "main.ts");
    expect(region?.code).toBe("const a = 1;");
  });

  it("returns regions in source order", () => {
    const source = ts([
      "// region: b",
      "b();",
      "// endregion",
      "// region: a",
      "a();",
      "// endregion",
    ]);
    expect(extractRegions(source, "main.ts").map(([id]) => id)).toEqual(["b", "a"]);
  });

  it("rejects an unterminated region with its line", () => {
    const source = ts(["x();", "// region: open", "a();"]);
    expect(() => extractRegions(source, "main.ts")).toThrow(
      /main\.ts:2: region "open" is never closed/,
    );
  });

  it("rejects a nested region", () => {
    const source = ts([
      "// region: outer",
      "// region: inner",
      "a();",
      "// endregion",
      "// endregion",
    ]);
    expect(() => extractRegions(source, "main.ts")).toThrow(
      /main\.ts:2: region "inner" opens inside "outer"/,
    );
  });

  it("rejects an endregion with no open region", () => {
    expect(() => extractRegions("a();\n// endregion\n", "main.ts")).toThrow(
      /main\.ts:2: endregion without/,
    );
  });

  it("rejects an empty region", () => {
    const source = ts(["// region: empty", "", "   ", "// endregion"]);
    expect(() => extractRegions(source, "main.ts")).toThrow(/main\.ts:1: region "empty" is empty/);
  });

  it("rejects a duplicate id in one file", () => {
    const source = ts([
      "// region: a",
      "a();",
      "// endregion",
      "// region: a",
      "b();",
      "// endregion",
    ]);
    expect(() => extractRegions(source, "main.ts")).toThrow(/main\.ts:4: duplicate region "a"/);
  });

  it("rejects malformed markers instead of leaking them into code", () => {
    for (const marker of [
      "// region setup",
      "// region:",
      "// region: Bad_Id",
      "// endregion: x",
    ]) {
      expect(() => extractRegions(`${marker}\na();\n// endregion\n`, "main.ts")).toThrow(
        ExtractError,
      );
    }
  });

  it("extracts HTML regions marked with HTML comments", () => {
    const source = [
      "<body>",
      "  <!-- region: page -->",
      "  <form></form>",
      "  <!-- endregion -->",
      "</body>",
    ].join("\n");
    expect(extractRegions(source, "examples/demo/index.html")).toEqual([
      ["page", { lang: "html", file: "examples/demo/index.html", code: "<form></form>" }],
    ]);
  });

  it("rejects a malformed HTML marker", () => {
    expect(() =>
      extractRegions("<!-- region page -->\n<p></p>\n<!-- endregion -->\n", "index.html"),
    ).toThrow(/index\.html:1: malformed marker/);
  });

  it("uses the comment style of the file's language", () => {
    const source = ["# region: a", "a()", "# endregion"].join("\n");
    expect(extractRegions(source, "main.ts")).toEqual([]);
  });

  it("returns nothing for a file without markers", () => {
    expect(extractRegions("const a = 1;\n", "main.ts")).toEqual([]);
  });
});

describe("langForFile", () => {
  it("maps extensions to languages", () => {
    expect(langForFile("a/main.ts")).toBe("typescript");
    expect(langForFile("a/main.py")).toBe("python");
    expect(langForFile("a/commands.sh")).toBe("bash");
    expect(langForFile("a/chat.js")).toBe("javascript");
    expect(langForFile("a/index.html")).toBe("html");
  });

  it("rejects unknown extensions", () => {
    expect(() => langForFile("a/main.rb")).toThrow(ExtractError);
  });
});

const roles = { claude: "claude-haiku-4-5", chat_cheap: "qwen3.6-35b-a3b" };

describe("buildSnippetFile", () => {
  it("replaces model roles with the model ids CI runs", () => {
    const snippet = buildSnippetFile("demo", roles, [
      { file: "main.ts", source: '// region: a\nconst model = modelId("claude");\n// endregion\n' },
      { file: "main.py", source: '# region: b\nmodel = model_id("chat_cheap")\n# endregion\n' },
    ]);
    expect(snippet.regions["a"]?.code).toBe('const model = "claude-haiku-4-5";');
    expect(snippet.regions["b"]?.code).toBe('model = "qwen3.6-35b-a3b"');
  });

  it("rejects a region that uses an unknown role", () => {
    expect(() =>
      buildSnippetFile("demo", roles, [
        { file: "main.ts", source: '// region: a\nmodelId("gemini");\n// endregion\n' },
      ]),
    ).toThrow(/main\.ts: region "a" uses unknown model role "gemini"/);
  });

  it("rejects a role helper call it cannot replace", () => {
    expect(() =>
      buildSnippetFile("demo", roles, [
        { file: "main.ts", source: '// region: a\nmodelId(/* role */ "claude");\n// endregion\n' },
      ]),
    ).toThrow(/main\.ts: region "a" calls a model role helper that cannot be replaced/);
  });

  it("extracts bash regions", () => {
    const snippet = buildSnippetFile("demo", roles, [
      {
        file: "commands.sh",
        source: "set -euo pipefail\n# region: run\nnode main.ts\n# endregion\n",
      },
    ]);
    expect(snippet.regions["run"]).toEqual({
      lang: "bash",
      file: "commands.sh",
      code: "node main.ts",
    });
  });

  it("merges regions across files", () => {
    const snippet = buildSnippetFile("demo", roles, [
      { file: "examples/demo/main.ts", source: "// region: a\na();\n// endregion\n" },
      { file: "examples/demo/tools.ts", source: "// region: b\nb();\n// endregion\n" },
    ]);
    expect(snippet).toEqual({
      slug: "demo",
      regions: {
        a: { lang: "typescript", file: "examples/demo/main.ts", code: "a();" },
        b: { lang: "typescript", file: "examples/demo/tools.ts", code: "b();" },
      },
    });
  });

  it("rejects a duplicate id across files", () => {
    expect(() =>
      buildSnippetFile("demo", roles, [
        { file: "main.ts", source: "// region: a\na();\n// endregion\n" },
        { file: "other.ts", source: "// region: a\nb();\n// endregion\n" },
      ]),
    ).toThrow(/other\.ts: duplicate region "a" \(first defined in main\.ts\)/);
  });

  it("rejects an example with no regions", () => {
    expect(() => buildSnippetFile("demo", roles, [{ file: "main.ts", source: "a();\n" }])).toThrow(
      /example "demo" has no regions/,
    );
  });
});
