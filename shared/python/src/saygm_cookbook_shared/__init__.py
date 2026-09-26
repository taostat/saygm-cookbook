"""Model roles and run reporting shared by the SayGM cookbook examples."""

import json
import os
from collections.abc import Mapping
from pathlib import Path

from saygm_cookbook_shared.meter import install_meter

DEFAULT_CATALOG = Path(__file__).resolve().parents[4] / "catalog.json"


class CatalogError(Exception):
    """catalog.json is missing, malformed, or has no model for a role."""


def model_id(
    role: str,
    *,
    catalog_path: Path = DEFAULT_CATALOG,
    env: Mapping[str, str] | None = None,
) -> str:
    """Return the model id for a role, preferring a SAYGM_MODEL_<ROLE> env override.

    Args:
        role: A role name from the "roles" section of catalog.json, such as "claude".
        catalog_path: The catalog to read. Defaults to the repository's catalog.json.
        env: The environment to read overrides from. Defaults to os.environ.

    Raises:
        CatalogError: The catalog cannot be read or does not define the role.
    """
    env = os.environ if env is None else env
    override = env.get(f"SAYGM_MODEL_{role.upper()}")
    if override:
        return override
    roles = _read_roles(catalog_path)
    entry = roles.get(role)
    if entry is None:
        known = ", ".join(sorted(roles))
        msg = f'unknown model role "{role}"; known roles: {known} ({catalog_path})'
        raise CatalogError(msg)
    if not isinstance(entry, dict) or not isinstance(entry.get("model"), str):
        msg = f'role "{role}" has no model in {catalog_path}'
        raise CatalogError(msg)
    return entry["model"]


def _read_roles(catalog_path: Path) -> dict[str, object]:
    try:
        text = catalog_path.read_text()
    except OSError as error:
        msg = f"cannot read {catalog_path}: {error}"
        raise CatalogError(msg) from error
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as error:
        msg = f"{catalog_path} is not valid JSON: {error}"
        raise CatalogError(msg) from error
    roles = parsed.get("roles") if isinstance(parsed, dict) else None
    if not isinstance(roles, dict):
        msg = f'{catalog_path} has no "roles" object'
        raise CatalogError(msg)
    return roles


def meter_api_calls(*, env: Mapping[str, str] | None = None) -> None:
    """Record every SayGM API call's usage to SAYGM_REPORT_FILE, when the runner sets it."""
    path = _report_path(env)
    if path is not None:
        install_meter(path)


def report_fact(name: str, value: object, *, env: Mapping[str, str] | None = None) -> None:
    """Append a named observation for checks.json to SAYGM_REPORT_FILE, when the runner sets it."""
    path = _report_path(env)
    if path is not None:
        _append(path, {"kind": "fact", "name": name, "value": value})


def _report_path(env: Mapping[str, str] | None) -> Path | None:
    env = os.environ if env is None else env
    path = env.get("SAYGM_REPORT_FILE")
    return Path(path) if path else None


def _append(path: Path, record: dict[str, object]) -> None:
    with path.open("a") as report:
        report.write(json.dumps(record) + "\n")
