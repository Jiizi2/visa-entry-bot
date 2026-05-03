export function buildRememberedRecentBatches(entries, path, totalFiles = 0, manifestPath = "", basenameFromPath) {
  const normalized = String(path ?? "").trim();
  if (!normalized) {
    return entries;
  }

  const safeEntries = Array.isArray(entries) ? entries : [];
  const existing = safeEntries.find((entry) => entry.path === normalized);
  const normalizedManifestPath = String(manifestPath || existing?.manifestPath || "").trim();
  const nextEntry = {
    path: normalized,
    label: basenameFromPath(normalized),
    usedAt: new Date().toISOString(),
    totalFiles: Number(totalFiles) > 0 ? Number(totalFiles) : Number(existing?.totalFiles ?? 0),
    manifestPath: normalizedManifestPath,
  };

  return [
    nextEntry,
    ...safeEntries.filter((entry) => entry.path !== normalized),
  ].slice(0, 6);
}

export function loadRecentBatches(storageKey, basenameFromPath) {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry) => entry && typeof entry.path === "string" && entry.path.trim())
      .slice(0, 6)
      .map((entry) => ({
        path: entry.path,
        label: typeof entry.label === "string" && entry.label ? entry.label : basenameFromPath(entry.path),
        usedAt: typeof entry.usedAt === "string" ? entry.usedAt : new Date().toISOString(),
        totalFiles: Number(entry.totalFiles) > 0 ? Number(entry.totalFiles) : 0,
        manifestPath: typeof entry.manifestPath === "string" ? entry.manifestPath : "",
      }));
  } catch {
    return [];
  }
}

export function saveRecentBatches(storageKey, entries) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(entries));
  } catch {
    // Ignore local storage failures in desktop runtime.
  }
}
