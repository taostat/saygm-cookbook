# OpenAI Agents SDK with other models

Tutorial: https://saygm.com/developers/tutorials/openai-agents-sdk-other-models

This example runs two OpenAI Agents SDK agents on one SayGM key and one client: one on a GPT
model through the Responses API, and one on an open model through Chat Completions. Both share a
`get_weather` function tool.

## Run it

You need Python 3.13, uv, and a SayGM key.

```bash
export SAYGM_API_KEY="your SayGM key"
cd examples/openai-agents-sdk-other-models
uv run main.py
```

## What to know

- `set_default_openai_client()` sends every model call to `https://api.saygm.com/v1` with your
  SayGM key. `use_for_tracing=False` keeps the key out of trace uploads, and
  `set_tracing_disabled(disabled=True)` turns trace export off.
- A model name on its own uses the Responses API. GPT models on SayGM serve it.
- Open models on SayGM serve Chat Completions. Wrap them in `OpenAIChatCompletionsModel` with the
  same client, and give each agent the model it needs.
- `https://api.saygm.com/v1/models` lists the APIs each model serves in `api_shapes`.
- The models come from the `responses_tools` and `chat_cheap` roles in
  [`catalog.json`](../../catalog.json). Set `SAYGM_MODEL_RESPONSES_TOOLS` or
  `SAYGM_MODEL_CHAT_CHEAP` to try others.
