import { describe, expect, it } from "vitest";
import {
  CatalogError,
  budgetRatesFor,
  modelsFromApi,
  parseCatalog,
  syncCatalog,
} from "#harness/catalog.ts";

const qwen = {
  api_shapes: ["chat.completions"],
  available: true,
  tools: true,
  pricing: { input_per_mtok_ndollars: 51_832_000, output_per_mtok_ndollars: 310_365_000 },
  budget_rates: {
    input: 248_000_000,
    output: 1_485_000_000,
    cache_read: 248_000_000,
    cache_write: 248_000_000,
  },
};

const valid = () => ({
  base_urls: { openai: "https://api.saygm.com/v1", anthropic: "https://api.saygm.com" },
  roles: { chat_cheap: { model: "qwen3.6-35b-a3b", shape: "chat.completions", tools: true } },
  models: { "qwen3.6-35b-a3b": structuredClone(qwen) },
});

describe("parseCatalog", () => {
  it("accepts a consistent catalog", () => {
    expect(parseCatalog(valid()).roles["chat_cheap"]?.model).toBe("qwen3.6-35b-a3b");
  });

  it("rejects a role whose model is not in the catalog", () => {
    const catalog = valid();
    catalog.roles.chat_cheap.model = "gone-model";
    expect(() => parseCatalog(catalog)).toThrow(
      /role "chat_cheap" uses "gone-model", which is not in the catalog/,
    );
  });

  it("rejects a role whose model lacks the role's API shape", () => {
    const catalog = valid();
    catalog.roles.chat_cheap.shape = "responses";
    expect(() => parseCatalog(catalog)).toThrow(
      /role "chat_cheap" needs shape "responses".*chat\.completions/,
    );
  });

  it("rejects a role whose model is unavailable", () => {
    const catalog = valid();
    catalog.models["qwen3.6-35b-a3b"].available = false;
    expect(() => parseCatalog(catalog)).toThrow(
      /role "chat_cheap" uses "qwen3.6-35b-a3b", which is unavailable/,
    );
  });

  it("rejects a tools role whose model has no tool support", () => {
    const catalog = valid();
    catalog.models["qwen3.6-35b-a3b"].tools = false;
    expect(() => parseCatalog(catalog)).toThrow(/role "chat_cheap" needs tools/);
  });

  it("rejects a role whose model has no budget rates", () => {
    const catalog = valid();
    (catalog.models["qwen3.6-35b-a3b"] as { budget_rates: unknown }).budget_rates = null;
    expect(() => parseCatalog(catalog)).toThrow(
      /role "chat_cheap" uses "qwen3.6-35b-a3b", which has no token rates/,
    );
  });

  it("rejects role names that cannot form an env var", () => {
    const catalog = valid() as { roles: Record<string, unknown> };
    catalog.roles["chat-cheap"] = catalog.roles["chat_cheap"];
    expect(() => parseCatalog(catalog)).toThrow(/role name "chat-cheap"/);
  });

  it("rejects malformed structure with the offending path", () => {
    expect(() => parseCatalog(null)).toThrow(CatalogError);
    expect(() => parseCatalog({ ...valid(), base_urls: { openai: 3 } })).toThrow(
      /base_urls\.openai/,
    );
    expect(() => parseCatalog({ ...valid(), models: { m: { ...qwen, api_shapes: "x" } } })).toThrow(
      /models\.m\.api_shapes/,
    );
  });
});

describe("budgetRatesFor", () => {
  it("returns the budget rates of a known model", () => {
    expect(budgetRatesFor(parseCatalog(valid()), "qwen3.6-35b-a3b").output).toBe(1_485_000_000);
  });

  it("fails for a model that is not in the catalog", () => {
    expect(() => budgetRatesFor(parseCatalog(valid()), "nope")).toThrow(
      /model "nope" is not in catalog\.json; run `pnpm sync-catalog`/,
    );
  });
});

const apiModel = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  api_shapes: ["chat.completions", "responses"],
  available: true,
  capabilities: { tools: true },
  pricing: {
    unit: "ndollars_per_mtok",
    dimensions: {
      input_per_mtok_ndollars: 100,
      output_per_mtok_ndollars: 400,
      cache_read_per_mtok_ndollars: 10,
    },
  },
  price_range: {
    route_ceiling: { dimensions: { input_per_mtok_ndollars: 120, output_per_mtok_ndollars: 390 } },
    ceiling: {
      dimensions: {
        input_per_mtok_ndollars: 110,
        output_per_mtok_ndollars: 500,
        long_context_input_per_mtok_ndollars: 220,
        cache_write_1h_per_mtok_ndollars: 300,
        cache_write_5m_per_mtok_ndollars: 150,
      },
    },
  },
  ...extra,
});

describe("modelsFromApi", () => {
  it("keeps shapes, availability, tools and live prices", () => {
    const models = modelsFromApi({ data: [apiModel("m")] });
    expect(models["m"]?.api_shapes).toEqual(["chat.completions", "responses"]);
    expect(models["m"]?.pricing).toEqual({
      input_per_mtok_ndollars: 100,
      output_per_mtok_ndollars: 400,
      cache_read_per_mtok_ndollars: 10,
    });
  });

  it("budgets each token class at the highest rate any offer or tier can charge", () => {
    expect(modelsFromApi({ data: [apiModel("m")] })["m"]?.budget_rates).toEqual({
      input: 220,
      output: 500,
      cache_read: 220,
      cache_write: 300,
    });
  });

  it("gives per-image models no token rates", () => {
    const image = apiModel("img", {
      pricing: { unit: "ndollars_per_mtok", dimensions: { output_per_image_ndollars: 13_500_000 } },
      price_range: {},
    });
    expect(modelsFromApi({ data: [image] })["img"]?.budget_rates).toBeNull();
  });

  it("sorts models by id so syncs produce stable diffs", () => {
    expect(Object.keys(modelsFromApi({ data: [apiModel("b"), apiModel("a")] }))).toEqual([
      "a",
      "b",
    ]);
  });

  it("rejects a response without a data array", () => {
    expect(() => modelsFromApi({ object: "list" })).toThrow(/data/);
  });

  it("rejects duplicate ids", () => {
    expect(() => modelsFromApi({ data: [apiModel("a"), apiModel("a")] })).toThrow(
      /duplicate model id "a"/,
    );
  });
});

describe("syncCatalog", () => {
  it("replaces models and keeps roles and base URLs", () => {
    const synced = syncCatalog(parseCatalog(valid()), {
      data: [apiModel("qwen3.6-35b-a3b", { api_shapes: ["chat.completions"] })],
    });
    expect(synced.roles).toEqual(valid().roles);
    expect(synced.base_urls).toEqual(valid().base_urls);
    expect(synced.models["qwen3.6-35b-a3b"]?.budget_rates?.output).toBe(500);
  });

  it("fails when the live catalog breaks a role", () => {
    expect(() => syncCatalog(parseCatalog(valid()), { data: [apiModel("other")] })).toThrow(
      /role "chat_cheap" uses "qwen3.6-35b-a3b", which is not in the catalog/,
    );
  });
});
