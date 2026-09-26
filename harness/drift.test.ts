import { describe, expect, it } from "vitest";
import { parseCatalog } from "#harness/catalog.ts";
import { checkDrift, externalUrls, scanPython, scanTypeScript } from "#harness/drift.ts";

const rates = { input: 1, output: 1, cache_read: 1, cache_write: 1 };
const catalog = parseCatalog({
  base_urls: { openai: "https://api.saygm.com/v1", anthropic: "https://api.saygm.com" },
  roles: {
    chat_cheap: { model: "qwen3.6-35b-a3b", shape: "chat.completions", tools: false },
    claude: { model: "claude-haiku-4-5", shape: "messages", tools: true },
  },
  models: {
    "qwen3.6-35b-a3b": {
      api_shapes: ["chat.completions"],
      available: true,
      tools: true,
      confidential: false,
      pricing: {},
      budget_rates: rates,
    },
    "claude-haiku-4-5": {
      api_shapes: ["messages"],
      available: true,
      tools: true,
      confidential: false,
      pricing: {},
      budget_rates: rates,
    },
  },
});

describe("scanTypeScript", () => {
  it("finds string literals, template text and modelId roles", () => {
    const facts = scanTypeScript(
      [
        'const url = "https://api.saygm.com/v1";',
        "const t = `https://api.saygm.com/v1/${path}`;",
        'const model = modelId("chat_cheap");',
        "const other = modelId(role);",
      ].join("\n"),
      "main.ts",
    );
    expect(facts.strings).toEqual(
      expect.arrayContaining([
        { value: "https://api.saygm.com/v1", line: 1 },
        { value: "https://api.saygm.com/v1/", line: 2 },
      ]),
    );
    expect(facts.roles).toEqual([
      { role: "chat_cheap", line: 3 },
      { role: null, line: 4 },
    ]);
  });

  it("parses JavaScript files", () => {
    expect(scanTypeScript('const u = "https://api.saygm.com/v1";\n', "chat.js").strings).toEqual([
      { value: "https://api.saygm.com/v1", line: 1 },
    ]);
  });

  it("ignores comments", () => {
    expect(scanTypeScript('// "claude-haiku-4-5"\nconst a = 1;\n', "main.ts").strings).toEqual([]);
  });

  it("reports a syntax error with the file name", () => {
    expect(() => scanTypeScript("const = ;", "broken.ts")).toThrow(/broken\.ts/);
  });
});

describe("scanPython", () => {
  it("finds string literals and model_id roles", async () => {
    const facts = await scanPython(
      [
        "# claude-haiku-4-5 in a comment",
        'BASE = "https://api.saygm.com/v1"',
        'model = model_id("claude")',
        "other = model_id(role)",
        'f"{x}https://api.saygm.com"',
      ].join("\n"),
      "main.py",
    );
    expect(facts.strings).toEqual(
      expect.arrayContaining([
        { value: "https://api.saygm.com/v1", line: 2 },
        { value: "https://api.saygm.com", line: 5 },
      ]),
    );
    expect(facts.strings.map((s) => s.value)).not.toContain("claude-haiku-4-5 in a comment");
    expect(facts.roles).toEqual([
      { role: "claude", line: 3 },
      { role: null, line: 4 },
    ]);
  });

  it("reports a syntax error with the file name", async () => {
    await expect(scanPython("def (:\n", "broken.py")).rejects.toThrow(/broken\.py/);
  });
});

const facts = (strings: Array<[string, number]>, roles: Array<[string | null, number]> = []) => ({
  file: "examples/x/main.ts",
  strings: strings.map(([value, line]) => ({ value, line })),
  roles: roles.map(([role, line]) => ({ role, line })),
});

describe("checkDrift", () => {
  it("passes for catalog base URLs and known roles", () => {
    expect(
      checkDrift(catalog, [
        facts(
          [
            ["https://api.saygm.com/v1", 1],
            ["https://api.saygm.com", 2],
          ],
          [["claude", 3]],
        ),
      ]),
    ).toEqual([]);
  });

  it("flags a hard-coded model id", () => {
    expect(checkDrift(catalog, [facts([["claude-haiku-4-5", 7]])])).toEqual([
      'examples/x/main.ts:7: hard-coded model id "claude-haiku-4-5"; use a model role from catalog.json',
    ]);
  });

  it("flags a base URL that is not in the catalog", () => {
    for (const url of [
      "https://api.saygm.com/v1/",
      "https://api.saygm.com/v1/messages",
      "http://api.saygm.com/v1",
    ]) {
      expect(checkDrift(catalog, [facts([[url, 2]])])).toEqual([
        `examples/x/main.ts:2: base URL "${url}" is not one of https://api.saygm.com/v1, https://api.saygm.com`,
      ]);
    }
  });

  it("flags an unknown role and a role that is not a string literal", () => {
    expect(
      checkDrift(catalog, [
        facts(
          [],
          [
            ["gemini", 4],
            [null, 5],
          ],
        ),
      ]),
    ).toEqual([
      'examples/x/main.ts:4: unknown model role "gemini"',
      "examples/x/main.ts:5: model role must be a string literal so it can be checked",
    ]);
  });
});

describe("checkDrift URL and model rules", () => {
  it("flags any URL that is not a SayGM base URL", () => {
    expect(checkDrift(catalog, [facts([["https://api.openai.com/v1", 3]])])).toEqual([
      'examples/x/main.ts:3: base URL "https://api.openai.com/v1" is not one of https://api.saygm.com/v1, https://api.saygm.com',
    ]);
  });

  it("flags a model id from a known maker even after it leaves the catalog", () => {
    expect(
      checkDrift(catalog, [
        facts([
          ["claude-3-haiku", 4],
          ["qwen2.5-72b", 5],
        ]),
      ]),
    ).toEqual([
      'examples/x/main.ts:4: hard-coded model id "claude-3-haiku"; use a model role from catalog.json',
      'examples/x/main.ts:5: hard-coded model id "qwen2.5-72b"; use a model role from catalog.json',
    ]);
  });

  it("allows local URLs", () => {
    expect(
      checkDrift(catalog, [
        facts([
          ["http://127.0.0.1:", 1],
          ["http://localhost:3000", 2],
        ]),
      ]),
    ).toEqual([]);
  });

  it("flags a URL that only looks local", () => {
    for (const url of [
      "http://localhost:password@example.com/v1",
      "http://localhost.example.com/v1",
      "https://localhost/",
    ]) {
      expect(checkDrift(catalog, [facts([[url, 1]])])).toHaveLength(1);
    }
  });

  it("allows ordinary hyphenated strings", () => {
    expect(
      checkDrift(catalog, [
        facts([
          ["get-weather", 1],
          ["light rain", 2],
          ["text/event-stream", 3],
        ]),
      ]),
    ).toEqual([]);
  });
});

describe("checkDrift external URLs", () => {
  const profile = "https://cdn.jsdelivr.net/gh/taostat/saygm-cookbook@v1/profile.json";

  it("allows a URL under a prefix the example declares", () => {
    expect(
      checkDrift(catalog, [facts([[profile, 1]])], ["https://cdn.jsdelivr.net/gh/taostat/"]),
    ).toEqual([]);
  });

  it("still flags a URL outside the declared prefixes", () => {
    expect(
      checkDrift(
        catalog,
        [facts([["https://api.openai.com/v1", 2]])],
        ["https://cdn.jsdelivr.net/"],
      ),
    ).toEqual([
      'examples/x/main.ts:2: base URL "https://api.openai.com/v1" is not one of https://api.saygm.com/v1, https://api.saygm.com',
    ]);
  });

  it("allows a bare scheme that code joins to a host from a variable", () => {
    expect(checkDrift(catalog, [facts([["https://", 1]])])).toEqual([]);
  });
});

describe("externalUrls", () => {
  it("reads the declared prefixes", () => {
    expect(externalUrls({ external_urls: ["https://store.example/"] }, "c.json")).toEqual([
      "https://store.example/",
    ]);
    expect(
      externalUrls({ facts: {}, external_urls: ["https://cdn.jsdelivr.net/gh/"] }, "checks.json"),
    ).toEqual(["https://cdn.jsdelivr.net/gh/"]);
  });

  it("returns none when checks.json declares none", () => {
    expect(externalUrls({ facts: {} }, "checks.json")).toEqual([]);
  });

  it("rejects a prefix that does not end its host, which a look-alike host would match", () => {
    expect(() =>
      externalUrls({ external_urls: ["https://cdn.jsdelivr.net"] }, "checks.json"),
    ).toThrow(/checks\.json: external_urls/);
  });

  it("rejects a SayGM prefix, since SayGM URLs must match a catalog base URL exactly", () => {
    for (const prefix of [
      "https://api.saygm.com/",
      "https://saygm.com/v1",
      "http://x.saygm.com/",
      "https://API.SAYGM.COM/",
      "https://saygm.com./",
    ]) {
      expect(() => externalUrls({ external_urls: [prefix] }, "checks.json")).toThrow(
        /checks\.json: external_urls cannot include SayGM/,
      );
    }
  });

  it("rejects a prefix without a host, which would allow every URL", () => {
    for (const bad of [["https://"], ["cdn.jsdelivr.net"], "https://x.dev/", [1]]) {
      expect(() => externalUrls({ external_urls: bad }, "checks.json")).toThrow(
        /checks\.json: external_urls/,
      );
    }
  });
});
