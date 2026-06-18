def normalize_filesystem_path(path: str) -> str:
    """Normalize Windows extended-length path prefixes."""
    text = str(path or "").strip()
    if text.startswith("\\\\?\\UNC\\"):
        return "\\\\" + text[8:]
    if text.startswith("\\\\?\\"):
        return text[4:]
    return text
