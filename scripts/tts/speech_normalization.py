#!/usr/bin/env python3
import json
import re
from pathlib import Path

def normalize_speech(text: str, locale: str, configuration: Path) -> str:
    value = json.loads(configuration.read_text(encoding="utf-8"))
    if value.get("schemaVersion") != 1:
        raise ValueError("speech normalization schema is invalid")
    result = text
    for rule in value.get("rules", []):
        if locale in rule.get("locales", []):
            result = re.sub(rule["pattern"], rule["replacement"], result, flags=re.IGNORECASE)
    return result
