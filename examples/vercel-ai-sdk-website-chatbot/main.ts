import "@saygm-cookbook/shared/install-meter";
import { once } from "node:events";
import { modelId, reportFact } from "@saygm-cookbook/shared";
import { streamChat } from "./chat.js";
// region: setup
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import type { LanguageModel, ModelMessage } from "ai";

const apiKey = process.env.SAYGM_API_KEY;
if (!apiKey) {
  throw new Error("Set SAYGM_API_KEY to your SayGM key.");
}

const saygm = createOpenAI({ baseURL: "https://api.saygm.com/v1", apiKey });
const anthropic = createAnthropic({ baseURL: "https://api.saygm.com/v1", apiKey });
// endregion

const selfTest = Boolean(process.env["SAYGM_REPORT_FILE"]);
if (selfTest) {
  process.env.PORT = "0";
}

// region: route
const MAX_BODY_BYTES = 64_000;
const MAX_MESSAGES = 20;

async function readMessages(request: IncomingMessage): Promise<ModelMessage[]> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("Request body too large");
    }
    chunks.push(chunk);
  }
  const { messages } = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    messages: unknown[];
  };
  return messages
    .filter(
      (message): message is ModelMessage =>
        typeof message === "object" &&
        message !== null &&
        "role" in message &&
        (message.role === "user" || message.role === "assistant") &&
        "content" in message &&
        typeof message.content === "string",
    )
    .slice(-MAX_MESSAGES);
}

function chatRoute(model: LanguageModel) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    // A JSON content type forces a CORS preflight, so other sites cannot post to this route.
    const [contentType] = (request.headers["content-type"] ?? "").split(";");
    if (contentType?.trim() !== "application/json") {
      response.writeHead(415).end();
      return;
    }
    const result = streamText({
      model,
      system: "You are a friendly assistant on an online shop's website. Keep answers short.",
      messages: await readMessages(request),
      maxOutputTokens: 400,
    });
    for await (const part of result.fullStream) {
      if (part.type === "error") {
        console.error(part.error);
        if (response.headersSent) {
          response.destroy();
        } else {
          response.writeHead(502).end();
        }
        return;
      }
      if (part.type === "text-delta") {
        if (!response.headersSent) {
          response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        }
        response.write(part.text);
      }
    }
    response.end();
  };
}
// endregion

// region: routes
const routes: Record<string, ReturnType<typeof chatRoute>> = {
  "/api/chat": chatRoute(saygm.chat(modelId("chat_cheap"))),
};
// endregion

// region: claude
routes["/api/chat/claude"] = chatRoute(anthropic(modelId("claude")));
// endregion

// region: listen
const files: Record<string, [string, string]> = {
  "/": ["index.html", "text/html"],
  "/chat.js": ["chat.js", "text/javascript"],
};

const server = createServer(async (request, response) => {
  const route = routes[request.url ?? ""];
  const file = files[request.url ?? ""];
  try {
    if (request.method === "POST" && route) {
      await route(request, response);
    } else if (request.method === "GET" && file) {
      const [name, type] = file;
      response.writeHead(200, { "content-type": type });
      response.end(await readFile(new URL(name, import.meta.url)));
    } else {
      response.writeHead(404).end();
    }
  } catch (error) {
    console.error(error);
    response.writeHead(400).end();
  }
});

server.listen(Number(process.env.PORT ?? 3000), "127.0.0.1", () => {
  const { port } = server.address() as AddressInfo;
  console.log(`Chatbot running at http://localhost:${port}`);
});
// endregion

if (selfTest) {
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  const question = [
    { role: "user" as const, content: "Do you ship to Canada? Answer in two sentences." },
  ];

  let chunks = 0;
  const reply = await streamChat(`${base}/api/chat`, question, () => {
    chunks += 1;
  });
  console.log(`Open model: ${reply}`);
  reportFact("open_model_chunks", chunks);

  const claudeReply = await streamChat(`${base}/api/chat/claude`, question, () => {});
  console.log(`Claude: ${claudeReply}`);
  reportFact("claude_answered", claudeReply.length > 0);

  const page = await (await fetch(`${base}/`)).text();
  reportFact("page_loads_client", page.includes('from "/chat.js"'));

  server.closeAllConnections();
  server.close();
}
