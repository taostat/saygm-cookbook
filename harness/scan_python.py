"""Print the string constants and model_id() roles of Python source read from stdin as JSON."""

import ast
import json
import sys


def _calls(call: ast.Call, name: str) -> bool:
    return isinstance(call.func, ast.Name) and call.func.id == name


def _role_argument(call: ast.Call) -> str | None:
    first = call.args[0] if call.args else None
    if isinstance(first, ast.Constant) and isinstance(first.value, str):
        return first.value
    return None


def scan(source: str, filename: str) -> dict[str, list[dict[str, object]]]:
    """Collect string constants and model_id() roles, each with its line number.

    Raises:
        SyntaxError: The source does not parse.
    """
    strings: list[tuple[int, str]] = []
    roles: list[tuple[int, str | None]] = []
    for node in ast.walk(ast.parse(source, filename=filename)):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            strings.append((node.lineno, node.value))
        elif isinstance(node, ast.Call) and _calls(node, "model_id"):
            roles.append((node.lineno, _role_argument(node)))
    return {
        "strings": [{"value": value, "line": line} for line, value in sorted(strings)],
        "roles": [{"role": role, "line": line} for line, role in sorted(roles, key=lambda r: r[0])],
    }


def main() -> int:
    """Scan stdin as the file named by the first argument and print the result as JSON."""
    filename = sys.argv[1]
    try:
        result = scan(sys.stdin.read(), filename)
    except SyntaxError as error:
        print(f"{filename}:{error.lineno}: {error.msg}", file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
