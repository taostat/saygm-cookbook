import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Visitor, parseSync } from "oxc-parser";
import type { Catalog } from "#harness/catalog.ts";

export interface SourceFacts {
  file: string;
  strings: Array<{ value: string; line: number }>;
  roles: Array<{ role: string | null; line: number }>;
}

const PYTHON_SCANNER = fileURLToPath(new URL("scan_python.py", import.meta.url));

function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) {
      line += 1;
    }
  }
  return line;
}

export function scanTypeScript(source: string, file: string): SourceFacts {
  const result = parseSync(file, source, { lang: "ts" });
  const [firstError] = result.errors;
  if (firstError !== undefined) {
    throw new Error(`${file}: cannot parse: ${firstError.message}`);
  }
  const facts: SourceFacts = { file, strings: [], roles: [] };
  new Visitor({
    Literal(node) {
      if (typeof node.value === "string") {
        facts.strings.push({ value: node.value, line: lineAt(source, node.start) });
      }
    },
    TemplateElement(node) {
      facts.strings.push({
        value: node.value.cooked ?? node.value.raw,
        line: lineAt(source, node.start),
      });
    },
    CallExpression(node) {
      if (node.callee.type === "Identifier" && node.callee.name === "modelId") {
        const [first] = node.arguments;
        const role =
          first?.type === "Literal" && typeof first.value === "string" ? first.value : null;
        facts.roles.push({ role, line: lineAt(source, node.start) });
      }
    },
  }).visit(result.program);
  return facts;
}

export function scanPython(source: string, file: string, python = "python3"): Promise<SourceFacts> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [PYTHON_SCANNER, file], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (error) =>
      reject(new Error(`${file}: cannot run ${python}: ${error.message}`)),
    );
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${file}: cannot parse: ${stderr.trim()}`));
        return;
      }
      const parsed = JSON.parse(stdout) as Omit<SourceFacts, "file">;
      resolve({ file, ...parsed });
    });
    child.stdin.end(source);
  });
}

const URL_PREFIX = /^https?:\/\//;
const MODEL_ID_SHAPE = /^[a-z][a-z0-9.]*(?:-[a-z0-9.]+)+$/;

function makerPrefix(id: string): string {
  return /^[a-z]+/.exec(id)?.[0] ?? id;
}

function modelProblem(value: string, catalog: Catalog, makers: Set<string>): boolean {
  return value in catalog.models || (MODEL_ID_SHAPE.test(value) && makers.has(makerPrefix(value)));
}

export function checkDrift(catalog: Catalog, sources: SourceFacts[]): string[] {
  const baseUrls = Object.values(catalog.base_urls);
  const makers = new Set(Object.keys(catalog.models).map(makerPrefix));
  const problems: string[] = [];
  for (const { file, strings, roles } of sources) {
    for (const { value, line } of strings) {
      if (modelProblem(value, catalog, makers)) {
        problems.push(
          `${file}:${line}: hard-coded model id "${value}"; use a model role from catalog.json`,
        );
      } else if (URL_PREFIX.test(value) && !baseUrls.includes(value)) {
        problems.push(`${file}:${line}: base URL "${value}" is not one of ${baseUrls.join(", ")}`);
      }
    }
    for (const { role, line } of roles) {
      if (role === null) {
        problems.push(`${file}:${line}: model role must be a string literal so it can be checked`);
      } else if (!(role in catalog.roles)) {
        problems.push(`${file}:${line}: unknown model role "${role}"`);
      }
    }
  }
  return problems;
}
