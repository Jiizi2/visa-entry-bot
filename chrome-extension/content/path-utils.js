(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const { WINDOWS_ABSOLUTE_PATH_RE } = root.constants || {};
  if (!WINDOWS_ABSOLUTE_PATH_RE) {
    throw new Error("NusukAutofill constants were not loaded.");
  }

  function isAbsoluteFilePath(value) {
    return WINDOWS_ABSOLUTE_PATH_RE.test(String(value || "").trim()) || String(value || "").startsWith("\\\\");
  }

  function normalizeWindowsSlashes(value) {
    return String(value || "").replace(/\//g, "\\");
  }

  function parentDirectory(filePath) {
    const normalized = normalizeWindowsSlashes(filePath).replace(/[\\]+$/, "");
    const index = normalized.lastIndexOf("\\");
    return index > 1 ? normalized.slice(0, index) : "";
  }

  function joinWindowsPath(basePath, suffixPath) {
    const safeBase = normalizeWindowsSlashes(basePath).replace(/[\\]+$/, "");
    const safeSuffix = normalizeWindowsSlashes(suffixPath).replace(/^[\\]+/, "");
    return safeBase && safeSuffix ? `${safeBase}\\${safeSuffix}` : safeBase || safeSuffix;
  }

  function rootPathBeforeSegment(fullPath, segment) {
    const normalizedPath = normalizeWindowsSlashes(fullPath).toLowerCase();
    const normalizedSegment = `\\${String(segment || "").toLowerCase()}\\`;
    const index = normalizedPath.indexOf(normalizedSegment);
    if (index <= 0) {
      return "";
    }
    return normalizeWindowsSlashes(fullPath).slice(0, index);
  }

  function stripExtension(value) {
    return String(value || "").replace(/\.[^.\\/]+$/, "");
  }

  function basenameFromAnyPath(value) {
    const normalized = String(value || "").replace(/\\/g, "/");
    return normalized.split("/").filter(Boolean).pop() || normalized;
  }

  function normalizeUploadKey(value) {
    return String(value || "")
      .trim()
      .replace(/^file:\/\//i, "")
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .toLowerCase();
  }

  function uniqueFileKeys(values) {
    const out = [];
    const seen = new Set();
    for (const value of values) {
      const key = normalizeUploadKey(value);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(key);
    }
    return out;
  }

  function uploadKeysShareSuffix(left, right) {
    const a = normalizeUploadKey(left);
    const b = normalizeUploadKey(right);
    if (!a || !b || a === b) {
      return false;
    }
    return a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
  }

  function fileLookupKeys(file) {
    return uniqueFileKeys([
      file.name,
      file.webkitRelativePath,
      basenameFromAnyPath(file.webkitRelativePath || file.name),
      stripExtension(basenameFromAnyPath(file.webkitRelativePath || file.name)),
    ]);
  }

  function pathLookupKeys(pathValue) {
    const text = String(pathValue || "").trim();
    return uniqueFileKeys([
      text,
      normalizeUploadKey(text),
      basenameFromAnyPath(text),
      stripExtension(basenameFromAnyPath(text)),
    ]);
  }

  root.pathUtils = Object.freeze({
    isAbsoluteFilePath,
    normalizeWindowsSlashes,
    parentDirectory,
    joinWindowsPath,
    rootPathBeforeSegment,
    stripExtension,
    basenameFromAnyPath,
    normalizeUploadKey,
    uploadKeysShareSuffix,
    fileLookupKeys,
    pathLookupKeys,
  });
})();
