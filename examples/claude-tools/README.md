# Claude with tools and structured output

Tutorial: https://saygm.com/developers/tutorials/claude-tools

This example uses the Anthropic SDK with a SayGM key. Claude calls a `get_weather` tool, the
example returns the tool result, and Claude answers. A final call turns that answer into typed
data with a Zod schema and `messages.parse()`.

## Run it

You need Node 22.18 or later, pnpm, and a SayGM key.

```bash
export SAYGM_API_KEY="your SayGM key"
pnpm install
cd examples/claude-tools
pnpm start
```

## What to know

- Set `baseURL` to `https://api.saygm.com`. The SDK appends `/v1/messages`.
- Pass `authToken: null` so an `ANTHROPIC_AUTH_TOKEN` in your shell stays out of SayGM requests.
- Use the Anthropic SDK for every Claude model. Claude models serve the Messages API.
- The model comes from the `claude` role in [`catalog.json`](../../catalog.json). Set
  `SAYGM_MODEL_CLAUDE` to try another Claude model.
