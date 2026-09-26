import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Env = Record<string, string | undefined>;

const DEFAULT_CATALOG = fileURLToPath(new URL("../../catalog.json", import.meta.url));

export class CatalogError extends Error {
  override name = "CatalogError";
}

export interface ModelIdOptions {
  catalogPath?: string;
  env?: Env;
}

/**
 * Returns the model id for a role in catalog.json, preferring a SAYGM_MODEL_<ROLE> env override.
 *
 * @throws CatalogError when the catalog cannot be read or does not define the role.
 */
export function modelId(role: string, options: ModelIdOptions = {}): string {
  const env = options.env ?? process.env;
  const override = env[`SAYGM_MODEL_${role.toUpperCase()}`];
  if (override) {
    return override;
  }
  const catalogPath = options.catalogPath ?? DEFAULT_CATALOG;
  const roles = readRoles(catalogPath);
  const entry = roles[role];
  if (entry === undefined) {
    const known = Object.keys(roles).toSorted().join(", ");
    throw new CatalogError(`unknown model role "${role}"; known roles: ${known} (${catalogPath})`);
  }
  if (
    typeof entry !== "object" ||
    entry === null ||
    typeof (entry as { model?: unknown }).model !== "string"
  ) {
    throw new CatalogError(`role "${role}" has no model in ${catalogPath}`);
  }
  return (entry as { model: string }).model;
}

function readRoles(catalogPath: string): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(catalogPath, "utf8");
  } catch (error) {
    throw new CatalogError(`cannot read ${catalogPath}: ${String(error)}`, { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new CatalogError(`${catalogPath} is not valid JSON: ${String(error)}`, { cause: error });
  }
  const roles = (parsed as { roles?: unknown } | null)?.roles;
  if (typeof roles !== "object" || roles === null) {
    throw new CatalogError(`${catalogPath} has no "roles" object`);
  }
  return roles as Record<string, unknown>;
}

/** Appends a named observation for checks.json to SAYGM_REPORT_FILE, when the runner sets it. */
export function reportFact(name: string, value: unknown, env: Env = process.env): void {
  const path = env["SAYGM_REPORT_FILE"];
  if (path) {
    appendFileSync(path, `${JSON.stringify({ kind: "fact", name, value })}\n`);
  }
}
