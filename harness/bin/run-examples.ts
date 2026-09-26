import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_CAP_NDOLLARS, formatUsd, parseUsdToNdollars } from "#harness/budget.ts";
import { exampleSlugs, readJson, toJson } from "#harness/examples.ts";
import { modelOverrides, runExamples, updateStatus } from "#harness/run.ts";
import type { Status } from "#harness/run.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "cap-usd": { type: "string" },
    "timeout-seconds": { type: "string", default: "180" },
    "write-status": { type: "boolean", default: false },
  },
});

if (!process.env["SAYGM_API_KEY"]) {
  console.error("SAYGM_API_KEY is not set; create a key at https://saygm.com and export it");
  process.exit(2);
}
const overrides = modelOverrides(process.env);
if (values["write-status"] && overrides.length > 0) {
  console.error(
    `--write-status records the models in the snippets; unset ${overrides.join(", ")} first`,
  );
  process.exit(2);
}
const repoRoot = process.cwd();
const capText = values["cap-usd"] ?? process.env["SAYGM_RUN_CAP_USD"];
const capNdollars = capText === undefined ? DEFAULT_CAP_NDOLLARS : parseUsdToNdollars(capText);
const timeoutSeconds = Number.parseInt(values["timeout-seconds"], 10);
if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds <= 0) {
  throw new Error(
    `--timeout-seconds must be a positive integer, got "${values["timeout-seconds"]}"`,
  );
}
const slugs = positionals.length > 0 ? positionals : exampleSlugs(repoRoot);

const summary = await runExamples({
  repoRoot,
  slugs,
  capNdollars,
  timeoutMs: timeoutSeconds * 1000,
  env: process.env,
  log: (line) => console.log(line),
});

console.log("");
for (const result of summary.results) {
  console.log(
    `${result.status.padEnd(7)} ${result.slug.padEnd(24)} ${formatUsd(result.costNdollars)}`,
  );
  for (const error of result.errors) {
    console.log(`        ${error}`);
  }
}
console.log(`total   ${formatUsd(summary.totalNdollars)} of ${formatUsd(summary.capNdollars)} cap`);

if (values["write-status"]) {
  const statusPath = join(repoRoot, "snippets", "status.json");
  const previous = readJson(statusPath) as Status;
  writeFileSync(statusPath, toJson(updateStatus(previous, summary.results, new Date())));
}
process.exit(summary.ok ? 0 : 1);
