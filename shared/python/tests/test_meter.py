import asyncio
import json
from pathlib import Path

import httpx2
import pytest
from saygm_examples_shared.meter import install_meter, usage_from_json


def counts(inp: int, out: int, cache_read: int = 0, cache_write: int = 0) -> dict[str, int]:
    return {
        "input_tokens": inp,
        "output_tokens": out,
        "cache_read_input_tokens": cache_read,
        "cache_creation_input_tokens": cache_write,
    }


def test_reads_chat_completions_usage() -> None:
    body = {"usage": {"prompt_tokens": 10, "completion_tokens": 4}}
    assert usage_from_json("/v1/chat/completions", body) == counts(10, 4)


def test_reads_responses_usage() -> None:
    body = {"usage": {"input_tokens": 7, "output_tokens": 3}}
    assert usage_from_json("/v1/responses", body) == counts(7, 3)


def test_reads_messages_usage_with_cache_counters() -> None:
    usage = {
        "input_tokens": 5,
        "output_tokens": 2,
        "cache_read_input_tokens": 8,
        "cache_creation_input_tokens": None,
    }
    assert usage_from_json("/v1/messages", {"usage": usage}) == counts(5, 2, 8, 0)


@pytest.mark.parametrize(
    "body",
    [{}, {"usage": {"input_tokens": -1, "output_tokens": 1}}, {"usage": {"input_tokens": True}}],
)
def test_returns_none_for_missing_or_malformed_usage(body: dict[str, object]) -> None:
    assert usage_from_json("/v1/responses", body) is None


@pytest.fixture
def report(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(httpx2.Client, "send", httpx2.Client.send)
    monkeypatch.setattr(httpx2.AsyncClient, "send", httpx2.AsyncClient.send)
    path = tmp_path / "report.ndjson"
    install_meter(path)
    return path


def lines(path: Path) -> list[dict[str, object]]:
    return [json.loads(line) for line in path.read_text().splitlines()]


def client(response: httpx2.Response) -> httpx2.Client:
    return httpx2.Client(transport=httpx2.MockTransport(lambda _request: response))


def test_records_request_and_usage(report: Path) -> None:
    usage = {"input_tokens": 3, "output_tokens": 4}
    with client(httpx2.Response(200, json={"usage": usage})) as http:
        response = http.post("https://api.saygm.com/v1/responses", json={"model": "m"})
    assert response.json() == {"usage": usage}
    assert lines(report) == [
        {"kind": "request", "id": 1, "model": "m", "path": "/v1/responses"},
        {"kind": "usage", "id": 1, "model": "m", **counts(3, 4)},
    ]


def test_meters_the_async_client(report: Path) -> None:
    response = httpx2.Response(200, json={"usage": {"input_tokens": 1, "output_tokens": 2}})
    transport = httpx2.MockTransport(lambda _request: response)

    async def call() -> None:
        async with httpx2.AsyncClient(transport=transport) as http:
            await http.post("https://api.saygm.com/v1/messages", json={"model": "m"})

    asyncio.run(call())
    assert lines(report)[1] == {"kind": "usage", "id": 1, "model": "m", **counts(1, 2)}


def test_records_error_status_as_no_charge(report: Path) -> None:
    with client(httpx2.Response(401, json={"error": "bad key"})) as http:
        http.post("https://api.saygm.com/v1/chat/completions", json={"model": "m"})
    assert lines(report)[1] == {"kind": "no_charge", "id": 1, "status": 401}


def test_records_success_without_usage_as_unmetered(report: Path) -> None:
    with client(httpx2.Response(200, json={"output": []})) as http:
        http.post("https://api.saygm.com/v1/responses", json={"model": "m"})
    expected = {"kind": "unmetered", "id": 1, "reason": "response has no usage"}
    assert lines(report)[1] == expected


def test_records_a_stream_as_unmetered(report: Path) -> None:
    stream = httpx2.Response(
        200, text="data: {}\n\n", headers={"content-type": "text/event-stream"}
    )
    with client(stream) as http:
        http.post("https://api.saygm.com/v1/responses", json={"model": "m"})
    assert lines(report)[1]["kind"] == "unmetered"


def test_leaves_other_urls_alone(report: Path) -> None:
    with client(httpx2.Response(200, json={"data": []})) as http:
        http.get("https://api.saygm.com/v1/models")
        http.post("https://example.com/v1/responses", json={"model": "m"})
    assert not report.exists()
