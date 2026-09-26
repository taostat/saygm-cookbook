# Build an AI chatbot for your website with the Vercel AI SDK

Tutorial: https://saygm.com/developers/tutorials/vercel-ai-sdk-website-chatbot

This example is a small website chatbot: a Node server with a streaming chat route, a page with
a chat box, and a client function that shows the reply as it arrives. The route runs on an open
model through SayGM, and a second route shows the same chatbot on Claude. One SayGM key covers
both.

## Run it

You need Node 22.18 or later, pnpm, and a SayGM key.

```bash
export SAYGM_API_KEY="your SayGM key"
pnpm install
cd examples/vercel-ai-sdk-website-chatbot
pnpm start
```

Then open http://localhost:3000.

## What to know

- `createOpenAI()` points at `https://api.saygm.com/v1`. Call `saygm.chat(model)` for open
  models, which serve Chat Completions. `saygm(model)` calls the Responses API, which suits GPT
  models.
- `createAnthropic()` takes `https://api.saygm.com/v1` as its base URL and reaches every Claude
  model.
- The route keeps only user and assistant text messages, keeps the last 20, and caps the request
  size, so a visitor cannot inject a system prompt or send an unbounded history.
- The server listens on `127.0.0.1` only. Every chat request spends from your SayGM balance, so
  add sign-in and rate limits before you put the route on the public internet.
- The route only accepts `application/json`, which a browser cannot send from another site
  without a CORS preflight that this server never approves.
- The route streams plain text from `result.fullStream`. When the model call fails it answers
  502, or cuts the stream if text has already gone out, and the page shows an error instead of
  an empty reply. `chat.js` reads the stream with a reader and appends each piece to the page.
- The models come from the `chat_cheap` and `claude` roles in
  [`catalog.json`](../../catalog.json). Set `SAYGM_MODEL_CHAT_CHEAP` or `SAYGM_MODEL_CLAUDE` to
  try others.
