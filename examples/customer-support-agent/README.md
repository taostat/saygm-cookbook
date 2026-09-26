# Build a customer support agent

Tutorial: https://saygm.com/developers/tutorials/customer-support-agent

This example builds a support agent for a small online shop with Pydantic AI and one SayGM key.
An open model answers routine questions with two tools: an order lookup and a policy search over
the sample data in `orders.json` and `faq.json`. Refund requests, and answers the open model is
unsure of, go to Claude.

## Run it

You need Python 3.13, uv, and a SayGM key.

```bash
export SAYGM_API_KEY="your SayGM key"
cd examples/customer-support-agent
uv run main.py
```

## What to know

- The escalation rule is plain code in `answer()`: the open model returns its answer with an
  `intent` and a `confident` flag, and a refund intent or low confidence sends the same question
  to Claude with the same tools.
- The signed-in customer's email comes from your app's session, not from the chat. It reaches
  `lookup_order` as the run's `deps`, so the agent only sees that customer's orders, whatever the
  message says.
- Open models serve Chat Completions through `OpenAIProvider` at `https://api.saygm.com/v1`.
  Claude uses the Messages API through `AnthropicProvider` at `https://api.saygm.com`.
- Where customer data goes: every request goes through the SayGM gateway, which runs sealed in a
  trusted execution environment. Confidential open models (ids ending in `-tee`) also run fully
  sealed. Requests to Claude go on to Anthropic and no one in between. Pick the model for each
  step with that in mind.
- The models come from the `chat_cheap` and `claude` roles in
  [`catalog.json`](../../catalog.json). Set `SAYGM_MODEL_CHAT_CHEAP` or `SAYGM_MODEL_CLAUDE` to
  try others.
