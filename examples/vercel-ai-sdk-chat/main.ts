import "@saygm-examples/shared/install-meter";
import { modelId, reportFact } from "@saygm-examples/shared";
// region: setup
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

const apiKey = process.env.SAYGM_API_KEY;
if (!apiKey) {
  throw new Error("Set SAYGM_API_KEY to your SayGM key.");
}

const saygm = createOpenAI({ baseURL: "https://api.saygm.com/v1", apiKey });
// endregion

async function countChunks(stream: AsyncIterable<string>): Promise<number> {
  let chunks = 0;
  for await (const text of stream) {
    chunks += text === "" ? 0 : 1;
  }
  return chunks;
}

// region: stream
const result = streamText({
  model: saygm.chat(modelId("chat_cheap")),
  system: "You are a concise assistant.",
  prompt: "In three short sentences, explain what a streaming API response is.",
  maxOutputTokens: 300,
});
// endregion
const chunks = countChunks(result.textStream);

// region: print
for await (const text of result.textStream) {
  process.stdout.write(text);
}
process.stdout.write("\n");
// endregion
reportFact("open_model_chunks", await chunks);

// region: claude
const anthropic = createAnthropic({ baseURL: "https://api.saygm.com/v1", apiKey });

const claude = streamText({
  model: anthropic(modelId("claude")),
  prompt: "In one sentence, say hello to a developer trying SayGM.",
  maxOutputTokens: 200,
});

for await (const text of claude.textStream) {
  process.stdout.write(text);
}
process.stdout.write("\n");
// endregion
reportFact("claude_text", (await claude.text).length > 0);
