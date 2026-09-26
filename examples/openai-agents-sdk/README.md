# Build an agent with tools using the OpenAI Agents SDK

Tutorial: https://saygm.com/developers/tutorials/openai-agents-sdk

This example builds an OpenAI Agents SDK agent with one function tool and runs it on SayGM
through the Responses API.

## Run it

You need Python 3.13, uv, and a SayGM key.

```bash
export SAYGM_API_KEY="your SayGM key"
cd examples/openai-agents-sdk
uv run main.py
```

## What to know

- `set_default_openai_client()` sends every model call to `https://api.saygm.com/v1` with your
  SayGM key.
- `use_for_tracing=False` keeps your SayGM key out of trace uploads, and
  `set_tracing_disabled(disabled=True)` turns trace export off, so no trace data leaves your
  machine.
- The Agents SDK uses the Responses API by default. The `responses_tools` role in
  [`catalog.json`](../../catalog.json) picks a model that serves it. Set
  `SAYGM_MODEL_RESPONSES_TOOLS` to try another.
