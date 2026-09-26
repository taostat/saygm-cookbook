import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  flushMeter,
  meteredFetch,
  usageFromJson,
  usageFromSse,
} from "@saygm-examples/shared/meter";

const counts = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
});

describe("usageFromJson", () => {
  it("reads Chat Completions usage, counting cached prompt tokens as input", () => {
    const body = {
      usage: {
        prompt_tokens: 10,
        completion_tokens: 4,
        prompt_tokens_details: { cached_tokens: 6 },
      },
    };
    expect(usageFromJson("/v1/chat/completions", body)).toEqual(counts(10, 4));
  });

  it("reads Responses usage", () => {
    expect(
      usageFromJson("/v1/responses", { usage: { input_tokens: 7, output_tokens: 3 } }),
    ).toEqual(counts(7, 3));
  });

  it("reads Messages usage with cache reads and writes", () => {
    const body = {
      usage: {
        input_tokens: 5,
        output_tokens: 2,
        cache_read_input_tokens: 8,
        cache_creation_input_tokens: 9,
      },
    };
    expect(usageFromJson("/v1/messages", body)).toEqual(counts(5, 2, 8, 9));
  });

  it("treats null Messages cache counters as zero", () => {
    const body = { usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: null } };
    expect(usageFromJson("/v1/messages", body)).toEqual(counts(5, 2));
  });

  it("returns null when usage is missing or malformed", () => {
    expect(usageFromJson("/v1/responses", {})).toBeNull();
    expect(
      usageFromJson("/v1/responses", { usage: { input_tokens: -1, output_tokens: 1 } }),
    ).toBeNull();
    expect(
      usageFromJson("/v1/chat/completions", {
        usage: { prompt_tokens: 1.5, completion_tokens: 1 },
      }),
    ).toBeNull();
  });
});

const sse = (events: Array<[string | null, unknown]>): string =>
  events
    .map(
      ([event, data]) =>
        `${event === null ? "" : `event: ${event}\n`}data: ${JSON.stringify(data)}\n\n`,
    )
    .join("");

describe("usageFromSse", () => {
  it("reads the usage chunk at the end of a Chat Completions stream", () => {
    const text =
      sse([
        [null, { choices: [{ delta: { content: "hi" } }], usage: null }],
        [null, { choices: [], usage: { prompt_tokens: 12, completion_tokens: 30 } }],
      ]) + "data: [DONE]\n\n";
    expect(usageFromSse("/v1/chat/completions", text)).toEqual(counts(12, 30));
  });

  it("reads usage from response.completed in a Responses stream", () => {
    const text = sse([
      ["response.output_text.delta", { type: "response.output_text.delta", delta: "hi" }],
      [
        "response.completed",
        { type: "response.completed", response: { usage: { input_tokens: 9, output_tokens: 4 } } },
      ],
    ]);
    expect(usageFromSse("/v1/responses", text)).toEqual(counts(9, 4));
  });

  it("combines message_start input with the last message_delta output in a Messages stream", () => {
    const text = sse([
      [
        "message_start",
        {
          type: "message_start",
          message: { usage: { input_tokens: 20, output_tokens: 1, cache_read_input_tokens: 3 } },
        },
      ],
      ["content_block_delta", { type: "content_block_delta" }],
      ["message_delta", { type: "message_delta", usage: { output_tokens: 15 } }],
      ["message_delta", { type: "message_delta", usage: { output_tokens: 42 } }],
      ["message_stop", { type: "message_stop" }],
    ]);
    expect(usageFromSse("/v1/messages", text)).toEqual(counts(20, 42, 3));
  });

  it("applies cumulative input and cache counts from message_delta", () => {
    const text = sse([
      [
        "message_start",
        { type: "message_start", message: { usage: { input_tokens: 1, output_tokens: 1 } } },
      ],
      [
        "message_delta",
        {
          type: "message_delta",
          usage: {
            input_tokens: 1000,
            output_tokens: 5,
            cache_read_input_tokens: 2000,
            cache_creation_input_tokens: 3000,
          },
        },
      ],
      ["message_delta", { type: "message_delta", usage: { output_tokens: 9, input_tokens: null } }],
      ["message_stop", { type: "message_stop" }],
    ]);
    expect(usageFromSse("/v1/messages", text)).toEqual(counts(1000, 9, 2000, 3000));
  });

  it("returns null for a Messages stream that ends early or errors", () => {
    const start: [string, unknown] = [
      "message_start",
      { type: "message_start", message: { usage: { input_tokens: 3, output_tokens: 1 } } },
    ];
    const delta: [string, unknown] = [
      "message_delta",
      { type: "message_delta", usage: { output_tokens: 7 } },
    ];
    expect(usageFromSse("/v1/messages", sse([start, delta]))).toBeNull();
    const error: [string, unknown] = [
      "error",
      { type: "error", error: { type: "overloaded_error" } },
    ];
    expect(
      usageFromSse(
        "/v1/messages",
        sse([start, delta, error, ["message_stop", { type: "message_stop" }]]),
      ),
    ).toBeNull();
  });

  it("returns null when the last message_delta has no output count", () => {
    const text = sse([
      [
        "message_start",
        { type: "message_start", message: { usage: { input_tokens: 3, output_tokens: 1 } } },
      ],
      ["message_delta", { type: "message_delta", usage: {} }],
      ["message_stop", { type: "message_stop" }],
    ]);
    expect(usageFromSse("/v1/messages", text)).toBeNull();
  });

  it("returns null for a stream that never reports usage", () => {
    expect(usageFromSse("/v1/chat/completions", sse([[null, { choices: [] }]]))).toBeNull();
    expect(
      usageFromSse("/v1/messages", sse([["message_delta", { usage: { output_tokens: 3 } }]])),
    ).toBeNull();
  });

  it("handles CRLF line endings", () => {
    const text = sse([[null, { usage: { prompt_tokens: 1, completion_tokens: 2 } }]]).replaceAll(
      "\n",
      "\r\n",
    );
    expect(usageFromSse("/v1/chat/completions", text)).toEqual(counts(1, 2));
  });
});

const reportLines = (path: string): unknown[] =>
  readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

const newReport = (): string => join(mkdtempSync(join(tmpdir(), "meter-")), "report.ndjson");

const fakeFetch =
  (response: () => Response): typeof fetch =>
  async () =>
    response();

const post = (fetcher: typeof fetch, url: string, model = "m") =>
  fetcher(url, { method: "POST", body: JSON.stringify({ model }) });

describe("meteredFetch", () => {
  it("records a request and its usage for a SayGM generation call", async () => {
    const report = newReport();
    const upstream = fakeFetch(() =>
      Response.json({ usage: { input_tokens: 3, output_tokens: 4 } }),
    );
    const response = await post(
      meteredFetch(upstream, report),
      "https://api.saygm.com/v1/responses",
    );
    expect(await response.json()).toEqual({ usage: { input_tokens: 3, output_tokens: 4 } });
    await flushMeter();
    expect(reportLines(report)).toEqual([
      { kind: "request", id: 1, model: "m", path: "/v1/responses" },
      { kind: "usage", id: 1, model: "m", ...counts(3, 4) },
    ]);
  });

  it("meters a streamed body without disturbing the caller's copy", async () => {
    const report = newReport();
    const body = sse([[null, { choices: [], usage: { prompt_tokens: 2, completion_tokens: 5 } }]]);
    const upstream = fakeFetch(
      () => new Response(body, { headers: { "content-type": "text/event-stream" } }),
    );
    const response = await post(
      meteredFetch(upstream, report),
      "https://api.saygm.com/v1/chat/completions",
    );
    expect(await response.text()).toBe(body);
    await flushMeter();
    expect(reportLines(report)[1]).toEqual({ kind: "usage", id: 1, model: "m", ...counts(2, 5) });
  });

  it("records an error status as no charge", async () => {
    const report = newReport();
    const upstream = fakeFetch(() => Response.json({ error: "bad key" }, { status: 401 }));
    await post(meteredFetch(upstream, report), "https://api.saygm.com/v1/messages");
    await flushMeter();
    expect(reportLines(report)[1]).toEqual({ kind: "no_charge", id: 1, status: 401 });
  });

  it("records a success without usage as unmetered", async () => {
    const report = newReport();
    const upstream = fakeFetch(() => Response.json({ output: [] }));
    await post(meteredFetch(upstream, report), "https://api.saygm.com/v1/responses");
    await flushMeter();
    expect(reportLines(report)[1]).toEqual({
      kind: "unmetered",
      id: 1,
      reason: "response has no usage",
    });
  });

  it("leaves other URLs alone", async () => {
    const report = newReport();
    const upstream = fakeFetch(() => Response.json({ data: [] }));
    await meteredFetch(upstream, report)("https://api.saygm.com/v1/models");
    await meteredFetch(upstream, report)("https://example.com/v1/responses", {
      method: "POST",
      body: "{}",
    });
    expect(() => readFileSync(report)).toThrow(/ENOENT/);
  });

  it("numbers each attempt so retries are all counted", async () => {
    const report = newReport();
    const upstream = fakeFetch(() =>
      Response.json({ usage: { input_tokens: 1, output_tokens: 1 } }),
    );
    const fetcher = meteredFetch(upstream, report);
    await post(fetcher, "https://api.saygm.com/v1/responses");
    await post(fetcher, "https://api.saygm.com/v1/responses");
    await flushMeter();
    expect(
      reportLines(report).filter((line) => (line as { kind: string }).kind === "usage"),
    ).toHaveLength(2);
  });
});
