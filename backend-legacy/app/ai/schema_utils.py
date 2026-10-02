from __future__ import annotations

from typing import Any


def instruction_schema_to_json_schema(value: Any) -> dict[str, Any]:
    schema = _convert(value)
    if schema.get("type") != "object":
        schema = {
            "type": "object",
            "properties": {"result": schema},
            "required": ["result"],
            "additionalProperties": False,
        }
    schema.setdefault("additionalProperties", False)
    return schema


def _convert(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        properties = {key: _convert(item) for key, item in value.items()}
        return {
            "type": "object",
            "properties": properties,
            "required": list(value.keys()),
            "additionalProperties": False,
        }

    if isinstance(value, list):
        item_schema = _convert(value[0]) if value else {"type": "string"}
        return {"type": "array", "items": item_schema}

    if not isinstance(value, str):
        if isinstance(value, bool):
            return {"type": "boolean"}
        if isinstance(value, int):
            return {"type": "integer"}
        if isinstance(value, float):
            return {"type": "number"}
        return {"type": "string"}

    raw = value.strip()
    lower = raw.lower()

    if " or null" in lower:
        base = raw[: lower.index(" or null")].strip()
        return {"anyOf": [_convert(base), {"type": "null"}]}

    if "|" in raw:
        enum_values = [part.strip() for part in raw.split("|") if part.strip()]
        if enum_values:
            return {"type": "string", "enum": enum_values}

    if lower.startswith("integer"):
        return {"type": "integer"}
    if lower.startswith("number"):
        return {"type": "number"}
    if lower.startswith("boolean"):
        return {"type": "boolean"}
    if lower.startswith("array"):
        return {"type": "array", "items": {"type": "string"}}
    if lower.startswith("object"):
        return {"type": "object", "properties": {}, "additionalProperties": True}
    if lower.startswith("string"):
        return {"type": "string"}

    return {"type": "string"}
