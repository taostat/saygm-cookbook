import asyncio
import json
from pathlib import Path
from typing import TYPE_CHECKING, Any, cast

import pytest
from mcp import MCPError
from mcp.types import CallToolResult, TextContent

import store

if TYPE_CHECKING:
    from mcp import ClientSession

PROFILE = "https://example.com/agent-profile.json"
UCP = {"version": store.UCP_VERSION}


class FakeSession:
    def __init__(self, result: CallToolResult | MCPError) -> None:
        self.result = result
        self.calls: list[tuple[str, dict[str, Any]]] = []

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> CallToolResult:
        self.calls.append((name, arguments))
        if isinstance(self.result, MCPError):
            raise self.result
        return self.result


def ucp_result(**content: object) -> CallToolResult:
    return CallToolResult(content=[], structured_content={"ucp": UCP, **content})


def text_result(text: str, *, is_error: bool = False) -> CallToolResult:
    return CallToolResult(content=[TextContent(type="text", text=text)], is_error=is_error)


def shop(ucp: FakeSession | None = None, policies: FakeSession | None = None) -> store.Store:
    empty = FakeSession(ucp_result())
    return store.Store(
        cast("ClientSession", ucp or empty), cast("ClientSession", policies or empty), PROFILE
    )


def usd(amount: int) -> dict[str, object]:
    return {"amount": amount, "currency": "USD"}


PRODUCT: dict[str, Any] = {
    "id": "gid://shopify/Product/1",
    "title": "Wool Runner",
    "url": "https://store.example/products/wool-runner",
    "price_range": {"min": usd(11000), "max": usd(11000)},
    "options": [{"name": "Size", "values": [{"label": "8"}, {"label": "9"}]}],
    "description": {"html": "Soft wool."},
    "variants": [
        {
            "id": "gid://shopify/ProductVariant/8",
            "title": "8",
            "price": usd(11000),
            "availability": {"available": False},
        },
        {"id": "gid://shopify/ProductVariant/9", "title": "9", "price": usd(11000)},
    ],
}


@pytest.mark.parametrize(
    ("amount", "currency", "shown"),
    [(11000, "USD", "110.00 USD"), (1500, "JPY", "1500 JPY"), (12345, "KWD", "12.345 KWD")],
)
def test_money_uses_each_currency_minor_unit(amount: int, currency: str, shown: str) -> None:
    assert store.money({"amount": amount, "currency": currency}) == shown


def test_product_summary_shows_a_price_range_only_when_prices_differ() -> None:
    assert store.product_summary(PRODUCT) == {
        "id": "gid://shopify/Product/1",
        "title": "Wool Runner",
        "price": "110.00 USD",
        "url": "https://store.example/products/wool-runner",
        "options": {"Size": ["8", "9"]},
    }
    ranged = {**PRODUCT, "price_range": {"min": usd(9000), "max": usd(11000)}}
    assert store.product_summary(ranged)["price"] == "90.00 USD to 110.00 USD"


def test_call_ucp_attaches_the_agent_profile() -> None:
    session = FakeSession(ucp_result(products=[]))
    asyncio.run(store.call_ucp(shop(session), "search_catalog", catalog={"query": "socks"}))
    assert session.calls == [
        (
            "search_catalog",
            {"meta": {"ucp-agent": {"profile": PROFILE}}, "catalog": {"query": "socks"}},
        )
    ]


def test_call_ucp_rejects_another_ucp_version() -> None:
    session = FakeSession(CallToolResult(content=[], structured_content={"ucp": {"version": "x"}}))
    with pytest.raises(store.UcpError, match=r"answered UCP 'x'; this assistant speaks 2026-08-25"):
        asyncio.run(store.call_ucp(shop(session), "search_catalog"))


def test_call_ucp_reports_a_result_without_ucp_content() -> None:
    session = FakeSession(text_result("UCP discovery failed", is_error=True))
    with pytest.raises(store.UcpError, match="no UCP result: UCP discovery failed"):
        asyncio.run(store.call_ucp(shop(session), "get_product"))


def test_call_ucp_explains_a_refused_profile() -> None:
    refusal = {"code": "profile_malformed", "content": "Missing services"}
    session = FakeSession(MCPError(code=-32001, message="UCP discovery failed", data=refusal))
    expected = (
        "search_catalog: UCP discovery failed (profile_malformed: Missing services); "
        f"agent profile {PROFILE}"
    )
    with pytest.raises(store.UcpError) as raised:
        asyncio.run(store.call_ucp(shop(session), "search_catalog"))
    assert str(raised.value) == expected


def test_call_ucp_passes_on_a_rate_limit_with_its_wait() -> None:
    wait = "Too many requests, please retry after 1220 seconds"
    session = FakeSession(MCPError(code=-32000, message="Rate limit exceeded", data=wait))
    with pytest.raises(store.UcpError, match=r"search_catalog: Rate limit exceeded \(Too many"):
        asyncio.run(store.call_ucp(shop(session), "search_catalog"))


def test_search_products_trims_results_and_limits_the_page() -> None:
    session = FakeSession(ucp_result(products=[PRODUCT], messages=[]))
    found = asyncio.run(store.search_products(shop(session), "wool"))
    assert found == {"products": [store.product_summary(PRODUCT)]}
    assert session.calls[0][1]["catalog"] == {"query": "wool", "pagination": {"limit": 5}}


def test_ucp_error_messages_reach_the_model() -> None:
    missing = {"type": "error", "code": "product_not_found", "content": "Product not found"}
    session = FakeSession(ucp_result(messages=[missing, {"type": "info", "content": "hint"}]))
    assert asyncio.run(store.product_details(shop(session), "gid://shopify/Product/0")) == {
        "errors": ["Product not found"]
    }


def test_product_details_sends_selected_options_and_lists_variants() -> None:
    session = FakeSession(ucp_result(product=PRODUCT))
    details = asyncio.run(store.product_details(shop(session), PRODUCT["id"], {"Size": "9"}))
    assert session.calls[0][1]["catalog"] == {
        "id": PRODUCT["id"],
        "selected": [{"name": "Size", "label": "9"}],
    }
    assert details["description"] == "Soft wool."
    assert details["variants"] == [
        {
            "variant_id": "gid://shopify/ProductVariant/8",
            "title": "8",
            "price": "110.00 USD",
            "available": False,
        },
        {
            "variant_id": "gid://shopify/ProductVariant/9",
            "title": "9",
            "price": "110.00 USD",
            "available": None,
        },
    ]


def test_store_policy_returns_the_store_answers() -> None:
    answers = [{"question": "What is the return policy?", "answer": "31 days."}]
    policies = FakeSession(text_result(json.dumps(answers)))
    assert asyncio.run(store.store_policy(shop(policies=policies), "returns?")) == {
        "answers": answers
    }
    assert policies.calls == [("search_shop_policies_and_faqs", {"query": "returns?"})]


def test_store_policy_handles_no_answer_and_errors() -> None:
    empty = FakeSession(text_result(""))
    assert asyncio.run(store.store_policy(shop(policies=empty), "shipping?")) == {"answers": []}
    failed = FakeSession(text_result("rate limited", is_error=True))
    assert asyncio.run(store.store_policy(shop(policies=failed), "shipping?")) == {
        "errors": ["rate limited"]
    }


def test_create_cart_returns_the_checkout_link_and_totals() -> None:
    cart = {
        "currency": "USD",
        "continue_url": "https://store.example/cart/c/1",
        "totals": [{"type": "subtotal", "amount": 22000}, {"type": "total", "amount": 22000}],
    }
    session = FakeSession(ucp_result(cart=cart))
    made = asyncio.run(store.create_cart(shop(session), [("gid://shopify/ProductVariant/9", 2)]))
    assert made == {
        "continue_url": "https://store.example/cart/c/1",
        "totals": {"subtotal": "220.00 USD", "total": "220.00 USD"},
    }
    assert session.calls[0][1]["cart"] == {
        "line_items": [{"item": {"id": "gid://shopify/ProductVariant/9"}, "quantity": 2}]
    }


def test_the_agent_profile_declares_the_pinned_version_and_catalog() -> None:
    profile = json.loads((Path(store.__file__).parent / "agent-profile.json").read_text())["ucp"]
    assert profile["version"] == store.UCP_VERSION
    needed = {
        "dev.ucp.shopping.catalog.search",
        "dev.ucp.shopping.catalog.lookup",
        "dev.shopify.catalog",
        "dev.ucp.shopping.cart",
    }
    assert needed <= set(profile["capabilities"])
    versions = {
        entry["version"] for entries in profile["capabilities"].values() for entry in entries
    }
    assert versions == {store.UCP_VERSION}


def test_call_ucp_stops_calling_the_store_when_the_budget_is_spent() -> None:
    session = FakeSession(ucp_result(products=[]))
    shop_ = shop(session)
    shop_.calls_left = 1
    asyncio.run(store.search_products(shop_, "socks"))
    assert asyncio.run(store.search_products(shop_, "shoes")) == {"errors": [store.BUDGET_SPENT]}
    assert len(session.calls) == 1
