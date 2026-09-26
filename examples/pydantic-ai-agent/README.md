# Build a Pydantic AI agent with tools

Tutorial: https://saygm.com/developers/tutorials/pydantic-ai-agent

This example builds a Pydantic AI agent with a `get_weather` tool. It runs the agent on an open
model through the OpenAI provider, then runs the same agent on Claude through the Anthropic
provider. One SayGM key covers both.

## Run it

You need Python 3.13, uv, and a SayGM key.

```bash
export SAYGM_API_KEY="your SayGM key"
cd examples/pydantic-ai-agent
uv run main.py
```

## What to know

- `OpenAIProvider` takes `base_url="https://api.saygm.com/v1"`. `OpenAIChatModel` calls Chat
  Completions, which open models on SayGM serve.
- `AnthropicProvider` takes `base_url="https://api.saygm.com"` and the same key. Use it for every
  Claude model.
- The models come from the `chat_cheap` and `claude` roles in
  [`catalog.json`](../../catalog.json). Set `SAYGM_MODEL_CHAT_CHEAP` or `SAYGM_MODEL_CLAUDE` to
  try others.
