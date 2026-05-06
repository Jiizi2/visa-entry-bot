(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const {
    DEFAULT_REPO_ROOT,
    FILE_URI_RE,
  } = root.constants || {};
  const {
    isAbsoluteFilePath,
    normalizeWindowsSlashes,
    parentDirectory,
    joinWindowsPath,
    rootPathBeforeSegment,
    uploadKeysShareSuffix,
    fileLookupKeys,
    pathLookupKeys,
  } = root.pathUtils || {};
  if (!isAbsoluteFilePath || !fileLookupKeys || !pathLookupKeys) {
    throw new Error("NusukAutofill upload file store dependencies were not loaded.");
  }

  const UPLOAD_CACHE_DB = "nusuk-autofill-upload-cache";
  const UPLOAD_CACHE_STORE = "files";

  function createUploadFileStore({ state }) {
    const uploadFilesByKey = new Map();
    const duplicateUploadKeys = new Set();
    let uploadEntries = [];
    let uploadFileCount = 0;
    let uploadFileNames = [];
    let cacheReady = hydrateCachedUploadFiles();
    let pendingCacheSaveTimer = 0;

    function registerUploadFiles(files) {
      const entries = Array.from(files || []).filter(isUsableUploadFile).map(toUploadEntry);
      indexUploadEntries(entries);
      scheduleSaveUploadEntriesToCache(entries);
    }

    function indexUploadEntries(entries) {
      uploadFilesByKey.clear();
      duplicateUploadKeys.clear();
      uploadEntries = entries;
      uploadFileCount = uploadEntries.length;
      uploadFileNames = uploadEntries.slice(0, 5).map((entry) => entry.webkitRelativePath || entry.name);

      const filesByKey = new Map();
      for (const entry of uploadEntries) {
        for (const key of uploadEntryLookupKeys(entry)) {
          const bucket = filesByKey.get(key) || [];
          bucket.push(entry.file);
          filesByKey.set(key, bucket);
        }
      }

      for (const [key, bucket] of filesByKey) {
        if (bucket.length === 1) {
          uploadFilesByKey.set(key, bucket[0]);
        } else {
          duplicateUploadKeys.add(key);
        }
      }
    }

    function isUsableUploadFile(value) {
      if (!value || typeof value !== "object") {
        return false;
      }
      const looksLikeFile = value instanceof File
        || (Object.prototype.toString.call(value) === "[object File]"
          && typeof value.name === "string"
          && typeof value.size === "number");
      if (!looksLikeFile) {
        return false;
      }
      return isPassportUploadCandidate(value);
    }

    function isPassportUploadCandidate(file) {
      const name = String(file?.name || "").toLowerCase();
      const type = String(file?.type || "").toLowerCase();
      if (!name || name.endsWith(".json")) {
        return false;
      }
      return type.startsWith("image/")
        || type === "application/pdf"
        || /\.(png|jpe?g|webp|bmp|gif|pdf)$/i.test(name);
    }

    function toUploadEntry(file, fallback = {}) {
      return {
        file,
        name: String(fallback.name || file.name || ""),
        webkitRelativePath: String(fallback.webkitRelativePath || file.webkitRelativePath || ""),
        size: Number(fallback.size || file.size || 0),
        lastModified: Number(fallback.lastModified || file.lastModified || 0),
      };
    }

    function uploadEntryLookupKeys(entry) {
      const keys = [
        ...fileLookupKeys(entry.file),
        ...pathLookupKeys(entry.webkitRelativePath),
        ...pathLookupKeys(entry.name),
      ];
      return Array.from(new Set(keys.filter(Boolean)));
    }

    async function resolveSelectedUploadFile(rawPath, context) {
      if (!uploadEntries.length) {
        await cacheReady.catch(() => {});
      }
      const candidates = [
        rawPath,
        resolveUploadFilePath(rawPath, context),
        context?.member?.fileName,
        context?.member?.passportImagePath,
        context?.member?.passportExtracted?.fileName,
      ].filter(Boolean);

      for (const candidate of candidates) {
        for (const key of pathLookupKeys(candidate)) {
          const file = uploadFilesByKey.get(key);
          if (file) {
            return file;
          }
        }
        const suffixFile = findUploadFileBySuffix(candidate);
        if (suffixFile) {
          return suffixFile;
        }
      }
      return null;
    }

    function findUploadFileBySuffix(candidate) {
      for (const candidateKey of pathLookupKeys(candidate)) {
        const matches = uploadEntries.filter((entry) => uploadEntryLookupKeys(entry).some((fileKey) => uploadKeysShareSuffix(fileKey, candidateKey)));
        if (matches.length === 1) {
          return matches[0].file;
        }
      }
      return null;
    }

    async function hydrateCachedUploadFiles() {
      const records = await readCachedUploadEntries().catch(() => []);
      if (!uploadEntries.length && records.length) {
        indexUploadEntries(records);
      }
    }

    async function saveUploadEntriesToCache(entries) {
      cacheReady = (async () => {
        const db = await openUploadCacheDb();
        if (!db) {
          return;
        }
        await withStoreTransaction(db, "readwrite", (store) => {
          store.clear();
          for (const entry of entries) {
            store.put({
              id: uploadEntryCacheId(entry),
              name: entry.name,
              webkitRelativePath: entry.webkitRelativePath,
              size: entry.size,
              lastModified: entry.lastModified,
              file: entry.file,
            });
          }
        });
      })();
      await cacheReady.catch(() => {});
    }

    function scheduleSaveUploadEntriesToCache(entries) {
      if (pendingCacheSaveTimer) {
        window.clearTimeout(pendingCacheSaveTimer);
      }
      cacheReady = Promise.resolve();
      pendingCacheSaveTimer = window.setTimeout(() => {
        pendingCacheSaveTimer = 0;
        void saveUploadEntriesToCache(entries);
      }, 3000);
    }

    async function readCachedUploadEntries() {
      const db = await openUploadCacheDb();
      if (!db) {
        return [];
      }
      const records = await withStoreTransaction(db, "readonly", (store) => store.getAll());
      return Array.from(records || [])
        .filter((record) => isUsableUploadFile(record?.file))
        .map((record) => toUploadEntry(record.file, record));
    }

    function uploadEntryCacheId(entry) {
      return `${entry.webkitRelativePath || entry.name}::${entry.size}::${entry.lastModified}`;
    }

    function openUploadCacheDb() {
      if (!window.indexedDB) {
        return Promise.resolve(null);
      }
      return new Promise((resolve, reject) => {
        const request = window.indexedDB.open(UPLOAD_CACHE_DB, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(UPLOAD_CACHE_STORE)) {
            db.createObjectStore(UPLOAD_CACHE_STORE, { keyPath: "id" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Gagal membuka cache file upload."));
      });
    }

    function withStoreTransaction(db, mode, useStore) {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(UPLOAD_CACHE_STORE, mode);
        const store = transaction.objectStore(UPLOAD_CACHE_STORE);
        const request = useStore(store);
        let result;
        if (request && "onsuccess" in request) {
          request.onsuccess = () => {
            result = request.result;
          };
          request.onerror = () => reject(request.error || new Error("Operasi cache file gagal."));
        }
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error || new Error("Transaksi cache file gagal."));
        transaction.onabort = () => reject(transaction.error || new Error("Transaksi cache file dibatalkan."));
      });
    }

    function describeSelectedUploadExamples() {
      if (!uploadFileNames.length) {
        return "";
      }
      return ` File terpilih contoh: ${uploadFileNames.join(", ")}${uploadFileCount > uploadFileNames.length ? ", ..." : ""}.`;
    }

    function resolveUploadFilePath(rawValue, context) {
      const trimmed = String(rawValue || "").trim();
      if (!trimmed) {
        return "";
      }

      if (FILE_URI_RE.test(trimmed)) {
        return decodeURIComponent(trimmed.replace(FILE_URI_RE, "").replace(/\//g, "\\"));
      }

      if (isAbsoluteFilePath(trimmed)) {
        return normalizeWindowsSlashes(trimmed);
      }

      const normalizedRelative = trimmed.replace(/^\.?[\\/]+/, "");
      const manifestPath = String(context?.manifestPath || state.manifest?.manifestPath || "").trim();
      const candidates = [];
      const firstSegment = normalizedRelative.split(/[\\/]+/).filter(Boolean)[0] || "";

      if (manifestPath && isAbsoluteFilePath(manifestPath)) {
        const manifestDir = parentDirectory(manifestPath);
        if (manifestDir) {
          candidates.push(joinWindowsPath(manifestDir, normalizedRelative));
        }

        if (firstSegment) {
          const rootBeforeSegment = rootPathBeforeSegment(manifestPath, firstSegment);
          if (rootBeforeSegment) {
            candidates.push(joinWindowsPath(rootBeforeSegment, normalizedRelative));
          }
        }
      }

      if (firstSegment && DEFAULT_REPO_ROOT) {
        candidates.push(joinWindowsPath(DEFAULT_REPO_ROOT, normalizedRelative));
        if (firstSegment.toLowerCase() !== "data" && /^(passports?|images?|files?)$/i.test(firstSegment)) {
          candidates.push(joinWindowsPath(DEFAULT_REPO_ROOT, joinWindowsPath("data", normalizedRelative)));
        }
      }

      candidates.push(normalizeWindowsSlashes(trimmed));
      return candidates.find(Boolean) || normalizeWindowsSlashes(trimmed);
    }

    function buildUploadFailureMessage(rawPath, resolvedPath, rawError) {
      const detail = String(rawError || "").trim();
      const base = detail || "File passport belum dipilih di panel extension.";
      const examples = describeSelectedUploadExamples();
      const duplicateHint = duplicateUploadKeys.size
        ? " Ada nama file duplikat di pilihan, jadi pilih folder yang lebih spesifik bila perlu."
        : "";
      if (rawPath !== resolvedPath) {
        return `${base} Path JSON: ${rawPath}. Dicari sebagai: ${resolvedPath}. Pilih folder/file passport yang sesuai.${examples}${duplicateHint}`;
      }
      return `${base} Path: ${resolvedPath}. Pilih folder/file passport yang sesuai.${examples}${duplicateHint}`;
    }

    function getUploadState() {
      return { uploadFileCount, uploadFileNames };
    }

    return {
      registerUploadFiles,
      getUploadState,
      resolveUploadFilePath,
      resolveSelectedUploadFile,
      buildUploadFailureMessage,
    };
  }

  root.uploadFileStore = Object.freeze({
    createUploadFileStore,
  });
})();
