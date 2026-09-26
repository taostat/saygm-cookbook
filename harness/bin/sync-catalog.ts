import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { syncCatalog } from "#harness/catalog.ts";
import { readJson, toJson } from "#harness/examples.ts";

const repoRoot = process.cwd();
const url = `${process.env["SAYGM_API_BASE"] ?? "https://api.saygm.com"}/v1/models`;
const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) {
  throw new Error(`GET ${url} returned ${response.status}; the catalog was not changed`);
}
const catalogPath = join(repoRoot, "catalog.json");
const catalog = syncCatalog(readJson(catalogPath), await response.json());
writeFileSync(catalogPath, toJson(catalog));
console.log(
  `catalog.json: ${Object.keys(catalog.models).length} models, ${Object.keys(catalog.roles).length} roles`,
);
