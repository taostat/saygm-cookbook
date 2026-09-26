import { readFileSync } from "node:fs";
import { exampleSlugs } from "#harness/examples.ts";
import { selectExamples } from "#harness/select.ts";

const changed = readFileSync(0, "utf8")
  .split("\n")
  .filter((line) => line !== "");
console.log(selectExamples(changed, exampleSlugs(process.cwd())).join(" "));
