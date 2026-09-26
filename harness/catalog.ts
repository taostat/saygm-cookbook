import type { Rates } from "#harness/budget.ts";

export interface RoleSpec {
  model: string;
  shape: string;
  tools: boolean;
  confidential?: boolean;
}

export interface CatalogModel {
  api_shapes: string[];
  available: boolean;
  tools: boolean;
  confidential: boolean;
  pricing: Record<string, number>;
  budget_rates: Rates | null;
}

export interface Catalog {
  base_urls: Record<string, string>;
  roles: Record<string, RoleSpec>;
  models: Record<string, CatalogModel>;
}

export class CatalogError extends Error {
  override name = "CatalogError";
}

const ROLE_NAME = /^[a-z][a-z0-9_]*$/;

type Json = Record<string, unknown>;

function object(value: unknown, path: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CatalogError(`${path} must be an object`);
  }
  return value as Json;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value === "") {
    throw new CatalogError(`${path} must be a non-empty string`);
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new CatalogError(`${path} must be true or false`);
  }
  return value;
}

function count(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new CatalogError(`${path} must be a non-negative integer`);
  }
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    throw new CatalogError(`${path} must be an array of strings`);
  }
  return value.map((item, index) => string(item, `${path}[${index}]`));
}

function counts(value: unknown, path: string): Record<string, number> {
  const entries = Object.entries(object(value, path));
  return Object.fromEntries(entries.map(([key, item]) => [key, count(item, `${path}.${key}`)]));
}

function parseRates(value: unknown, path: string): Rates | null {
  if (value === null) {
    return null;
  }
  const rates = object(value, path);
  return {
    input: count(rates["input"], `${path}.input`),
    output: count(rates["output"], `${path}.output`),
    cache_read: count(rates["cache_read"], `${path}.cache_read`),
    cache_write: count(rates["cache_write"], `${path}.cache_write`),
  };
}

function parseModel(value: unknown, path: string): CatalogModel {
  const model = object(value, path);
  return {
    api_shapes: stringArray(model["api_shapes"], `${path}.api_shapes`),
    available: boolean(model["available"], `${path}.available`),
    tools: boolean(model["tools"], `${path}.tools`),
    confidential: boolean(model["confidential"], `${path}.confidential`),
    pricing: counts(model["pricing"], `${path}.pricing`),
    budget_rates: parseRates(model["budget_rates"], `${path}.budget_rates`),
  };
}

function checkRole(name: string, role: RoleSpec, models: Record<string, CatalogModel>): void {
  const model = models[role.model];
  const uses = `role "${name}" uses "${role.model}"`;
  if (model === undefined) {
    throw new CatalogError(`${uses}, which is not in the catalog; pick a live model for this role`);
  }
  if (!model.available) {
    throw new CatalogError(`${uses}, which is unavailable`);
  }
  if (!model.api_shapes.includes(role.shape)) {
    throw new CatalogError(
      `role "${name}" needs shape "${role.shape}" but "${role.model}" serves ${model.api_shapes.join(", ")}`,
    );
  }
  if (role.tools && !model.tools) {
    throw new CatalogError(`role "${name}" needs tools but "${role.model}" does not support them`);
  }
  if (role.confidential === true && !model.confidential) {
    throw new CatalogError(`role "${name}" needs a confidential model but "${role.model}" is not`);
  }
  if (model.budget_rates === null) {
    throw new CatalogError(`${uses}, which has no token rates to budget with`);
  }
}

export function parseCatalog(value: unknown): Catalog {
  const root = object(value, "catalog");
  const baseUrls = object(root["base_urls"], "base_urls");
  const base_urls = Object.fromEntries(
    Object.entries(baseUrls).map(([key, url]) => [key, string(url, `base_urls.${key}`)]),
  );
  const models: Record<string, CatalogModel> = {};
  for (const [id, model] of Object.entries(object(root["models"], "models"))) {
    models[id] = parseModel(model, `models.${id}`);
  }
  const roles: Record<string, RoleSpec> = {};
  for (const [name, raw] of Object.entries(object(root["roles"], "roles"))) {
    if (!ROLE_NAME.test(name)) {
      throw new CatalogError(
        `role name "${name}" must be snake_case so SAYGM_MODEL_<ROLE> is a valid env var`,
      );
    }
    const role = object(raw, `roles.${name}`);
    roles[name] = {
      model: string(role["model"], `roles.${name}.model`),
      shape: string(role["shape"], `roles.${name}.shape`),
      tools: boolean(role["tools"], `roles.${name}.tools`),
      ...(role["confidential"] === undefined
        ? {}
        : { confidential: boolean(role["confidential"], `roles.${name}.confidential`) }),
    };
    checkRole(name, roles[name], models);
  }
  return { base_urls, roles, models };
}

export function budgetRatesFor(catalog: Catalog, model: string): Rates {
  const entry = catalog.models[model];
  if (entry === undefined) {
    throw new CatalogError(`model "${model}" is not in catalog.json; run \`pnpm sync-catalog\``);
  }
  if (entry.budget_rates === null) {
    throw new CatalogError(`model "${model}" has no token rates in catalog.json`);
  }
  return entry.budget_rates;
}

const INPUT_KEYS = ["input_per_mtok_ndollars", "long_context_input_per_mtok_ndollars"];
const RATE_KEYS: Record<keyof Rates, string[]> = {
  input: INPUT_KEYS,
  output: ["output_per_mtok_ndollars", "long_context_output_per_mtok_ndollars"],
  cache_read: [
    ...INPUT_KEYS,
    "cache_read_per_mtok_ndollars",
    "long_context_cache_read_per_mtok_ndollars",
  ],
  cache_write: [
    ...INPUT_KEYS,
    "cache_write_per_mtok_ndollars",
    "cache_write_5m_per_mtok_ndollars",
    "cache_write_1h_per_mtok_ndollars",
    "long_context_cache_write_per_mtok_ndollars",
  ],
};

// Budget at the highest rate any offer, tier or context length can charge, so the cap holds.
function budgetRates(tables: Array<Record<string, number>>): Rates | null {
  const highest = (keys: string[]): number | undefined => {
    const values = tables.flatMap((table) => keys.flatMap((key) => table[key] ?? []));
    return values.length === 0 ? undefined : Math.max(...values);
  };
  const input = highest(RATE_KEYS.input);
  const output = highest(RATE_KEYS.output);
  if (input === undefined || output === undefined) {
    return null;
  }
  return {
    input,
    output,
    cache_read: highest(RATE_KEYS.cache_read) ?? input,
    cache_write: highest(RATE_KEYS.cache_write) ?? input,
  };
}

function priceTables(model: Json, path: string): Array<Record<string, number>> {
  const tables: Array<Record<string, number>> = [];
  const pricing = model["pricing"];
  if (pricing !== undefined && pricing !== null) {
    const dimensions = object(pricing, `${path}.pricing`)["dimensions"];
    if (dimensions !== undefined) {
      tables.push(counts(dimensions, `${path}.pricing.dimensions`));
    }
  }
  const range = model["price_range"];
  if (range !== undefined && range !== null) {
    for (const [tier, band] of Object.entries(object(range, `${path}.price_range`))) {
      if (typeof band === "object" && band !== null && "dimensions" in band) {
        tables.push(counts(band.dimensions, `${path}.price_range.${tier}.dimensions`));
      }
    }
  }
  return tables;
}

function modelFromApi(model: Json, path: string): CatalogModel {
  const capabilities = model["capabilities"];
  const tools =
    typeof capabilities === "object" &&
    capabilities !== null &&
    (capabilities as Json)["tools"] === true;
  const tables = priceTables(model, path);
  return {
    api_shapes: stringArray(model["api_shapes"] ?? [], `${path}.api_shapes`),
    available: model["available"] === true,
    tools,
    confidential: model["confidential"] === true,
    pricing: tables[0] ?? {},
    budget_rates: budgetRates(tables),
  };
}

export function modelsFromApi(response: unknown): Record<string, CatalogModel> {
  const data = object(response, "response")["data"];
  if (!Array.isArray(data)) {
    throw new CatalogError("the /v1/models response has no data array");
  }
  const models: Record<string, CatalogModel> = {};
  for (const [index, raw] of data.entries()) {
    const model = object(raw, `data[${index}]`);
    const id = string(model["id"], `data[${index}].id`);
    if (id in models) {
      throw new CatalogError(`duplicate model id "${id}" in the /v1/models response`);
    }
    models[id] = modelFromApi(model, `data[${index}]`);
  }
  return Object.fromEntries(Object.entries(models).toSorted(([a], [b]) => (a < b ? -1 : 1)));
}

export function syncCatalog(existing: unknown, response: unknown): Catalog {
  const { base_urls, roles } = object(existing, "catalog");
  return parseCatalog({ base_urls, roles, models: modelsFromApi(response) });
}
