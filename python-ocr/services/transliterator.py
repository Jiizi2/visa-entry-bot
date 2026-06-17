from __future__ import annotations

import json
import re
from pathlib import Path

CORE_WORD_OVERRIDES = {
    "ABRAR": "\u0623\u0628\u0631\u0627\u0631",
    "ABDULLAH": "\u0639\u0628\u062f\u0627\u0644\u0644\u0647",
    "ABDILLAH": "\u0639\u0628\u062f\u0627\u0644\u0644\u0647",
    "AHMAD": "\u0623\u062d\u0645\u062f",
    "AHMED": "\u0623\u062d\u0645\u062f",
    "AISHA": "\u0639\u0627\u0626\u0634\u0629",
    "AISYAH": "\u0639\u0627\u0626\u0634\u0629",
    "ALI": "\u0639\u0644\u064a",
    "ALLAH": "\u0627\u0644\u0644\u0647",
    "ATTALLAH": "\u0639\u0637\u0627\u0644\u0644\u0647",
    "ATALLAH": "\u0639\u0637\u0627\u0644\u0644\u0647",
    "DZAKI": "\u0632\u0643\u064a",
    "FADHIL": "\u0641\u0636\u0644",
    "FADIL": "\u0641\u0627\u0636\u0644",
    "FATHIMAH": "\u0641\u0627\u0637\u0645\u0629",
    "FATIMAH": "\u0641\u0627\u0637\u0645\u0629",
    "FARISI": "\u0641\u0627\u0631\u0633\u064a",
    "HASAN": "\u062d\u0633\u0646",
    "HUSAIN": "\u062d\u0633\u064a\u0646",
    "HUSSEIN": "\u062d\u0633\u064a\u0646",
    "IMAM": "\u0625\u0645\u0627\u0645",
    "MOHAMED": "\u0645\u062d\u0645\u062f",
    "MOHAMMAD": "\u0645\u062d\u0645\u062f",
    "MAULANA": "\u0645\u0648\u0644\u0627\u0646\u0627",
    "MUHAMMAD": "\u0645\u062d\u0645\u062f",
    "NUR": "\u0646\u0648\u0631",
    "RAHMAN": "\u0631\u062d\u0645\u0646",
    "RAHMAT": "\u0631\u062d\u0645\u062a",
    "RIDHA": "\u0631\u0636\u0627",
    "RIDHO": "\u0631\u0636\u0627",
    "SITI": "\u0633\u064a\u062a\u064a",
    "SYAFI": "\u0634\u0627\u0641\u0639\u064a",
    "SYAFII": "\u0634\u0627\u0641\u0639\u064a",
    "UMAR": "\u0639\u0645\u0631",
    "YUSUF": "\u064a\u0648\u0633\u0641",
    "YOUSEF": "\u064a\u0648\u0633\u0641",
    "ZAKI": "\u0632\u0643\u064a",
}

MULTI_CHAR_RULES = {
    "aa": "\u0627",
    "ee": "\u064a",
    "ii": "\u064a",
    "sy": "\u0634",
    "sh": "\u0634",
    "kh": "\u062e",
    "dz": "\u0632",
    "gh": "\u063a",
    "th": "\u062b",
    "dh": "\u0636",
    "ng": "\u0646\u063a",
    "ny": "\u0646\u064a",
    "oo": "\u0648",
    "ou": "\u0648",
    "uu": "\u0648",
}

TOKEN_OVERRIDES = {
    "AL": "\u0627\u0644",
    "BIN": "\u0628\u0646",
    "BINT": "\u0628\u0646\u062a",
    "BINTI": "\u0628\u0646\u062a",
    "BT": "\u0628\u0646\u062a",
    "BTE": "\u0628\u0646\u062a",
    "EL": "\u0627\u0644",
    "IBN": "\u0628\u0646",
}

VOWELS = {"a", "e", "i", "o", "u"}

BASIC_CHAR_MAP = {
    "b": "\u0628",
    "c": "\u0643",
    "d": "\u062f",
    "f": "\u0641",
    "g": "\u062c",
    "h": "\u0647",
    "j": "\u062c",
    "k": "\u0643",
    "l": "\u0644",
    "m": "\u0645",
    "n": "\u0646",
    "p": "\u0628",
    "q": "\u0642",
    "r": "\u0631",
    "s": "\u0633",
    "t": "\u062a",
    "v": "\u0641",
    "w": "\u0648",
    "x": "\u0643\u0633",
    "y": "\u064a",
    "z": "\u0632",
}

_BATCH_OVERRIDES_PATH = Path(__file__).with_name("data").joinpath("arabic_name_overrides.json")
_ARABIC_SCRIPT_PATTERN = re.compile(r"[\u0600-\u06FF]")


def _load_batch_word_overrides() -> ParsedPassportData:
    try:
        raw = json.loads(_BATCH_OVERRIDES_PATH.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}

    if not isinstance(raw, dict):
        return {}

    loaded: dict[str, str] = {}
    for key, value in raw.items():
        if not isinstance(key, str) or not isinstance(value, str):
            continue
        normalized_key = re.sub(r"[^A-Z]", "", key.upper())
        normalized_value = re.sub(r"\s+", " ", value).strip()
        if len(normalized_key) < 2 or len(normalized_key) > 40:
            continue
        if not normalized_value or not _ARABIC_SCRIPT_PATTERN.search(normalized_value):
            continue
        loaded[normalized_key] = normalized_value
    return loaded


BATCH_WORD_OVERRIDES = _load_batch_word_overrides()
WORD_OVERRIDES = {**CORE_WORD_OVERRIDES, **BATCH_WORD_OVERRIDES}


def transliterate_name(name: str) -> str:
    normalized = _normalize_name(name)
    if not normalized:
        return ""

    tokens = normalized.split()
    words: list[str] = []
    index = 0

    while index < len(tokens):
        token = tokens[index]
        uppercase_token = token.upper()

        if uppercase_token in {"ABDUL", "ABD"} and index + 1 < len(tokens) and tokens[index + 1].upper() == "ALLAH":
            words.append("\u0639\u0628\u062f")
            words.append(WORD_OVERRIDES["ALLAH"])
            index += 2
            continue

        if uppercase_token in TOKEN_OVERRIDES:
            words.append(TOKEN_OVERRIDES[uppercase_token])
            index += 1
            continue

        words.append(transliterate_word(token))
        index += 1

    return " ".join(word for word in words if word)


def transliterate_word(word: str) -> str:
    uppercase_word = word.upper()
    override_key = uppercase_word.replace("'", "")
    if override_key in WORD_OVERRIDES:
        return WORD_OVERRIDES[override_key]

    if uppercase_word.endswith("ALLAH") and len(uppercase_word) > 5:
        prefix = uppercase_word[:-5]
        prefix_text = transliterate_word(prefix.lower())
        return f"{prefix_text}{WORD_OVERRIDES['ALLAH']}" if prefix_text else WORD_OVERRIDES["ALLAH"]

    letters: list[str] = []
    index = 0

    while index < len(word):
        pattern = word[index : index + 2]
        if pattern in MULTI_CHAR_RULES:
            letters.append(MULTI_CHAR_RULES[pattern])
            index += 2
            continue

        character = word[index]
        if character in VOWELS:
            mapped_vowel = _map_vowel(word, index, character)
            if mapped_vowel:
                letters.append(mapped_vowel)
            index += 1
            continue
        if character == "'":
            letters.append(_apostrophe_marker(word, index))
            index += 1
            continue
        if character in BASIC_CHAR_MAP:
            letters.append(BASIC_CHAR_MAP[character])
        index += 1

    return "".join(letters)


def _normalize_name(name: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z\s\-']", " ", name or "")
    cleaned = cleaned.replace("-", " ")
    return re.sub(r"\s+", " ", cleaned).strip().lower()


def _map_vowel(word: str, index: int, character: str) -> str:
    if index == 0:
        return "\u0627" if character in {"a", "e", "i"} else "\u0648"

    if index == len(word) - 1:
        if character in {"a"}:
            return "\u0627"
        if character in {"e", "i"}:
            return "\u064a"
        return "\u0648"

    if len(word) <= 4:
        if character in {"a"}:
            return "\u0627"
        if character in {"e", "i"}:
            return "\u064a"
        return "\u0648"

    if character in {"a"}:
        return ""
    if character in {"e", "i"}:
        return "\u064a"
    return "\u0648"


def _apostrophe_marker(word: str, index: int) -> str:
    previous_char = word[index - 1] if index > 0 else ""
    next_char = word[index + 1] if index + 1 < len(word) else ""

    if previous_char in VOWELS and next_char in VOWELS:
        return "\u0621"
    if not previous_char and next_char in VOWELS:
        return "\u0639"
    if next_char in VOWELS:
        return "\u0639"
    return "\u0621"
