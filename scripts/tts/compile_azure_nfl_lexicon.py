#!/usr/bin/env python3
"""Compile Fanaticosos NFL pronunciation data into Azure PLS and inline SSML."""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

PLS_NS = "http://www.w3.org/2005/01/pronunciation-lexicon"
XML_NS = "http://www.w3.org/XML/1998/namespace"
ET.register_namespace("", PLS_NS)


def load_configuration(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("schemaVersion") != 1:
        raise ValueError("Azure NFL entity schema version must be 1")
    if value.get("locale") != "es-MX":
        raise ValueError("Azure NFL lexicon locale must be es-MX")
    if value.get("voice") not in {
        "es-MX-JorgeMultilingualNeural",
        "en-US-BrianMultilingualNeural",
        "en-US-Brian:DragonHDLatestNeural",
    }:
        raise ValueError("Azure NFL lexicon must define an approved multilingual narrator voice")
    teams = value.get("teams")
    if not isinstance(teams, list) or len(teams) != 32:
        raise ValueError("Azure NFL lexicon must define exactly 32 teams")
    canonicals = [team.get("canonical") for team in teams]
    if len(set(canonicals)) != 32 or any(not isinstance(name, str) for name in canonicals):
        raise ValueError("NFL team canonical names must be unique strings")
    divisions = {team.get("division") for team in teams}
    if divisions != {
        "NFC North", "NFC East", "NFC South", "NFC West",
        "AFC North", "AFC East", "AFC South", "AFC West",
    }:
        raise ValueError("NFL team divisions are incomplete")
    reference_name = value.get("termReference")
    if not isinstance(reference_name, str) or not reference_name:
        raise ValueError("Azure NFL lexicon must define a term reference")
    reference_path = path.parent / reference_name
    reference = json.loads(reference_path.read_text(encoding="utf-8"))
    if reference.get("schemaVersion") != 1 or reference.get("locale") != "es-MX":
        raise ValueError("Spanish NFL term reference is invalid")
    terms = reference.get("terms")
    if not isinstance(terms, list) or not terms:
        raise ValueError("Spanish NFL term reference has no terms")
    canonicals = [term.get("canonical") for term in terms]
    if any(not isinstance(term, str) or not term for term in canonicals):
        raise ValueError("Spanish NFL canonical terms must be non-empty strings")
    if len({term.casefold() for term in canonicals}) != len(canonicals):
        raise ValueError("Spanish NFL canonical terms must be unique")
    for term in terms:
        if not isinstance(term.get("preferredSpanish"), str):
            raise ValueError(f"Spanish NFL term has no preferred usage: {term.get('canonical')}")
        variants = term.get("acceptedSpanish")
        if not isinstance(variants, list) or not variants or any(not isinstance(item, str) for item in variants):
            raise ValueError(f"Spanish NFL term has invalid accepted variants: {term.get('canonical')}")
    tts_entries = reference.get("ttsEntries")
    if not isinstance(tts_entries, list):
        raise ValueError("Spanish NFL term reference has invalid TTS entries")
    value["termReferenceData"] = reference
    database_name = value.get("entityDatabase")
    if not isinstance(database_name, str) or not database_name:
        raise ValueError("Azure NFL lexicon must define an entity database")
    database = json.loads((path.parent / database_name).read_text(encoding="utf-8"))
    if database.get("schemaVersion") != 1 or database.get("season") != 2026:
        raise ValueError("NFL entity database is invalid or stale")
    if len(database.get("teams", [])) != 32:
        raise ValueError("NFL entity database must contain all 32 teams")
    if sum(len(team.get("players", [])) for team in database["teams"]) < 1600:
        raise ValueError("NFL entity database does not contain complete rosters")
    value["entityDatabaseData"] = database
    return value


def pronunciation_entries(configuration: dict[str, Any]) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    explicit_graphemes = {
        form.casefold()
        for item in [*configuration["entities"], *configuration["termReferenceData"]["ttsEntries"]]
        if item.get("status") in {"approved", "provisional"}
        for form in [item["grapheme"], *item.get("writtenForms", [])]
    }
    for team in configuration["teams"]:
        canonical_market = team["canonical"].removesuffix(team["nickname"]).strip()
        if canonical_market.casefold() not in explicit_graphemes:
            entries.append({
                "grapheme": canonical_market,
                "language": "en-US",
                "volume": "-2dB",
            })
        entry = {"grapheme": team["nickname"]}
        if configuration["voice"].startswith("en-US-"):
            entry["language"] = "en-US"
            entry["volume"] = "-2dB"
        elif team.get("nicknamePhoneme"):
            entry["phoneme"] = team["nicknamePhoneme"]
        else:
            entry["alias"] = team["nicknameAlias"]
        entries.append(entry)
        for written_market in team.get("writtenMarkets", []):
            if written_market.casefold() not in explicit_graphemes:
                entries.append({
                    "grapheme": written_market,
                    "language": "en-US",
                    "volume": "-2dB",
                })
    for team in configuration["entityDatabaseData"]["teams"]:
        for player in team["players"]:
            if player["name"].casefold() in explicit_graphemes:
                continue
            entry = {
                "grapheme": player["name"],
                "language": "en-US",
                "volume": "-2dB",
                "caseSensitive": True,
            }
            if player.get("alias") and not configuration["voice"].startswith("en-US-"):
                entry["alias"] = player["alias"]
            entries.append(entry)
            for written_form in player.get("writtenForms", []):
                if written_form.casefold() in explicit_graphemes:
                    continue
                entries.append({**entry, "grapheme": written_form})
    referenced_terms = configuration["termReferenceData"]["ttsEntries"]
    for item in [*configuration["entities"], *referenced_terms]:
        if item.get("status") not in {"approved", "provisional"}:
            continue
        entry = {"grapheme": item["grapheme"]}
        english_native = (
            configuration["voice"].startswith("en-US-")
            and item.get("language") == "en-US"
        )
        if english_native:
            entry["language"] = "en-US"
            entry["volume"] = item.get("volume", "-2dB")
        elif item.get("narratorPhoneme"):
            entry["phoneme"] = item["narratorPhoneme"]
        elif item.get("narratorAlias"):
            entry["alias"] = item["narratorAlias"]
        elif item.get("language"):
            entry["language"] = item["language"]
            entry["volume"] = item.get("volume", "-2dB")
            if item.get("alias"):
                entry["alias"] = item["alias"]
        elif item.get("phoneme"):
            entry["phoneme"] = item["phoneme"]
        elif item.get("alias"):
            entry["alias"] = item["alias"]
        elif not item.get("language"):
            raise ValueError(f"entity has no pronunciation: {item['grapheme']}")
        entries.append(entry)
        # Articles commonly introduce a player by full name and then use only
        # the surname. Keep both forms on the same reviewed pronunciation rule
        # so later references do not fall back to Spanish letter sounds.
        for written_form in item.get("writtenForms", []):
            variant = {**entry, "grapheme": written_form}
            narrator_variant = item.get("narratorWrittenFormAliases", {}).get(written_form)
            if english_native:
                variant.pop("alias", None)
                variant["language"] = "en-US"
                variant["volume"] = item.get("volume", "-2dB")
            elif narrator_variant:
                variant.pop("language", None)
                variant["alias"] = narrator_variant
            elif entry.get("alias") and item.get("writtenFormAliases", {}).get(written_form):
                variant["alias"] = item["writtenFormAliases"][written_form]
            entries.append(variant)
    seen: dict[tuple[str, bool], dict[str, Any]] = {}
    unique_entries: list[dict[str, Any]] = []
    for entry in entries:
        normalized = (entry["grapheme"].casefold(), bool(entry.get("caseSensitive")))
        if normalized in seen:
            existing_rule = {key: value for key, value in seen[normalized].items() if key != "grapheme"}
            candidate_rule = {key: value for key, value in entry.items() if key != "grapheme"}
            if existing_rule != candidate_rule:
                raise ValueError(f"conflicting lexicon grapheme: {entry['grapheme']}")
            continue
        seen[normalized] = entry
        unique_entries.append(entry)
        if "phoneme" in entry and re.search(r"\s", entry["phoneme"]):
            raise ValueError(f"IPA phoneme cannot contain whitespace: {entry['grapheme']}")
    return sorted(unique_entries, key=lambda item: item["grapheme"].casefold())


def compile_pls(configuration: dict[str, Any]) -> bytes:
    root = ET.Element(
        f"{{{PLS_NS}}}lexicon",
        {
            "version": "1.0",
            "alphabet": "ipa",
            f"{{{XML_NS}}}lang": configuration["locale"],
        },
    )
    for entry in pronunciation_entries(configuration):
        if "language" in entry:
            continue
        lexeme = ET.SubElement(root, f"{{{PLS_NS}}}lexeme")
        ET.SubElement(lexeme, f"{{{PLS_NS}}}grapheme").text = entry["grapheme"]
        element = "phoneme" if "phoneme" in entry else "alias"
        ET.SubElement(lexeme, f"{{{PLS_NS}}}{element}").text = entry[element]
    ET.indent(root, space="  ")
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def inline_entries(configuration: dict[str, Any]) -> list[dict[str, Any]]:
    return sorted(
        pronunciation_entries(configuration),
        key=lambda item: len(item["grapheme"]),
        reverse=True,
    )


def apply_inline_ssml(text: str, configuration: dict[str, Any]) -> str:
    from xml.sax.saxutils import escape, quoteattr

    entries = inline_entries(configuration)
    if not entries:
        return escape(text)
    matches: list[tuple[int, int, dict[str, Any]]] = []
    for case_sensitive in (False, True):
        selected = [item for item in entries if bool(item.get("caseSensitive")) is case_sensitive]
        if not selected:
            continue
        pattern = re.compile(
            rf"(?<!\w)({'|'.join(re.escape(item['grapheme']) for item in selected)})(?!\w)",
            flags=0 if case_sensitive else re.IGNORECASE,
        )
        lookup = {
            (item["grapheme"] if case_sensitive else item["grapheme"].casefold()): item
            for item in selected
        }
        for match in pattern.finditer(text):
            key = match.group(0) if case_sensitive else match.group(0).casefold()
            matches.append((match.start(), match.end(), lookup[key]))
    matches.sort(key=lambda item: (item[0], -(item[1] - item[0]), not bool(item[2].get("caseSensitive"))))
    parts: list[str] = []
    automatic_multilingual = configuration["voice"].endswith(":DragonHDLatestNeural")
    def spanish(value: str) -> str:
        if not value:
            return ""
        return escape(value) if automatic_multilingual else f'<lang xml:lang="{configuration["locale"]}">{escape(value)}</lang>'
    cursor = 0
    for start, end, entry in matches:
        if start < cursor:
            continue
        parts.append(spanish(text[cursor:start]))
        written = text[start:end]
        if "phoneme" in entry:
            parts.append(
                f"<phoneme alphabet=\"ipa\" ph={quoteattr(entry['phoneme'])}>"
                f"{escape(written)}</phoneme>"
            )
        elif "language" in entry and automatic_multilingual:
            parts.append(escape(written))
        elif "language" in entry:
            spoken = escape(written)
            if entry.get("alias"):
                spoken = f"<sub alias={quoteattr(entry['alias'])}>{spoken}</sub>"
            parts.append(
                f"<lang xml:lang={quoteattr(entry['language'])}>{spoken}</lang>"
            )
        else:
            parts.append(f"<sub alias={quoteattr(entry['alias'])}>{escape(written)}</sub>")
        cursor = end
    parts.append(spanish(text[cursor:]))
    return "".join(parts)


def voice_segments(text: str, configuration: dict[str, Any]) -> list[dict[str, str]]:
    """Return one Spanish narrator segment with inline pronunciation corrections."""
    return [{"voice": configuration["voice"], "markup": apply_inline_ssml(text, configuration)}]


def write_outputs(configuration_path: Path, output_path: Path) -> None:
    configuration = load_configuration(configuration_path)
    output = compile_pls(configuration)
    if len(output) > 100 * 1024:
        raise ValueError("compiled Azure lexicon exceeds 100 KB")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(output)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--configuration", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    write_outputs(args.configuration, args.output)
    configuration = load_configuration(args.configuration)
    print(
        f"Compiled {len(pronunciation_entries(configuration))} pronunciations "
        f"for {len(configuration['teams'])} NFL teams."
    )


if __name__ == "__main__":
    main()
