"""Record every SayGM generation call's request and token usage for the example runner."""

import itertools
import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

import httpx2

if TYPE_CHECKING:
    from collections.abc import Callable

METERED_HOST = "api.saygm.com"
METERED_PATHS = ("/chat/completions", "/responses", "/messages")


def _count(value: object, *, required: bool) -> int | None:
    if value is None and not required:
        return 0
    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        return value
    return None


def _token_counts(
    inp: object, out: object, cache_read: object = 0, cache_write: object = 0
) -> dict[str, int] | None:
    counts = {
        "input_tokens": _count(inp, required=True),
        "output_tokens": _count(out, required=True),
        "cache_read_input_tokens": _count(cache_read, required=False),
        "cache_creation_input_tokens": _count(cache_write, required=False),
    }
    valid = {name: value for name, value in counts.items() if value is not None}
    return valid if len(valid) == len(counts) else None


def usage_from_json(path: str, body: object) -> dict[str, int] | None:
    """Read token usage from a non-streamed Chat Completions, Responses or Messages body.

    Chat Completions prompt tokens already include cached tokens, so all are priced as input.

    Returns:
        The four token counts, or None when the body has no valid usage.
    """
    usage = body.get("usage") if isinstance(body, dict) else None
    if not isinstance(usage, dict):
        return None
    if path.endswith("/chat/completions"):
        return _token_counts(usage.get("prompt_tokens"), usage.get("completion_tokens"))
    if path.endswith("/messages"):
        return _token_counts(
            usage.get("input_tokens"),
            usage.get("output_tokens"),
            usage.get("cache_read_input_tokens"),
            usage.get("cache_creation_input_tokens"),
        )
    return _token_counts(usage.get("input_tokens"), usage.get("output_tokens"))


def _request_model(request: httpx2.Request) -> str:
    try:
        body = json.loads(request.content)
    except (ValueError, httpx2.RequestNotRead):
        return "unknown"
    model = body.get("model") if isinstance(body, dict) else None
    return model if isinstance(model, str) else "unknown"


def _is_stream(response: httpx2.Response) -> bool:
    return "text/event-stream" in response.headers.get("content-type", "")


def _outcome(response: httpx2.Response, path: str, request_id: int, model: str) -> dict[str, Any]:
    if response.status_code >= 400:  # noqa: PLR2004 - HTTP error statuses start at 400
        return {"kind": "no_charge", "id": request_id, "status": response.status_code}
    if _is_stream(response):
        reason = "streamed responses are not metered in Python; use a non-streamed call"
        return {"kind": "unmetered", "id": request_id, "reason": reason}
    try:
        counts = usage_from_json(path, response.json())
    except ValueError:
        counts = None
    if counts is None:
        return {"kind": "unmetered", "id": request_id, "reason": "response has no usage"}
    return {"kind": "usage", "id": request_id, "model": model, **counts}


def install_meter(report_path: Path) -> None:
    """Patch httpx2 clients so SayGM generation calls append request and usage lines.

    The OpenAI, Anthropic, Agents and Pydantic AI SDKs all send through httpx2.
    """
    ids = itertools.count(1)

    def write(record: dict[str, Any]) -> None:
        with report_path.open("a") as report:
            report.write(json.dumps(record) + "\n")

    def start(request: httpx2.Request) -> tuple[int, str] | None:
        url = request.url
        if url.host != METERED_HOST or not url.path.endswith(METERED_PATHS):
            return None
        request_id = next(ids)
        model = _request_model(request)
        write({"kind": "request", "id": request_id, "model": model, "path": url.path})
        return request_id, model

    original_send: Callable[..., httpx2.Response] = httpx2.Client.send
    original_async_send: Callable[..., Any] = httpx2.AsyncClient.send

    def send(self: httpx2.Client, request: httpx2.Request, **kwargs: Any) -> httpx2.Response:  # noqa: ANN401 - forwards httpx2's own keyword arguments
        started = start(request)
        response = original_send(self, request, **kwargs)
        if started is not None:
            if not _is_stream(response):
                response.read()
            write(_outcome(response, request.url.path, *started))
        return response

    async def async_send(
        self: httpx2.AsyncClient,
        request: httpx2.Request,
        **kwargs: Any,  # noqa: ANN401 - forwards httpx2's own keyword arguments
    ) -> httpx2.Response:
        started = start(request)
        response = await original_async_send(self, request, **kwargs)
        if started is not None:
            if not _is_stream(response):
                await response.aread()
            write(_outcome(response, request.url.path, *started))
        return response

    httpx2.Client.send = send
    httpx2.AsyncClient.send = async_send
