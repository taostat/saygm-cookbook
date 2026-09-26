import { appendFileSync } from "node:fs";

export interface TokenCounts {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

type Json = Record<string, unknown>;

const METERED_HOST = "api.saygm.com";
const METERED_PATHS = ["/chat/completions", "/responses", "/messages"];

const pending = new Set<Promise<void>>();

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function optionalCount(value: unknown): number | null {
  return value === undefined || value === null ? 0 : isCount(value) ? value : null;
}

function asObject(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function tokenCounts(
  input: unknown,
  output: unknown,
  cacheRead: unknown = 0,
  cacheWrite: unknown = 0,
) {
  const read = optionalCount(cacheRead);
  const write = optionalCount(cacheWrite);
  if (!isCount(input) || !isCount(output) || read === null || write === null) {
    return null;
  }
  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: read,
    cache_creation_input_tokens: write,
  };
}

// Chat Completions prompt_tokens already include cached tokens, so they are all priced as input.
function countsFromUsage(path: string, usage: unknown): TokenCounts | null {
  const fields = asObject(usage);
  if (fields === null) {
    return null;
  }
  if (path.endsWith("/chat/completions")) {
    return tokenCounts(fields["prompt_tokens"], fields["completion_tokens"]);
  }
  if (path.endsWith("/messages")) {
    return tokenCounts(
      fields["input_tokens"],
      fields["output_tokens"],
      fields["cache_read_input_tokens"],
      fields["cache_creation_input_tokens"],
    );
  }
  return tokenCounts(fields["input_tokens"], fields["output_tokens"]);
}

/** Reads token usage from a non-streamed Chat Completions, Responses or Messages body. */
export function usageFromJson(path: string, body: unknown): TokenCounts | null {
  return countsFromUsage(path, asObject(body)?.["usage"]);
}

function sseEvents(text: string): Json[] {
  const events: Json[] = [];
  for (const line of text.replaceAll("\r\n", "\n").split("\n")) {
    const data = line.startsWith("data:") ? line.slice("data:".length).trim() : "";
    if (data === "" || data === "[DONE]") {
      continue;
    }
    try {
      const event = asObject(JSON.parse(data));
      if (event !== null) {
        events.push(event);
      }
    } catch {
      continue;
    }
  }
  return events;
}

/** Reads token usage from a streamed Chat Completions, Responses or Messages body. */
export function usageFromSse(path: string, text: string): TokenCounts | null {
  const events = sseEvents(text);
  if (path.endsWith("/messages")) {
    const start = events.find((event) => event["type"] === "message_start");
    const deltas = events.filter((event) => event["type"] === "message_delta");
    const startUsage = asObject(asObject(start?.["message"])?.["usage"]);
    const stopped = events.some((event) => event["type"] === "message_stop");
    const failed = events.some((event) => event["type"] === "error");
    // Usage in an interrupted stream is interim, so only a completed stream is priced.
    const finalOutput = asObject(deltas.at(-1)?.["usage"])?.["output_tokens"];
    if (startUsage === null || !isCount(finalOutput) || !stopped || failed) {
      return null;
    }
    // message_delta usage is cumulative and may update any counter, so apply each in order.
    const usage: Json = { ...startUsage };
    for (const delta of deltas) {
      for (const [field, value] of Object.entries(asObject(delta["usage"]) ?? {})) {
        if (value !== null && value !== undefined) {
          usage[field] = value;
        }
      }
    }
    return countsFromUsage(path, usage);
  }
  if (path.endsWith("/responses")) {
    const completed = events.find((event) => event["type"] === "response.completed");
    return countsFromUsage(path, asObject(completed?.["response"])?.["usage"]);
  }
  const withUsage = events.filter((event) => asObject(event["usage"]) !== null);
  return countsFromUsage(path, withUsage.at(-1)?.["usage"]);
}

function requestModel(body: unknown): string {
  if (typeof body !== "string") {
    return "unknown";
  }
  try {
    const model = asObject(JSON.parse(body))?.["model"];
    return typeof model === "string" ? model : "unknown";
  } catch {
    return "unknown";
  }
}

async function recordResponse(
  response: Response,
  path: string,
  write: (record: object) => void,
  id: number,
  model: string,
) {
  if (!response.ok) {
    write({ kind: "no_charge", id, status: response.status });
    return;
  }
  const streamed = (response.headers.get("content-type") ?? "").includes("text/event-stream");
  const text = await response.text();
  let counts: TokenCounts | null = null;
  if (streamed) {
    counts = usageFromSse(path, text);
  } else {
    try {
      counts = usageFromJson(path, JSON.parse(text));
    } catch {
      counts = null;
    }
  }
  write(
    counts === null
      ? { kind: "unmetered", id, reason: "response has no usage" }
      : { kind: "usage", id, model, ...counts },
  );
}

/**
 * Wraps fetch so every SayGM generation call appends its request and token usage to a report file.
 *
 * A call is recorded before it is sent, then resolved as usage, no charge (error status) or
 * unmetered, so the runner can tell when a call's cost is unknown.
 */
export function meteredFetch(base: typeof fetch, reportPath: string): typeof fetch {
  let nextId = 0;
  const write = (record: object): void => appendFileSync(reportPath, `${JSON.stringify(record)}\n`);
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const metered =
      url.host === METERED_HOST && METERED_PATHS.some((path) => url.pathname.endsWith(path));
    if (!metered) {
      return base(input, init);
    }
    nextId += 1;
    const id = nextId;
    const model = requestModel(init?.body);
    write({ kind: "request", id, model, path: url.pathname });
    const response = await base(input, init);
    const recording = recordResponse(response.clone(), url.pathname, write, id, model).catch(
      (error: unknown) => {
        write({ kind: "unmetered", id, reason: `cannot read response: ${String(error)}` });
      },
    );
    pending.add(recording);
    void recording.finally(() => pending.delete(recording));
    return response;
  };
}

/** Waits until every metered response has been recorded. */
export async function flushMeter(): Promise<void> {
  await Promise.all(pending);
}

/** Replaces globalThis.fetch with a metered fetch when the runner sets SAYGM_REPORT_FILE. */
export function installMeter(env: Record<string, string | undefined> = process.env): void {
  const reportPath = env["SAYGM_REPORT_FILE"];
  if (reportPath) {
    globalThis.fetch = meteredFetch(globalThis.fetch, reportPath);
  }
}
