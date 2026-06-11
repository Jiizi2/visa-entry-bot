export function basenameFromPath(path?: string | null): string {
  return String(path ?? "")
    .split(/[\\/]/)
    .filter(Boolean)
    .pop() || "-";
}

export function parentPath(path?: string | null): string {
  const normalized = String(path ?? "").trim().replace(/[\\/]+$/, "");
  if (!normalized) {
    return "";
  }

  const separatorIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (separatorIndex < 0) {
    return "";
  }

  if (separatorIndex === 0) {
    return normalized.slice(0, 1);
  }

  if (separatorIndex === 2 && /^[A-Za-z]:/.test(normalized)) {
    return normalized.slice(0, 3);
  }

  return normalized.slice(0, separatorIndex);
}

export function formatRecentStamp(value: string | number | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Waktu tidak tersedia";
  }

  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatConfidence(value: string | number): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.round(numeric * 100)}%` : "-";
}

export function formatProgressValue(value: string | number): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2).replace(/\.00$/, "") : "-";
}

export function formatDurationMs(value: string | number): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "-";
  }

  const milliseconds = Math.round(numeric);
  if (milliseconds < 1000) {
    return `${milliseconds} ms`;
  }

  const seconds = milliseconds / 1000;
  const oneDecimalSeconds = Math.round(seconds * 10) / 10;
  if (oneDecimalSeconds < 10) {
    return `${oneDecimalSeconds.toFixed(1).replace(".", ",")} dtk`;
  }
  if (seconds < 60) {
    return `${Math.round(seconds)} dtk`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

export function nestedArrayValue(node: any, path: string[]): any[] {
  const value = nestedValue(node, path);
  return Array.isArray(value) ? value : [];
}

export function nestedStringValue(node: any, path: string[]): string {
  const value = nestedValue(node, path);
  return typeof value === "string" ? value : "";
}

export function nestedNumberValue(node: any, path: string[]): number | null {
  const value = nestedValue(node, path);
  return typeof value === "number" ? value : null;
}

export function nestedValue(node: any, path: string[]): any {
  let current = node;
  for (const part of path) {
    if (!current || typeof current !== "object" || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

export function pathParts(path?: string | null): string[] {
  return String(path ?? "")
    .split(".")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function valueByPath(node: any, path: string): any {
  const parts = pathParts(path);
  let current = node;
  for (const part of parts) {
    if (!current || typeof current !== "object") {
      return "";
    }
    current = current[part];
  }
  return current ?? "";
}

export function setValueByPath(node: any, path: string, nextValue: any): void {
  const parts = pathParts(path);
  if (!parts.length || !node || typeof node !== "object") {
    return;
  }

  let current = node;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!current[part] || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part];
  }

  current[parts[parts.length - 1]] = nextValue;
}

export function dateValueForInput(value?: string | null): string {
  return normalizeDateToNusuk(String(value ?? "").trim());
}

export function normalizeDateToNusuk(value?: string | null): string {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }

  let match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) {
    return toNusukDate(match[1], match[2], match[3]);
  }

  match = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (match) {
    return toNusukDate(match[3], match[2], match[1]);
  }

  match = raw.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})$/);
  if (match) {
    const month = monthNameToNumber(match[2]);
    if (month) {
      return toNusukDate(match[3], String(month), match[1]);
    }
  }

  return "";
}

export function toNusukDate(yearValue: string | number, monthValue: string | number, dayValue: string | number): string {
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return "";
  }
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return "";
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return "";
  }

  const yyyy = String(year).padStart(4, "0");
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}`;
}

export function monthNameToNumber(value?: string | null): number {
  const key = String(value ?? "").trim().toLowerCase();
  const map: Record<string, number> = {
    jan: 1, january: 1, januari: 1,
    feb: 2, february: 2, februari: 2,
    mar: 3, march: 3, maret: 3,
    apr: 4, april: 4,
    may: 5, mei: 5,
    jun: 6, june: 6, juni: 6,
    jul: 7, july: 7, juli: 7,
    aug: 8, august: 8, agt: 8, agustus: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10, okt: 10, oktober: 10,
    nov: 11, november: 11,
    dec: 12, december: 12, des: 12, desember: 12,
  };
  return map[key] ?? 0;
}

export function normalizeText(value?: string | null): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null));
}

export function uniqueValues<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export function escapeHtml(value?: string | null): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
