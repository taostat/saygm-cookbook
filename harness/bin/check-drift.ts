import { join } from "node:path";
import { parseCatalog } from "#harness/catalog.ts";
import { checkCommands, readManifest } from "#harness/commands.ts";
import { checkDrift, externalUrls, scanPython, scanTypeScript } from "#harness/drift.ts";
import { exampleSlugs, exampleSources, readJson } from "#harness/examples.ts";
import { extractRegions } from "#harness/extract.ts";

const COMMANDS_FILE = "commands.sh";

const repoRoot = process.cwd();
const catalog = parseCatalog(readJson(join(repoRoot, "catalog.json")));
async function checkExample(slug: string): Promise<string[]> {
  const problems: string[] = [];
  const files = exampleSources(repoRoot, slug);
  const code = files.filter(({ file }) => /\.(?:ts|js|py)$/.test(file));
  const sources = await Promise.all(
    code.map(({ file, source }) =>
      file.endsWith(".py") ? scanPython(source, file) : scanTypeScript(source, file),
    ),
  );
  const checksPath = `examples/${slug}/checks.json`;
  try {
    const external = externalUrls(readJson(join(repoRoot, checksPath)), checksPath);
    problems.push(...checkDrift(catalog, sources, external));
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }

  const commandsPath = `examples/${slug}/${COMMANDS_FILE}`;
  const commands = files.find(({ file }) => file === commandsPath);
  if (commands === undefined) {
    problems.push(`${commandsPath}: missing; it holds the install and run commands pages show`);
    return problems;
  }
  const regions = Object.fromEntries(
    extractRegions(commands.source, commands.file).map(([id, region]) => [id, region.code]),
  );
  const manifest = await readManifest(join(repoRoot, "examples", slug));
  problems.push(...checkCommands(commandsPath, regions, manifest));
  return problems;
}

const problems = (await Promise.all(exampleSlugs(repoRoot).map(checkExample))).flat();

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("drift check passed");
