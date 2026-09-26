import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exampleSlugs, exampleSources, readJson, toJson } from "#harness/examples.ts";
import { parseCatalog } from "#harness/catalog.ts";
import { buildSnippetFile } from "#harness/extract.ts";

const repoRoot = process.cwd();
const check = process.argv.includes("--check");
const snippetsDir = join(repoRoot, "snippets");
const stale: string[] = [];
const catalog = parseCatalog(readJson(join(repoRoot, "catalog.json")));
const roles = Object.fromEntries(
  Object.entries(catalog.roles).map(([role, spec]) => [role, spec.model]),
);

const slugs = exampleSlugs(repoRoot);
for (const slug of slugs) {
  const path = join(snippetsDir, `${slug}.json`);
  const content = toJson(buildSnippetFile(slug, roles, exampleSources(repoRoot, slug)));
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (current === content) {
    continue;
  }
  if (check) {
    stale.push(`snippets/${slug}.json`);
  } else {
    writeFileSync(path, content);
    console.log(`wrote snippets/${slug}.json`);
  }
}
const orphans = readdirSync(snippetsDir)
  .filter((name) => name.endsWith(".json") && name !== "status.json")
  .filter((name) => !slugs.includes(name.slice(0, -".json".length)));
for (const name of orphans) {
  stale.push(`snippets/${name} has no example; delete it`);
}
if (stale.length > 0) {
  console.error(
    `snippets are out of date; run \`pnpm extract-snippets\`:\n  ${stale.join("\n  ")}`,
  );
  process.exit(1);
}
