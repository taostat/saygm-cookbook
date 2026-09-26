# region: connect
import json
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass
from typing import Any

import httpx2
from mcp import ClientSession, Implementation, MCPError
from mcp.client.streamable_http import streamable_http_client

UCP_VERSION = "2026-08-25"
CALLS_PER_QUESTION = 4
USER_AGENT = "saygm-shopify-store-assistant/0.1 (+https://github.com/taostat/saygm-cookbook)"
CATALOG_PATH = "/api/ucp/mcp"
POLICIES_PATH = "/api/mcp"


@dataclass
class Store:
    """Open MCP sessions to one Shopify store: UCP catalog and cart, plus policies and FAQs."""

    ucp: ClientSession
    policies: ClientSession
    profile_url: str
    calls_left: int = CALLS_PER_QUESTION


@asynccontextmanager
async def open_store(domain: str, profile_url: str) -> AsyncIterator[Store]:
    """Connect to a store's UCP and policy endpoints for the length of the block."""
    client_info = Implementation(name="saygm-shopify-store-assistant", version="0.1.0")
    async with AsyncExitStack() as stack:
        http = httpx2.AsyncClient(headers={"User-Agent": USER_AGENT}, timeout=30)
        await stack.enter_async_context(http)
        sessions = []
        for path in (CATALOG_PATH, POLICIES_PATH):
            transport = streamable_http_client(f"https://{domain}{path}", http_client=http)
            read, write = await stack.enter_async_context(transport)
            session = ClientSession(read, write, client_info=client_info)
            await stack.enter_async_context(session)
            await session.initialize()
            sessions.append(session)
        yield Store(ucp=sessions[0], policies=sessions[1], profile_url=profile_url)


# endregion


# region: call-ucp
class UcpError(Exception):
    """The store refused a UCP call or answered in a version this assistant is not built for."""


BUDGET_SPENT = "Store lookup limit reached for this question. Answer from the results you have."


async def call_ucp(store: Store, tool: str, **arguments: object) -> dict[str, Any]:
    """Call a UCP tool with the agent profile attached, as every UCP tool requires."""
    if store.calls_left <= 0:
        return {
            "ucp": {"version": UCP_VERSION},
            "messages": [{"type": "error", "content": BUDGET_SPENT}],
        }
    store.calls_left -= 1
    meta = {"ucp-agent": {"profile": store.profile_url}}
    try:
        result = await store.ucp.call_tool(tool, {"meta": meta, **arguments})
    except MCPError as error:
        detail = error.data
        if isinstance(detail, dict):
            reason = f"{detail.get('code')}: {detail.get('content')}"
        else:
            reason = str(detail or error.message)
        msg = f"{tool}: {error.message} ({reason}); agent profile {store.profile_url}"
        raise UcpError(msg) from error
    content = result.structured_content
    if content is None:
        text = " ".join(part.text for part in result.content if part.type == "text")
        msg = f"{tool}: the store sent no UCP result: {text or 'empty response'}"
        raise UcpError(msg)
    version = content.get("ucp", {}).get("version")
    if version != UCP_VERSION:
        msg = f"{tool}: the store answered UCP {version!r}; this assistant speaks {UCP_VERSION}"
        raise UcpError(msg)
    return content


def ucp_errors(content: dict[str, Any]) -> list[str]:
    return [m["content"] for m in content.get("messages", []) if m.get("type") == "error"]


# endregion

# region: trim
# ISO 4217 currencies whose minor unit is not a hundredth.
ZERO_DECIMAL = {"BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX"}
ZERO_DECIMAL |= {"UYI", "VND", "VUV", "XAF", "XOF", "XPF"}
THREE_DECIMAL = {"BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"}


def money(price: dict[str, Any]) -> str:
    """Format UCP minor units, such as {"amount": 11000, "currency": "USD"}, as "110.00 USD"."""
    currency = price["currency"]
    digits = 0 if currency in ZERO_DECIMAL else 3 if currency in THREE_DECIMAL else 2
    return f"{price['amount'] / 10**digits:.{digits}f} {currency}"


def product_summary(product: dict[str, Any]) -> dict[str, Any]:
    low, high = product["price_range"]["min"], product["price_range"]["max"]
    return {
        "id": product["id"],
        "title": product["title"],
        "price": money(low) if low == high else f"{money(low)} to {money(high)}",
        "url": product.get("url"),
        "options": {o["name"]: [v["label"] for v in o["values"]] for o in product["options"]},
    }


def variant_summary(variant: dict[str, Any]) -> dict[str, Any]:
    return {
        "variant_id": variant["id"],
        "title": variant["title"],
        "price": money(variant["price"]),
        "available": variant.get("availability", {}).get("available"),
    }


# endregion


# region: tools
async def search_products(store: Store, query: str, limit: int = 5) -> dict[str, Any]:
    """Search the store's catalog."""
    content = await call_ucp(
        store, "search_catalog", catalog={"query": query, "pagination": {"limit": limit}}
    )
    if errors := ucp_errors(content):
        return {"errors": errors}
    return {"products": [product_summary(p) for p in content.get("products", [])]}


async def product_details(
    store: Store, product_id: str, selected: dict[str, str] | None = None
) -> dict[str, Any]:
    """Get one product's variants, prices and stock, optionally narrowed by options like Size."""
    catalog: dict[str, Any] = {"id": product_id}
    if selected:
        catalog["selected"] = [{"name": name, "label": label} for name, label in selected.items()]
    content = await call_ucp(store, "get_product", catalog=catalog)
    if errors := ucp_errors(content):
        return {"errors": errors}
    product = content["product"]
    return {
        **product_summary(product),
        "description": product.get("description", {}).get("html", "")[:500],
        "variants": [variant_summary(v) for v in product.get("variants", [])],
    }


async def store_policy(store: Store, question: str) -> dict[str, Any]:
    """Answer a question from the store's published policies and FAQs."""
    result = await store.policies.call_tool("search_shop_policies_and_faqs", {"query": question})
    text = "".join(part.text for part in result.content if part.type == "text")
    if result.is_error:
        return {"errors": [text]}
    return {"answers": json.loads(text) if text else []}


async def create_cart(store: Store, items: list[tuple[str, int]]) -> dict[str, Any]:
    """Create a cart from (variant id, quantity) pairs and return its checkout link."""
    line_items = [{"item": {"id": variant}, "quantity": quantity} for variant, quantity in items]
    content = await call_ucp(store, "create_cart", cart={"line_items": line_items})
    if errors := ucp_errors(content):
        return {"errors": errors}
    cart = content["cart"]
    currency = cart["currency"]
    totals = {
        t["type"]: money({"amount": t["amount"], "currency": currency}) for t in cart["totals"]
    }
    return {"continue_url": cart["continue_url"], "totals": totals}


# endregion
