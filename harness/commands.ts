import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Manifest {
  lang: "typescript" | "python";
  dependencies: Record<string, string>;
}

const WORKSPACE_PACKAGES = new Set(["@saygm-examples/shared", "saygm-examples-shared"]);
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+.][0-9A-Za-z.]+)?$/;

const INSTALLERS: Record<Manifest["lang"], { prefix: string; separator: string; run: string }> = {
  typescript: { prefix: "npm install ", separator: "@", run: "node main.ts" },
  python: { prefix: "pip install ", separator: "==", run: "python main.py" },
};

function readPyprojectDependencies(path: string, python = "python3"): Promise<string[]> {
  const script =
    "import json, sys, tomllib; " +
    "print(json.dumps(tomllib.load(open(sys.argv[1], 'rb'))['project'].get('dependencies', [])))";
  return new Promise((resolve, reject) => {
    const child = spawn(python, ["-c", script, path], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (error) =>
      reject(new Error(`${path}: cannot run ${python}: ${error.message}`)),
    );
    child.on("close", (code) => {
      if (code === 0) {
        resolve(JSON.parse(stdout) as string[]);
      } else {
        reject(new Error(`${path}: cannot read dependencies: ${stderr.trim()}`));
      }
    });
  });
}

function pythonDependencies(requirements: string[], path: string): Record<string, string> {
  const dependencies: Record<string, string> = {};
  for (const requirement of requirements) {
    if (WORKSPACE_PACKAGES.has(requirement)) {
      continue;
    }
    const [name, version] = requirement.split("==");
    if (name === undefined || version === undefined || !EXACT_VERSION.test(version)) {
      throw new Error(`${path}: ${requirement} must be pinned with ==`);
    }
    dependencies[name] = version;
  }
  return dependencies;
}

function npmDependencies(path: string): Record<string, string> {
  const manifest = JSON.parse(readFileSync(path, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const dependencies: Record<string, string> = {};
  for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
    if (WORKSPACE_PACKAGES.has(name)) {
      continue;
    }
    if (!EXACT_VERSION.test(version)) {
      throw new Error(`${path}: ${name} must be pinned to an exact version, not "${version}"`);
    }
    dependencies[name] = version;
  }
  return dependencies;
}

export async function readManifest(dir: string): Promise<Manifest> {
  const packageJson = join(dir, "package.json");
  if (existsSync(packageJson)) {
    return { lang: "typescript", dependencies: npmDependencies(packageJson) };
  }
  const pyproject = join(dir, "pyproject.toml");
  const requirements = await readPyprojectDependencies(pyproject);
  return { lang: "python", dependencies: pythonDependencies(requirements, pyproject) };
}

function installProblems(file: string, install: string, manifest: Manifest): string[] {
  const { prefix, separator } = INSTALLERS[manifest.lang];
  if (install.includes("\n") || !install.startsWith(prefix)) {
    return [`${file}: install must be one "${prefix.trim()}" line`];
  }
  const problems: string[] = [];
  const listed = new Set<string>();
  for (const token of install.slice(prefix.length).trim().split(/\s+/)) {
    const spec = token.replaceAll('"', "");
    const at = spec.lastIndexOf(separator);
    const name = spec.slice(0, at);
    const version = spec.slice(at + separator.length);
    const pinned = manifest.dependencies[name];
    listed.add(name);
    if (at <= 0 || pinned === undefined) {
      problems.push(`${file}: install has ${spec}, which the manifest does not list`);
    } else if (version !== pinned) {
      problems.push(`${file}: install has ${spec} but the manifest pins ${pinned}`);
    }
  }
  for (const [name, version] of Object.entries(manifest.dependencies)) {
    if (!listed.has(name)) {
      problems.push(`${file}: install is missing ${name}${separator}${version}`);
    }
  }
  return problems;
}

/** Checks that a page's install and run commands match the manifest and what the runner executes. */
export function checkCommands(
  file: string,
  regions: { install?: string; run?: string },
  manifest: Manifest,
): string[] {
  const problems: string[] = [];
  if (regions.install === undefined) {
    problems.push(`${file}: needs an "install" region`);
  } else {
    problems.push(...installProblems(file, regions.install, manifest));
  }
  const run = INSTALLERS[manifest.lang].run;
  if (regions.run === undefined) {
    problems.push(`${file}: needs a "run" region`);
  } else if (regions.run !== run) {
    problems.push(`${file}: run must be "${run}"`);
  }
  return problems;
}
