import json
from pathlib import Path

import pytest
from saygm_examples_shared import CatalogError, model_id, report_fact

CATALOG = {
    "roles": {
        "chat_cheap": {"model": "qwen3.6-35b-a3b"},
        "claude": {"model": "claude-haiku-4-5"},
    }
}


@pytest.fixture
def catalog_path(tmp_path: Path) -> Path:
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps(CATALOG))
    return path


def test_resolves_a_role_from_the_catalog(catalog_path: Path) -> None:
    assert model_id("chat_cheap", catalog_path=catalog_path, env={}) == "qwen3.6-35b-a3b"


def test_prefers_an_env_override(catalog_path: Path) -> None:
    env = {"SAYGM_MODEL_CHAT_CHEAP": "gpt-5.4-nano"}
    assert model_id("chat_cheap", catalog_path=catalog_path, env=env) == "gpt-5.4-nano"


def test_ignores_an_empty_override(catalog_path: Path) -> None:
    env = {"SAYGM_MODEL_CHAT_CHEAP": ""}
    assert model_id("chat_cheap", catalog_path=catalog_path, env=env) == "qwen3.6-35b-a3b"


def test_names_known_roles_for_an_unknown_role(catalog_path: Path) -> None:
    expected = 'unknown model role "gemini"; known roles: chat_cheap, claude'
    with pytest.raises(CatalogError, match=expected):
        model_id("gemini", catalog_path=catalog_path, env={})


def test_explains_a_missing_catalog(tmp_path: Path) -> None:
    with pytest.raises(CatalogError, match="cannot read"):
        model_id("claude", catalog_path=tmp_path / "nope.json", env={})


def test_rejects_invalid_json(tmp_path: Path) -> None:
    path = tmp_path / "catalog.json"
    path.write_text("{")
    with pytest.raises(CatalogError, match="not valid JSON"):
        model_id("claude", catalog_path=path, env={})


def test_rejects_a_role_without_a_model(tmp_path: Path) -> None:
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps({"roles": {"claude": {}}}))
    with pytest.raises(CatalogError, match='role "claude" has no model'):
        model_id("claude", catalog_path=path, env={})


def test_finds_the_repository_catalog_by_default() -> None:
    assert model_id("claude", env={}).startswith("claude-")


def test_appends_facts(tmp_path: Path) -> None:
    report = tmp_path / "report.ndjson"
    report_fact("tool_calls", 1, env={"SAYGM_REPORT_FILE": str(report)})
    assert json.loads(report.read_text()) == {"kind": "fact", "name": "tool_calls", "value": 1}


def test_reporting_is_a_no_op_without_a_report_file() -> None:
    report_fact("tool_calls", 1, env={})
