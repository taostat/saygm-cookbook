# Stream a chat reply with the Vercel AI SDK

Tutorial: https://saygm.com/developers/tutorials/vercel-ai-sdk-chat

This example streams a reply from an open model through SayGM with `streamText`, then streams a
second reply from Claude with `@ai-sdk/anthropic`. One SayGM key covers both.

## Run it

You need Node 22.18 or later, pnpm, and a SayGM key.

```bash
export SAYGM_API_KEY="your SayGM key"
pnpm install
cd examples/vercel-ai-sdk-chat
pnpm start
```

## What to know

- `createOpenAI()` points at `https://api.saygm.com/v1`. Call `saygm.chat(model)` to use Chat
  Completions, which open models on SayGM serve. `saygm(model)` calls the Responses API, which
  suits GPT models.
- `createAnthropic()` takes `https://api.saygm.com/v1` as its base URL. The provider appends
  `/messages`.
- Claude models use the Messages API, so reach them through `@ai-sdk/anthropic`.
- The model for each role comes from [`catalog.json`](../../catalog.json). Set
  `SAYGM_MODEL_CHAT_CHEAP` or `SAYGM_MODEL_CLAUDE` to try another model.
