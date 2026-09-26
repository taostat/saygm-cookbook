<p align="center"><a href="https://saygm.com"><img src=".github/assets/saygm-logo.svg" alt="SayGM" width="96" height="96"></a></p>

# SayGM examples

Runnable examples for the tutorials at [saygm.com/developers/tutorials](https://saygm.com/developers/tutorials). SayGM
is an inference gateway: point the OpenAI, Anthropic or Vercel AI SDK at it and use one key for
Claude, GPT and open models.

Every code block on a tutorial page comes from a file in this repository, and CI runs that file
against the live SayGM API before the page shows it.

| Example                                             | Language   | Tutorial                                                                                              |
| --------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| [`claude-tools`](examples/claude-tools)             | TypeScript | [Claude with tools and structured output](https://saygm.com/developers/tutorials/claude-tools)        |
| [`vercel-ai-sdk-chat`](examples/vercel-ai-sdk-chat) | TypeScript | [Streaming chat with the Vercel AI SDK](https://saygm.com/developers/tutorials/vercel-ai-sdk-chat)    |
| [`openai-agents-sdk`](examples/openai-agents-sdk)   | Python     | [Agent with tools on the OpenAI Agents SDK](https://saygm.com/developers/tutorials/openai-agents-sdk) |
| [`pydantic-ai-agent`](examples/pydantic-ai-agent)   | Python     | [Pydantic AI agent](https://saygm.com/developers/tutorials/pydantic-ai-agent)                         |

## Run an example

You need a SayGM key from [saygm.com](https://saygm.com). TypeScript examples need Node 22.18 or
later and pnpm. Python examples need Python 3.13 and [uv](https://docs.astral.sh/uv/).

```bash
export SAYGM_API_KEY="your SayGM key"

# TypeScript, from the repository root
pnpm install
(cd examples/claude-tools && pnpm start)

# Python, from the repository root
(cd examples/pydantic-ai-agent && uv run main.py)
```

Each example picks its models by role from [`catalog.json`](catalog.json), for example `claude`
or `chat_cheap`. To try another model, set `SAYGM_MODEL_<ROLE>`:

```bash
(cd examples/claude-tools && SAYGM_MODEL_CLAUDE=claude-sonnet-5 pnpm start)
```

## Base URLs

| SDK                                                                           | Base URL                   |
| ----------------------------------------------------------------------------- | -------------------------- |
| OpenAI SDK, OpenAI Agents SDK, Pydantic AI `OpenAIProvider`, `@ai-sdk/openai` | `https://api.saygm.com/v1` |
| Anthropic SDK, Pydantic AI `AnthropicProvider`                                | `https://api.saygm.com`    |
| `@ai-sdk/anthropic`                                                           | `https://api.saygm.com/v1` |

Claude models use the Messages API, so reach them through an Anthropic client. The live list of
models and the APIs each one serves is at `https://api.saygm.com/v1/models`.

## How CI keeps the snippets correct

- **Catalog.** `pnpm sync-catalog` refreshes `catalog.json` from `/v1/models`: each model's API
  shapes, tool support and prices. The `roles` section names the model each example uses, and
  every role is checked against the live catalog for the right API shape and tool support.
- **Drift check.** `pnpm check-drift` parses every example and fails on a hard-coded model id, an
  unknown role, or a URL that is not a base URL in `catalog.json`. It also checks that the install
  line in each `commands.sh` pins the same versions as the example's manifest, and that its run
  line is the command CI runs.
- **Snippets.** Examples mark the code a tutorial shows with `// region: <id>` and
  `// endregion` (`# region: <id>` in Python). `pnpm extract-snippets` writes
  `snippets/<slug>.json`, which the tutorial pages render. Markers never appear in the output,
  and each `modelId("<role>")` becomes the model id CI ran, so a copied snippet runs as is.
  CI fails if the committed snippets are out of date.
- **Metering.** Each example imports a meter (`@saygm-examples/shared/install-meter` in
  TypeScript, `meter_api_calls()` in Python) that sits outside the snippet regions. When the runner
  sets `SAYGM_REPORT_FILE`, it records every call to a SayGM generation endpoint, including
  retries, and the token usage the response reports. A call that ends without usage leaves its
  cost unknown, which fails the run.
- **Live runs.** `pnpm run-examples` runs each example and prices its calls at the highest rate
  the catalog lists for each model. Once spend passes the cap (default $0.50, set with
  `--cap-usd` or `SAYGM_RUN_CAP_USD`), or a cost is unknown, the run fails and skips the examples
  left. Each example's `checks.json` states what must be true, for example that a tool was called
  or that the stream arrived in more than one chunk.
- **Verified dates.** A green run records the date in `snippets/status.json`. Tutorial pages show
  it as "verified on".

The `examples` workflow runs the examples a pull request changes, every example when SayGM
publishes a new catalog, and every example weekly. It needs a repository secret `SAYGM_API_KEY`
(and the same key as a Dependabot secret, so dependency updates are tested too).

## Develop

```bash
pnpm install
uv sync --all-packages
prek install
prek run --all-files
```

`prek` runs oxfmt, oxlint, tsc, vitest, ruff, ty, pytest, actionlint, zizmor, the snippet check
and the drift check.

## Add an example

1. Create `examples/<slug>/` with `README.md`, `checks.json`, `commands.sh`, and either `package.json`,
   `tsconfig.json` and `main.ts`, or `pyproject.toml` and `main.py`. Add a Python example to the
   workspace members in the root `pyproject.toml`.
2. Pick models with `modelId("<role>")` or `model_id("<role>")`. Add a role to `catalog.json`
   if none fits.
3. Install the meter before the first API call, and report the facts your `checks.json` asserts
   with `reportFact` or `report_fact`.
4. Mark the code the tutorial shows with region markers, add a `commands.sh` with `install` and
   `run` regions, then run `pnpm extract-snippets`.

## License

[MIT](LICENSE)
