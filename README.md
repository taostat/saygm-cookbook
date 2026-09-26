<p align="center"><a href="https://saygm.com"><img src=".github/assets/saygm-logo.svg" alt="SayGM" width="96" height="96"></a></p>

# SayGM cookbook

Runnable recipes for building with Claude, GPT and open models on one SayGM key.

## Recipes

| Recipe                                                       | Language   | Tutorial                                                                      | Folder                                                                      |
| ------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| An AI agent with tools on Claude, using the Anthropic SDK    | Python     | [Read](https://saygm.com/developers/tutorials/build-ai-agent-claude-python)   | [`build-ai-agent-claude-python`](examples/build-ai-agent-claude-python)     |
| A support agent that hands refunds and hard cases to Claude  | Python     | [Read](https://saygm.com/developers/tutorials/customer-support-agent)         | [`customer-support-agent`](examples/customer-support-agent)                 |
| OpenAI Agents SDK agents on GPT and on open models           | Python     | [Read](https://saygm.com/developers/tutorials/openai-agents-sdk-other-models) | [`openai-agents-sdk-other-models`](examples/openai-agents-sdk-other-models) |
| One Pydantic AI agent on open, GPT and Claude models         | Python     | [Read](https://saygm.com/developers/tutorials/pydantic-ai-any-model)          | [`pydantic-ai-any-model`](examples/pydantic-ai-any-model)                   |
| A Shopify store assistant that searches the catalog over UCP | Python     | [Read](https://saygm.com/developers/tutorials/shopify-store-assistant)        | [`shopify-store-assistant`](examples/shopify-store-assistant)               |
| A website chatbot with a streaming reply                     | TypeScript | [Read](https://saygm.com/developers/tutorials/vercel-ai-sdk-website-chatbot)  | [`vercel-ai-sdk-website-chatbot`](examples/vercel-ai-sdk-website-chatbot)   |

## Quickstart

You need a SayGM key from [saygm.com](https://saygm.com). Python recipes need Python 3.13 and
[uv](https://docs.astral.sh/uv/). TypeScript recipes need Node 22.18 or later and pnpm.

```bash
git clone https://github.com/taostat/saygm-cookbook.git
cd saygm-cookbook
export SAYGM_API_KEY="your SayGM key"

# Python
(cd examples/build-ai-agent-claude-python && uv run main.py)

# TypeScript
pnpm install
(cd examples/vercel-ai-sdk-website-chatbot && pnpm start)
```

Each recipe folder has its own README with what it does and what to know.

## Base URLs

| SDK                                                                           | Base URL                   |
| ----------------------------------------------------------------------------- | -------------------------- |
| OpenAI SDK, OpenAI Agents SDK, Pydantic AI `OpenAIProvider`, `@ai-sdk/openai` | `https://api.saygm.com/v1` |
| Anthropic SDK, Pydantic AI `AnthropicProvider`                                | `https://api.saygm.com`    |
| `@ai-sdk/anthropic`                                                           | `https://api.saygm.com/v1` |

Use an Anthropic client for Claude models, which serve the Messages API.

## Swap the model

Each recipe picks its models by role, such as `claude` or `chat_cheap`, from
[`catalog.json`](catalog.json). To try another model, set `SAYGM_MODEL_<ROLE>`:

```bash
(cd examples/build-ai-agent-claude-python && SAYGM_MODEL_CLAUDE=claude-sonnet-5 uv run main.py)
```

The full model list, with prices and the APIs each model serves, is at
`https://api.saygm.com/v1/models`.

## Tested against the live API

Every recipe runs against the live SayGM API in CI, and each tutorial page shows the date of the
last passing run. [CONTRIBUTING.md](CONTRIBUTING.md) explains how.

## License

[MIT](LICENSE)
