export function parseArgs(argv) {
  const args = { batch: "", url: "" };
  for (let i = 2; i < argv.length; i += 1) {
    const token = String(argv[i] ?? "").trim();
    if (token === "--batch") {
      args.batch = String(argv[i + 1] ?? "").trim();
      i += 1;
      continue;
    }
    if (token === "--url") {
      args.url = String(argv[i + 1] ?? "").trim();
      i += 1;
    }
  }
  return args;
}

export function deepValue(node, rawPath) {
  const segments = String(rawPath ?? "").split(".").filter(Boolean);
  let current = node;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || !(segment in current)) {
      return "";
    }
    current = current[segment];
  }
  return current ?? "";
}

export function interpolate(template, context) {
  return String(template ?? "").replace(/\{\{([^}]+)\}\}/g, (_full, rawExpr) => {
    const expr = String(rawExpr ?? "").trim();
    if (!expr) {
      return "";
    }
    if (expr === "index") {
      return String(context.index ?? "");
    }
    if (expr === "memberIndex") {
      return String(context.memberIndex ?? "");
    }
    if (expr === "totalMembers") {
      return String(context.totalMembers ?? "");
    }
    if (expr.startsWith("member.")) {
      return String(deepValue(context.member, expr.slice("member.".length)) ?? "");
    }
    return String(deepValue(context, expr) ?? "");
  });
}

export function pickFirstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

export function normalizeOption(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function toIsoDate(yearValue, monthValue, dayValue) {
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
  return `${yyyy}-${mm}-${dd}`;
}

export function normalizeDateToIso(rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!value) {
    return "";
  }

  let match = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) {
    return toIsoDate(match[1], match[2], match[3]);
  }

  match = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (match) {
    return toIsoDate(match[3], match[2], match[1]);
  }

  return "";
}
