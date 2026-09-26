import asyncio

import check_surface
import store

CART_SCHEMA = {
    "type": "object",
    "required": ["meta", "cart"],
    "properties": {
        "meta": {
            "type": "object",
            "required": ["ucp-agent"],
            "properties": {
                "ucp-agent": {
                    "type": "object",
                    "required": ["profile"],
                    "properties": {"profile": {"type": "string"}},
                }
            },
        },
        "cart": {
            "type": "object",
            "required": ["line_items"],
            "properties": {
                "line_items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["item", "quantity"],
                        "properties": {
                            "quantity": {"type": "integer"},
                            "item": {
                                "type": "object",
                                "required": ["id"],
                                "properties": {"id": {"type": "string"}},
                            },
                        },
                    },
                },
                "buyer": {
                    "type": "object",
                    "required": ["email"],
                    "properties": {"email": {"type": "string"}},
                },
            },
        },
    },
}

CART_CALL = {
    "meta": {"ucp-agent": {"profile": "https://example.com/p.json"}},
    "cart": {"line_items": [{"item": {"id": "v1"}, "quantity": 1}]},
}


def test_sent_paths_walks_objects_and_lists() -> None:
    assert check_surface.sent_paths(CART_CALL) == {
        "meta",
        "meta.ucp-agent",
        "meta.ucp-agent.profile",
        "cart",
        "cart.line_items",
        "cart.line_items[]",
        "cart.line_items[].item",
        "cart.line_items[].item.id",
        "cart.line_items[].quantity",
    }


def test_a_field_the_store_dropped_is_a_problem() -> None:
    call = {**CART_CALL, "cart": {**CART_CALL["cart"], "note": "gift"}}
    assert check_surface.surface_problems(
        {"create_cart": call}, {"create_cart": CART_SCHEMA}, "/x"
    ) == ["create_cart: the input schema no longer lists cart.note under properties"]


def test_a_field_moved_into_all_of_is_reported_as_a_change_of_shape() -> None:
    schema = {
        "type": "object",
        "allOf": [{"properties": {"query": {"type": "string"}}, "required": ["query"]}],
    }
    assert check_surface.surface_problems(
        {"search": {"query": "socks"}}, {"search": schema}, "/x"
    ) == ["search: the input schema no longer lists query under properties"]


def test_a_newly_required_field_is_a_problem() -> None:
    call = {"meta": CART_CALL["meta"], "cart": {"line_items": [{"item": {"id": "v1"}}]}}
    assert check_surface.surface_problems(
        {"create_cart": call}, {"create_cart": CART_SCHEMA}, "/x"
    ) == ["create_cart: the store rejects cart.line_items.0: 'quantity' is a required property"]


def test_a_field_required_through_all_of_is_a_problem() -> None:
    schema = {**CART_SCHEMA, "allOf": [{"required": ["signals"]}]}
    assert check_surface.surface_problems(
        {"create_cart": CART_CALL}, {"create_cart": schema}, "/x"
    ) == ["create_cart: the store rejects the arguments: 'signals' is a required property"]


def test_required_fields_inside_an_unsent_object_are_not_problems() -> None:
    calls = {"create_cart": CART_CALL}
    assert check_surface.surface_problems(calls, {"create_cart": CART_SCHEMA}, "/x") == []


def test_a_value_of_the_wrong_type_is_a_problem() -> None:
    call = {
        "meta": CART_CALL["meta"],
        "cart": {"line_items": [{"item": {"id": "v1"}, "quantity": "1"}]},
    }
    assert check_surface.surface_problems(
        {"create_cart": call}, {"create_cart": CART_SCHEMA}, "/x"
    ) == ["create_cart: the store rejects cart.line_items.0.quantity: '1' is not of type 'integer'"]


def test_a_value_outside_the_schema_limits_is_a_problem() -> None:
    schema = {
        "type": "object",
        "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 3}},
    }
    assert check_surface.surface_problems({"search": {"limit": 5}}, {"search": schema}, "/x") == [
        "search: the store rejects limit: 5 is greater than the maximum of 3"
    ]


def test_surface_problems_names_a_missing_tool() -> None:
    calls = {"create_cart": CART_CALL, "search_catalog": {"meta": {}}}
    assert check_surface.surface_problems(calls, {"create_cart": CART_SCHEMA}, "/api/ucp/mcp") == [
        "/api/ucp/mcp: tools/list no longer has search_catalog"
    ]


def test_discovery_accepts_the_pinned_version_over_mcp() -> None:
    services = [
        {"version": store.UCP_VERSION, "transport": "mcp"},
        {"version": "2026-04-08", "transport": "embedded"},
    ]
    document = {"ucp": {"services": {"dev.ucp.shopping": services}}}
    assert check_surface.discovery_problems(document) == []


def test_discovery_flags_a_store_that_moved_on() -> None:
    services = [
        {"version": "2027-01-01", "transport": "mcp"},
        {"version": store.UCP_VERSION, "transport": "embedded"},
    ]
    document = {"ucp": {"services": {"dev.ucp.shopping": services}}}
    assert check_surface.discovery_problems(document) == [
        f"/.well-known/ucp offers UCP over MCP as ['2027-01-01'], not {store.UCP_VERSION}"
    ]


def test_recorded_calls_cover_every_store_tool_with_the_profile_on_ucp_calls() -> None:
    calls = asyncio.run(check_surface.recorded_calls())
    assert set(calls[store.CATALOG_PATH]) == {
        "search_catalog",
        "get_product",
        "create_cart",
    }
    assert set(calls[store.POLICIES_PATH]) == {"search_shop_policies_and_faqs"}
    for arguments in calls[store.CATALOG_PATH].values():
        assert arguments["meta"] == {"ucp-agent": {"profile": check_surface.RECORDED_PROFILE}}


PROFILE_BYTES = b'{"ucp": {"version": "2026-08-25"}}\n'


def test_the_pinned_profile_matches_the_committed_file() -> None:
    assert check_surface.profile_problems(PROFILE_BYTES, PROFILE_BYTES, "application/json") == []


def test_a_pinned_profile_that_differs_from_the_committed_file_is_a_problem() -> None:
    served = PROFILE_BYTES.replace(b"2026-08-25", b"2026-01-23")
    assert check_surface.profile_problems(PROFILE_BYTES, served, "application/json") == [
        (
            f"{store.PINNED_PROFILE_URL} differs from agent-profile.json; "
            "tag a new profile version and update PINNED_PROFILE_URL"
        )
    ]


def test_a_pinned_profile_served_as_text_is_a_problem() -> None:
    assert check_surface.profile_problems(PROFILE_BYTES, PROFILE_BYTES, "text/plain") == [
        f"{store.PINNED_PROFILE_URL} is served as text/plain; the store needs application/json"
    ]
