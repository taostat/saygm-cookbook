import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SOURCE_FILE = /^[^.].*\.(?:ts|py|sh)$/;

export function exampleSlugs(repoRoot: string): string[] {
  return readdirSync(join(repoRoot, "examples"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

export function exampleSources(
  repoRoot: string,
  slug: string,
): Array<{ file: string; source: string }> {
  return readdirSync(join(repoRoot, "examples", slug))
    .filter((name) => SOURCE_FILE.test(name) && !name.endsWith(".test.ts"))
    .toSorted()
    .map((name) => {
      const file = `examples/${slug}/${name}`;
      return { file, source: readFileSync(join(repoRoot, file), "utf8") };
    });
}

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
