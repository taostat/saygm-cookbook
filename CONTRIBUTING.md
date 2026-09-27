# Contributing to the SayGM cookbook

Every code block on a SayGM tutorial page comes from a recipe in this repository, and CI runs
that recipe against the live SayGM API before the page shows it. This guide covers how that
works and how to add a recipe.

## Set up

```bash
pnpm install
uv sync --all-packages
prek install
prek run --all-files
```

`prek` runs oxfmt, oxlint, tsc, vitest, ruff, ty, pytest, shellcheck, shfmt, actionlint, zizmor,
the snippet check and the drift check.

## Add a recipe

1. Create `examples/<slug>/` with `README.md`, `checks.json`, `commands.sh`, and either
   `package.json`, `tsconfig.json` and `main.ts`, or `pyproject.toml` and `main.py`. Add a Python
   recipe to the workspace members in the root `pyproject.toml`. Link the README to
   `https://saygm.com/developers/tutorials/<slug>`.
2. Pick models with `modelId("<role>")` in TypeScript or `model_id("<role>")` in Python. Add a
   role to `catalog.json` if none fits.
3. Install the meter before the first API call (see [Metering](#metering)).
4. Mark the code the tutorial shows with region markers, then run `pnpm extract-snippets`.
5. Write `checks.json` and report the facts it checks with `reportFact` or `report_fact`.
6. Run the recipe live with a cap (see [Run recipes live](#run-recipes-live)).

## Region markers

Mark each block a tutorial shows:

| Language          | Open                    | Close                |
| ----------------- | ----------------------- | -------------------- |
| TypeScript and JS | `// region: <id>`       | `// endregion`       |
| Python and bash   | `# region: <id>`        | `# endregion`        |
| HTML              | `<!-- region: <id> -->` | `<!-- endregion -->` |

Ids are kebab-case and unique within a recipe. Regions cannot nest or be empty.
`pnpm extract-snippets` writes `snippets/<slug>.json`, which the tutorial pages render. Markers
never appear in the output, and each `modelId("<role>")` or `model_id("<role>")` call becomes the
model id CI ran, so a copied snippet runs as is. Keep helper code, such as the meter and fact
reporting, outside the regions.

Each recipe's `commands.sh` holds an `install` region, one pinned `npm install` or `pip install`
line, and a `run` region, `node main.ts` or `python main.py`. The drift check keeps the install
line equal to the manifest's pins and the run line equal to the command CI runs.

## checks.json

`checks.json` says what must be true after a run, using facts the recipe reports:

```json
{
  "facts": {
    "tool_calls": { "min": 1 },
    "answered": { "equals": true }
  }
}
```

Each fact takes `min` (a number) or `equals` (any JSON value). Check behaviour, such as a tool
was called or a stream arrived in more than one chunk, rather than exact model wording.

## Metering

Each recipe installs a meter outside its regions: `import "@saygm-cookbook/shared/install-meter"`
in TypeScript, or `meter_api_calls()` in Python. When the runner sets `SAYGM_REPORT_FILE`, the
meter appends one JSON line per call to a SayGM generation endpoint, retries included:

- `{"kind": "request", "id": 1, "model": "...", "path": "/v1/messages"}` before the call;
- then one outcome for that id: `usage` with the token counts the response reports,
  `no_charge` for an HTTP error status, or `unmetered` when a success carries no usage.

`reportFact` and `report_fact` append `{"kind": "fact", "name": "...", "value": ...}`. A request
with no outcome, an unmetered response or a malformed line leaves the run's cost unknown, and
the runner fails it.

## Run recipes live

```bash
SAYGM_API_KEY="your key" pnpm run-examples --cap-usd 0.10
SAYGM_API_KEY="your key" pnpm run-examples customer-support-agent
```

The runner prices each call at the highest rate `catalog.json` lists for the model, in integer
nano-dollars. Once spend passes the cap (default $0.50, or `SAYGM_RUN_CAP_USD`) or a cost is
unknown, the run fails and skips the recipes left. `--write-status` records each passing recipe's
date and token usage in `snippets/status.json`; it refuses to run while a `SAYGM_MODEL_<ROLE>`
override is set, because the snippets name the catalog's models.

## Catalog and drift check

`pnpm sync-catalog` refreshes `catalog.json` from `https://api.saygm.com/v1/models`: each model's
API shapes, tool support, confidential flag and prices. The `roles` section is kept by hand. Each
role names a model, the API shape it must serve, whether it needs tools, and optionally
`"confidential": true`; the sync fails when the live catalog breaks a role.

`pnpm check-drift` parses every recipe and fails on a hard-coded model id, an unknown role, or a
URL that is not one of the catalog's `base_urls`, and checks each `commands.sh`.

A recipe that calls another service lists that service's URL prefixes in its `checks.json`:

```json
{ "facts": {}, "external_urls": ["https://cdn.jsdelivr.net/gh/taostat/saygm-cookbook@"] }
```

Each prefix needs a host followed by `/`, and SayGM hosts are not accepted there: SayGM URLs must
match a catalog base URL exactly. A bare `https://` joined to a host from a variable, as in
`f"https://{domain}/api"`, also passes.

## CI

- `checks.yml` runs the prek hooks on every pull request and on pushes to `main`.
- `examples.yml` runs the recipes live: on a pull request, only the recipes it changes (every
  recipe when shared code, the catalog or a lockfile changes); on the `catalog-published`
  repository dispatch; and weekly. It skips pull requests from forks, which get no secrets.
  Outside pull requests it refreshes the catalog first, and a second job commits the refreshed
  `catalog.json` and `snippets/status.json`.

Secrets: `SAYGM_API_KEY` as a repository secret for the live runs.

Dependabot pull requests get no repository secrets, so they run the offline checks and the live
job skips with a notice. A dependency update that breaks a recipe live shows up on the next
weekly or catalog run after it merges. Testing Dependabot pull requests live would need a
dedicated low-balance key stored as a Dependabot secret, because those pull requests run newly
released package code.
