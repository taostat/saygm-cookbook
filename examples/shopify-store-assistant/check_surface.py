"""Fail when a store's UCP surface or the pinned agent profile no longer match store.py.

Run it with `uv run check_surface.py`. It needs no SayGM key. It reads the store's UCP discovery
document, then opens each MCP endpoint and lists its tools.
"""

import asyncio
import os
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any, cast

import httpx2
from jsonschema.validators import validator_for
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.types import CallToolResult, TextContent

import store

DEFAULT_DOMAIN = "allbirds.com"
PROFILE_FILE = Path(__file__).with_name("agent-profile.json")
RECORDED_PROFILE = "urn:example:recorded-profile"


class Recorder:
    """Stands in for an MCP session and keeps the arguments of each tool call."""

    def __init__(self) -> None:
        self.calls: dict[str, dict[str, Any]] = {}

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> CallToolResult:
        self.calls[name] = arguments
        refusal = {"type": "error", "content": "recorded"}
        return CallToolResult(
            content=[TextContent(type="text", text="[]")],
            structured_content={"ucp": {"version": store.UCP_VERSION}, "messages": [refusal]},
        )


async def recorded_calls() -> dict[str, dict[str, dict[str, Any]]]:
    """Run every store.py tool once against recorders; return each endpoint's calls by tool."""
    ucp, policies = Recorder(), Recorder()
    shop = store.Store(
        cast("ClientSession", ucp), cast("ClientSession", policies), RECORDED_PROFILE
    )
    await store.search_products(shop, "socks")
    await store.product_details(shop, "gid://shopify/Product/1", {"Size": "9"})
    await store.store_policy(shop, "returns")
    await store.create_cart(shop, [("gid://shopify/ProductVariant/1", 1)])
    return {store.CATALOG_PATH: ucp.calls, store.POLICIES_PATH: policies.calls}


def _join(prefix: str, name: str) -> str:
    return f"{prefix}.{name}" if prefix else name


def sent_paths(value: object, prefix: str = "") -> set[str]:
    """List the dotted paths an argument object sets; list items appear as "name[]"."""
    paths: set[str] = set()
    if isinstance(value, dict):
        for key, child in value.items():
            path = _join(prefix, key)
            paths |= {path} | sent_paths(child, path)
    elif isinstance(value, list):
        for item in value:
            paths |= {f"{prefix}[]"} | sent_paths(item, f"{prefix}[]")
    return paths


def _object_nodes(schema: dict[str, Any], prefix: str = "") -> Iterator[tuple[str, dict[str, Any]]]:
    if schema.get("type") == "array":
        yield from _object_nodes(schema.get("items", {}), f"{prefix}[]")
        return
    yield prefix, schema
    for name, child in schema.get("properties", {}).items():
        yield from _object_nodes(child, _join(prefix, name))


def dropped_fields(tool: str, schema: dict[str, Any], sent: set[str]) -> list[str]:
    """List the fields a call sends that the schema's plain "properties" no longer list.

    A field the store moved under $ref or allOf is reported too: that is a change of shape, and
    the smoke check fails so a person can confirm the call still works.
    """
    nodes = dict(_object_nodes(schema))
    accepted = {
        _join(path, name) for path, node in nodes.items() for name in node.get("properties", {})
    }
    accepted |= {path for path in nodes if path.endswith("[]")}
    return [
        f"{tool}: the input schema no longer lists {path} under properties"
        for path in sorted(sent - accepted)
    ]


def rejected_values(tool: str, schema: dict[str, Any], arguments: dict[str, Any]) -> list[str]:
    """Validate a call against a tool's input schema: required fields, types, enums and limits."""
    validator = validator_for(schema)(schema)
    problems = []
    for error in validator.iter_errors(arguments):
        where = ".".join(str(part) for part in error.absolute_path) or "the arguments"
        problems.append(f"{tool}: the store rejects {where}: {error.message}")
    return sorted(problems)


def profile_problems(committed: bytes, served: bytes, content_type: str) -> list[str]:
    """Check that the pinned profile URL serves agent-profile.json as JSON, byte for byte."""
    url = store.PINNED_PROFILE_URL
    if not content_type.startswith("application/json"):
        return [f"{url} is served as {content_type}; the store needs application/json"]
    if served != committed:
        fix = "tag a new profile version and update PINNED_PROFILE_URL"
        return [f"{url} differs from agent-profile.json; {fix}"]
    return []


def discovery_problems(document: dict[str, Any]) -> list[str]:
    """Check that /.well-known/ucp offers the pinned UCP version over MCP."""
    ucp = document.get("ucp", {})
    services = ucp.get("services", {}).get("dev.ucp.shopping", [])
    over_mcp = [s for s in services if s.get("transport") == "mcp"]
    if any(s.get("version") == store.UCP_VERSION for s in over_mcp):
        return []
    offered = sorted(s.get("version", "?") for s in over_mcp)
    return [f"/.well-known/ucp offers UCP over MCP as {offered}, not {store.UCP_VERSION}"]


def surface_problems(
    calls: dict[str, dict[str, Any]], tools: dict[str, dict[str, Any]], endpoint: str
) -> list[str]:
    """Check that an endpoint lists each tool store.py calls and accepts its arguments."""
    problems = []
    for tool, arguments in calls.items():
        schema = tools.get(tool)
        if schema is None:
            problems.append(f"{endpoint}: tools/list no longer has {tool}")
        else:
            problems += dropped_fields(tool, schema, sent_paths(arguments))
            problems += rejected_values(tool, schema, arguments)
    return problems


async def live_tools(http: httpx2.AsyncClient, url: str) -> dict[str, dict[str, Any]]:
    async with (
        streamable_http_client(url, http_client=http) as (read, write),
        ClientSession(read, write) as session,
    ):
        await session.initialize()
        listed = await session.list_tools()
    return {tool.name: tool.input_schema for tool in listed.tools}


async def check(domain: str) -> list[str]:
    calls = await recorded_calls()
    headers = {"User-Agent": store.USER_AGENT}
    async with httpx2.AsyncClient(headers=headers, timeout=30) as http:
        discovery = await http.get(f"https://{domain}/.well-known/ucp")
        discovery.raise_for_status()
        problems = discovery_problems(discovery.json())
        for endpoint, endpoint_calls in calls.items():
            tools = await live_tools(http, f"https://{domain}{endpoint}")
            problems += surface_problems(endpoint_calls, tools, endpoint)
        pinned = await http.get(store.PINNED_PROFILE_URL)
        pinned.raise_for_status()
        committed = PROFILE_FILE.read_bytes()
        content_type = pinned.headers.get("content-type", "")
        problems += profile_problems(committed, pinned.content, content_type)
    return problems


def main() -> int:
    domain = os.environ.get("SHOPIFY_STORE_DOMAIN", DEFAULT_DOMAIN)
    problems = asyncio.run(check(domain))
    if problems:
        print(f"{domain} or the pinned agent profile changed:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1
    print(f"{domain} serves UCP {store.UCP_VERSION} and accepts every call store.py makes;")
    print(f"{store.PINNED_PROFILE_URL} matches agent-profile.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
