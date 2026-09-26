# How to build an AI agent with Claude in Python

Tutorial: https://saygm.com/developers/tutorials/build-ai-agent-claude-python

This example builds a small agent with the Anthropic Python SDK: Claude gets two tools, calls
them as it needs, and the loop feeds each result back until Claude answers. It runs on SayGM
with a SayGM key.

## Run it

You need Python 3.13, uv, and a SayGM key.

```bash
export SAYGM_API_KEY="your SayGM key"
cd examples/build-ai-agent-claude-python
uv run main.py
```

## What to know

- Set `base_url="https://api.saygm.com"`. The SDK appends `/v1/messages`.
- The loop in `run_agent()` stops when Claude answers without asking for a tool, and after
  `max_turns` as a safety limit.
- Each tool result goes back as a `tool_result` block that names the `tool_use_id` it answers.
- The model comes from the `claude` role in [`catalog.json`](../../catalog.json). Set
  `SAYGM_MODEL_CLAUDE` to try another Claude model.
