# Pydantic AI with Claude, GPT and open models on one key

Tutorial: https://saygm.com/developers/tutorials/pydantic-ai-any-model

This example builds one Pydantic AI agent with a `get_weather` tool and runs it on three models
with one SayGM key: an open model through Chat Completions, a GPT model through the Responses
API, and Claude through the Anthropic provider.

## Run it

You need Python 3.13, uv, and a SayGM key.

```bash
export SAYGM_API_KEY="your SayGM key"
cd examples/pydantic-ai-any-model
uv run main.py
```

## What to know

- `OpenAIProvider` takes `base_url="https://api.saygm.com/v1"`. Use `OpenAIChatModel` for open
  models, which serve Chat Completions, and `OpenAIResponsesModel` for GPT models.
- `AnthropicProvider` takes `base_url="https://api.saygm.com"` and the same key. Use it for every
  Claude model.
- `agent.run_sync(..., model=...)` swaps the model for one run and keeps the agent's tools.
- The models come from the `chat_cheap`, `responses_tools` and `claude` roles in
  [`catalog.json`](../../catalog.json). Set `SAYGM_MODEL_<ROLE>` to try others.
