import "@saygm-examples/shared/install-meter";
import { modelId, reportFact } from "@saygm-examples/shared";
// region: setup
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const apiKey = process.env.SAYGM_API_KEY;
if (!apiKey) {
  throw new Error("Set SAYGM_API_KEY to your SayGM key.");
}

const client = new Anthropic({
  baseURL: "https://api.saygm.com",
  apiKey,
  // The SDK would otherwise also send an ANTHROPIC_AUTH_TOKEN from your shell.
  authToken: null,
});
const model = modelId("claude");
// endregion

// region: tool
const tools: Anthropic.Tool[] = [
  {
    name: "get_weather",
    description: "Get the current weather for a city.",
    input_schema: {
      type: "object",
      properties: {
        city: { type: "string", description: "The city name, for example Paris" },
      },
      required: ["city"],
    },
  },
];

function getWeather(city: string): string {
  return JSON.stringify({ city, temperature_c: 18, conditions: "light rain" });
}
// endregion

// region: ask
const messages: Anthropic.MessageParam[] = [
  { role: "user", content: "What is the weather in Paris right now? Should I take an umbrella?" },
];

const first = await client.messages.create({ model, max_tokens: 1024, tools, messages });
// endregion
reportFact("tool_calls", first.content.filter((block) => block.type === "tool_use").length);

// region: answer
const toolResults: Anthropic.ToolResultBlockParam[] = [];
for (const block of first.content) {
  if (block.type === "tool_use" && block.name === "get_weather") {
    const { city } = block.input as { city: string };
    toolResults.push({ type: "tool_result", tool_use_id: block.id, content: getWeather(city) });
  }
}

messages.push({ role: "assistant", content: first.content });
messages.push({ role: "user", content: toolResults });

const second = await client.messages.create({ model, max_tokens: 1024, tools, messages });
const answer = second.content
  .filter((block) => block.type === "text")
  .map((block) => block.text)
  .join("");
console.log(answer);
// endregion
reportFact("answered", answer.length > 0);

// region: structured
const Forecast = z.object({
  city: z.string(),
  temperature_c: z.number(),
  conditions: z.string(),
  take_umbrella: z.boolean(),
});

const parsed = await client.messages.parse({
  model,
  max_tokens: 1024,
  messages: [{ role: "user", content: `Extract the forecast from this answer:\n\n${answer}` }],
  output_config: { format: zodOutputFormat(Forecast) },
});

const forecast = parsed.parsed_output;
console.log(forecast);
// endregion
reportFact("schema_valid", Forecast.safeParse(forecast).success);
reportFact("take_umbrella", forecast?.take_umbrella);
