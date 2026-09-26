# Build a Shopify store assistant on UCP

Tutorial: https://saygm.com/developers/tutorials/shopify-store-assistant

This example builds a shopping assistant for a public Shopify store. It searches the live catalog,
looks up sizes and stock, answers questions from the store's policies and FAQs, and can hand the
shopper a cart link. It talks to the store over the Universal Commerce Protocol (UCP) with the MCP
Python SDK, so it needs no Shopify account or token. The agent runs on Pydantic AI through SayGM:
an open model on the OpenAI-compatible API, then Claude on the Anthropic API, with one key.

Last verified on 2026-09-26 against UCP 2026-08-25 on allbirds.com.

## Run it

You need Python 3.13, uv, and a SayGM key.

```bash
export SAYGM_API_KEY="your SayGM key"
cd examples/shopify-store-assistant
uv run main.py
```

The assistant works with any Shopify store that serves UCP. Set `SHOPIFY_STORE_DOMAIN` to try
another one; the default is `allbirds.com`.

## How it works

- `store.py` opens two MCP sessions to the store: `/api/ucp/mcp` for the UCP catalog and cart
  tools, and `/api/mcp` for `search_shop_policies_and_faqs`.
- `call_ucp()` adds your agent profile URL to every UCP call as `meta["ucp-agent"]["profile"]`.
  Every UCP tool requires it, so the code adds it rather than the model.
- The agent gets four small function tools: `search_products`, `product_details`,
  `store_policy` and `make_cart`. Each returns a trimmed result with prices already converted from
  minor units. The store's own tool list is about 53 KB of JSON Schema, so four small tools keep
  every model call short and work with any model that supports tool calls.
- Each question gets up to four catalog calls (`CALLS_PER_QUESTION`). After that the tools ask
  the model to answer from the results it has, which keeps the load on the store light.
- The models come from the `chat_cheap` and `claude` roles in
  [`catalog.json`](../../catalog.json). Set `SAYGM_MODEL_CHAT_CHEAP` or `SAYGM_MODEL_CLAUDE` to
  try others.

## Your agent profile

A UCP agent profile is a JSON file you host yourself. The store fetches it on each call to learn
which capabilities your agent supports. Nothing is registered with Shopify.

[`agent-profile.json`](agent-profile.json) declares UCP `2026-08-25`, the `dev.ucp.shopping`
service over MCP, an empty `payment_handlers` object, and four capabilities:
`dev.ucp.shopping.catalog.search`, `dev.ucp.shopping.catalog.lookup`, `dev.shopify.catalog` (the
store offers `search_catalog` only when these catalog capabilities are declared) and
`dev.ucp.shopping.cart`.

The store accepts a profile served with `Content-Type: application/json` and a `Cache-Control`
header. jsDelivr, GitHub Pages and your own app all do this. The example reads the profile from
jsDelivr at a pinned tag of this repository. To use your own copy, host it and set
`UCP_AGENT_PROFILE_URL`.

## Carts

Cart tools accept anonymous requests. `create_cart` returns a `continue_url` where the shopper
reviews the cart and pays on the store's own checkout. A cart is a real object in the store, so
cart creation is opt-in:

```bash
SHOPIFY_CREATE_CART=1 uv run main.py
```

With the variable set, the agent gets the `make_cart` tool and the example asks it for a cart.
CI runs without it.

## Where to go next

- **Checkout inside the chat.** Completing a purchase through UCP's checkout tools needs an
  authenticated agent at one of Shopify's higher trust tiers. This example hands the shopper the
  `continue_url` instead, which works for everyone.
- **Order status.** A store's orders come from its Admin API (an app with `read_orders` installed
  on your store) or from Customer Accounts MCP after the shopper signs in. UCP's `get_order` covers
  orders an agent placed itself.

## Keeping it current

`check_surface.py` makes seven small requests to the store: it reads `/.well-known/ucp` and lists
the tools on both MCP endpoints, then checks that the store still offers UCP `2026-08-25` and accepts
every call `store.py` makes. It needs no SayGM key, and the `examples` workflow runs it weekly.

```bash
uv run check_surface.py
```
