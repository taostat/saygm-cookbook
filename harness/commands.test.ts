import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkCommands, readManifest } from "#harness/commands.ts";

const exampleDir = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), "commands-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
};

describe("readManifest", () => {
  it("reads exact npm dependencies and skips workspace packages", async () => {
    const dir = exampleDir({
      "package.json": JSON.stringify({
        dependencies: { ai: "7.0.114", zod: "4.6.5", "@saygm-examples/shared": "workspace:*" },
      }),
    });
    expect(await readManifest(dir)).toEqual({
      lang: "typescript",
      dependencies: { ai: "7.0.114", zod: "4.6.5" },
    });
  });

  it("reads pinned Python dependencies with extras and skips workspace packages", async () => {
    const dir = exampleDir({
      "pyproject.toml": [
        "[project]",
        'name = "x"',
        'dependencies = ["pydantic-ai-slim[anthropic,openai]==2.50.0", "saygm-examples-shared"]',
      ].join("\n"),
    });
    expect(await readManifest(dir)).toEqual({
      lang: "python",
      dependencies: { "pydantic-ai-slim[anthropic,openai]": "2.50.0" },
    });
  });

  it("rejects a dependency that is not pinned exactly", async () => {
    const npm = exampleDir({ "package.json": JSON.stringify({ dependencies: { ai: "^7.0.0" } }) });
    await expect(readManifest(npm)).rejects.toThrow(/ai must be pinned to an exact version/);
    const py = exampleDir({ "pyproject.toml": '[project]\ndependencies = ["openai>=1"]\n' });
    await expect(readManifest(py)).rejects.toThrow(/openai>=1 must be pinned with ==/);
  });
});

const npmManifest = { lang: "typescript" as const, dependencies: { ai: "7.0.114", zod: "4.6.5" } };
const pyManifest = {
  lang: "python" as const,
  dependencies: { "pydantic-ai-slim[openai]": "2.50.0" },
};

describe("checkCommands", () => {
  it("passes when the install line matches the manifest and run is the runner's command", () => {
    expect(
      checkCommands(
        "c.sh",
        { install: "npm install zod@4.6.5 ai@7.0.114", run: "node main.ts" },
        npmManifest,
      ),
    ).toEqual([]);
    expect(
      checkCommands(
        "c.sh",
        { install: 'pip install "pydantic-ai-slim[openai]==2.50.0"', run: "python main.py" },
        pyManifest,
      ),
    ).toEqual([]);
  });

  it("flags a version, a missing package and an extra package", () => {
    const problems = checkCommands(
      "c.sh",
      { install: "npm install ai@7.0.100 left-pad@1.0.0", run: "node main.ts" },
      npmManifest,
    );
    expect(problems).toEqual([
      "c.sh: install has ai@7.0.100 but the manifest pins 7.0.114",
      "c.sh: install has left-pad@1.0.0, which the manifest does not list",
      "c.sh: install is missing zod@4.6.5",
    ]);
  });

  it("flags the wrong installer and run command", () => {
    expect(
      checkCommands(
        "c.sh",
        { install: "pnpm add zod@4.6.5 ai@7.0.114", run: "tsx main.ts" },
        npmManifest,
      ),
    ).toEqual(['c.sh: install must be one "npm install" line', 'c.sh: run must be "node main.ts"']);
  });

  it("flags missing regions", () => {
    expect(checkCommands("c.sh", {}, npmManifest)).toEqual([
      'c.sh: needs an "install" region',
      'c.sh: needs a "run" region',
    ]);
  });
});
