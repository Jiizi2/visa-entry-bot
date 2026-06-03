import {
  ensureResolvedProfile,
} from "./main-members.js";
import {
  setValueByPath,
  valueByPath,
} from "./main-utils.js";

export const ENTRY_DEFAULT_FIELD_DEFS = Object.freeze([
  Object.freeze({ key: "profession", label: "Profesi", profilePath: "profession" }),
  Object.freeze({ key: "maritalStatus", label: "Status Pernikahan", profilePath: "maritalStatus" }),
  Object.freeze({ key: "passportType", label: "Tipe Passport", profilePath: "passportType" }),
  Object.freeze({ key: "email", label: "Email", profilePath: "email" }),
  Object.freeze({ key: "mobileNumber", label: "Nomor Telepon", profilePath: "mobileNumber" }),
]);

const ENTRY_DEFAULT_FIELD_KEYS = new Set(ENTRY_DEFAULT_FIELD_DEFS.map((field) => field.key));

export function createEntryDefaults(overrides = {}) {
  return normalizeEntryDefaults({
    profession: "",
    maritalStatus: "",
    passportType: "",
    email: "",
    mobileNumber: "",
    ...objectValue(overrides),
  });
}

export function normalizeEntryDefaults(value) {
  const source = objectValue(value);
  const next = {};
  for (const field of ENTRY_DEFAULT_FIELD_DEFS) {
    next[field.key] = String(source[field.key] ?? "").trim();
  }
  return next;
}

export function updateEntryDefaultValue(defaults, key, value) {
  const normalizedKey = String(key ?? "").trim();
  if (!ENTRY_DEFAULT_FIELD_KEYS.has(normalizedKey)) {
    return normalizeEntryDefaults(defaults);
  }
  return normalizeEntryDefaults({
    ...objectValue(defaults),
    [normalizedKey]: value,
  });
}

export function loadEntryDefaults(storageKey, storage = globalThis.localStorage) {
  if (!storage || typeof storage.getItem !== "function") {
    return createEntryDefaults();
  }

  try {
    const raw = storage.getItem(storageKey);
    if (!raw) {
      return createEntryDefaults();
    }
    return createEntryDefaults(JSON.parse(raw));
  } catch {
    return createEntryDefaults();
  }
}

export function saveEntryDefaults(defaults, storageKey, storage = globalThis.localStorage) {
  if (!storage || typeof storage.setItem !== "function") {
    return;
  }
  storage.setItem(storageKey, JSON.stringify(normalizeEntryDefaults(defaults)));
}

export function entryDefaultsActiveCount(defaults) {
  const normalized = normalizeEntryDefaults(defaults);
  return ENTRY_DEFAULT_FIELD_DEFS
    .filter((field) => String(normalized[field.key] || "").trim())
    .length;
}

export function applyEntryDefaultsToManifest(manifest, defaults) {
  const members = Array.isArray(manifest?.members) ? manifest.members : [];
  const normalizedDefaults = normalizeEntryDefaults(defaults);
  let appliedCount = 0;
  let touchedMemberCount = 0;

  for (const member of members) {
    const result = applyEntryDefaultsToMember(member, normalizedDefaults);
    appliedCount += result.appliedCount;
    if (result.appliedCount > 0) {
      touchedMemberCount += 1;
    }
  }

  return {
    appliedCount,
    manifest,
    touchedMemberCount,
  };
}

export function applyEntryDefaultsToMember(member, defaults) {
  if (!member || typeof member !== "object") {
    return { appliedCount: 0 };
  }

  const normalizedDefaults = normalizeEntryDefaults(defaults);
  const resolved = ensureResolvedProfile(member);
  let appliedCount = 0;

  for (const field of ENTRY_DEFAULT_FIELD_DEFS) {
    if (!field.profilePath) {
      continue;
    }
    const value = String(normalizedDefaults[field.key] || "").trim();
    if (!value || String(valueByPath(resolved, field.profilePath) ?? "").trim()) {
      continue;
    }
    setValueByPath(resolved, field.profilePath, value);
    appliedCount += 1;
  }

  return { appliedCount };
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
