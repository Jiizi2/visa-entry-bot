import { escapeHtml, formatConfidence, uniqueValues } from "./main-utils.js";

export function renderFlagEntry(entry) {
  const tone = flagTone(entry.codes);
  return `
    <article class="flag-item">
      <div class="flag-item-head">
        <div class="flag-field">${escapeHtml(humanizeFieldPath(entry.path))}</div>
        <span class="mini-pill ${tone}">${escapeHtml(flagBucketLabel(entry.codes))}</span>
      </div>
      <div class="flag-chip-row">
        ${entry.codes.map((code) => `<span class="flag-chip ${flagCodeTone(code)}">${escapeHtml(formatFlagLabel(code))}</span>`).join("")}
      </div>
    </article>
  `;
}

export function renderConfidenceEntry(entry) {
  const levelClass = entry.level.toLowerCase();
  const width = Math.max(Math.round(entry.value * 100), entry.value > 0 ? 6 : 0);
  return `
    <article class="confidence-item">
      <div class="confidence-item-head">
        <div class="confidence-field">${escapeHtml(humanizeFieldPath(entry.path))}</div>
        <div class="confidence-meta">
          <span class="level-pill ${levelClass}">${escapeHtml(formatConfidenceLevelLabel(entry.level))}</span>
          <span class="confidence-value">${escapeHtml(formatConfidence(entry.value))}</span>
        </div>
      </div>
      <div class="confidence-bar">
        <span class="confidence-fill ${levelClass}" style="width: ${width}%"></span>
      </div>
    </article>
  `;
}

export function flattenFlagEntries(node, path = []) {
  if (Array.isArray(node)) {
    return node.length
      ? [{ path: path.join("."), codes: uniqueValues(node.map((value) => String(value || "").trim()).filter(Boolean)) }]
      : [];
  }

  if (!node || typeof node !== "object") {
    return [];
  }

  return Object.entries(node).flatMap(([key, value]) => flattenFlagEntries(value, [...path, key]));
}

export function flattenConfidenceEntries(node, levelNode, path = []) {
  if (typeof node === "number") {
    return [{
      path: path.join("."),
      value: node,
      level: typeof levelNode === "string" ? levelNode : inferConfidenceLevel(node),
    }];
  }

  if (!node || typeof node !== "object") {
    return [];
  }

  return Object.entries(node).flatMap(([key, value]) =>
    flattenConfidenceEntries(value, levelNode && typeof levelNode === "object" ? levelNode[key] : undefined, [...path, key]),
  );
}

export function humanizeFieldPath(path) {
  const labels = {
    record: "Record",
    passportExtracted: "Hasil scan",
    resolvedProfile: "Profil final",
    arabic: "Nama Arab",
    firstName: "Nama depan",
    fatherName: "Nama ayah",
    grandfatherName: "Nama kakek",
    familyName: "Nama keluarga",
    passportNumber: "Nomor passport",
    nationality: "Kewarganegaraan",
    previousNationality: "Kewarganegaraan sebelumnya",
    dob: "Tanggal lahir",
    issueDate: "Tanggal terbit",
    releaseDate: "Tanggal rilis (Issued Date Passport)",
    expiryDate: "Tanggal expired",
    gender: "Jenis kelamin",
    passportType: "Tipe passport",
    countryOfIssued: "Negara penerbit",
    cityOfIssued: "Kota penerbit",
    birthCountry: "Negara lahir",
    birthCity: "Kota lahir",
    profession: "Profesi",
    maritalStatus: "Status pernikahan",
    iqamaNumber: "Nomor iqama",
    iqamaExpiryDate: "Expired iqama",
    vaccinationCertificate: "Sertifikat vaksin",
    vaccinationCertificatePath: "File sertifikat vaksin",
    email: "Email",
    mobileNumber: "Nomor HP",
  };

  return String(path || "")
    .split(".")
    .filter(Boolean)
    .map((part) => labels[part] ?? humanizeIdentifier(part))
    .join(" -> ");
}

export function humanizeIdentifier(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatFlagLabel(code) {
  const labels = {
    LOW_CONFIDENCE: "Keyakinan rendah",
    DERIVED_VALUE: "Diambil dari field lain",
    DEFAULT_VALUE: "Nilai default",
    TEMPLATE_VALUE: "Template bawaan",
    INTENTIONAL_EMPTY: "Kosong disengaja",
    RECORD_ERROR: "Error record",
  };
  return labels[code] ?? humanizeIdentifier(code);
}

export function flagBucketLabel(codes) {
  if (codes.includes("RECORD_ERROR")) {
    return "Error";
  }
  if (hasActionableFlag(codes)) {
    return "Perlu dicek";
  }
  if (codes.every((code) => code === "INTENTIONAL_EMPTY")) {
    return "Kosong sengaja";
  }
  if (codes.some(isAutoFilledFlag)) {
    return "Otomatis";
  }
  return "Info";
}

export function flagTone(codes) {
  if (codes.includes("RECORD_ERROR")) {
    return "danger";
  }
  if (hasActionableFlag(codes)) {
    return "warn";
  }
  if (codes.every((code) => code === "INTENTIONAL_EMPTY")) {
    return "muted";
  }
  if (codes.some(isAutoFilledFlag)) {
    return "info";
  }
  return "good";
}

export function flagCodeTone(code) {
  if (code === "RECORD_ERROR") {
    return "danger";
  }
  if (code === "LOW_CONFIDENCE") {
    return "warn";
  }
  if (code === "INTENTIONAL_EMPTY") {
    return "muted";
  }
  if (isAutoFilledFlag(code)) {
    return "info";
  }
  return "good";
}

export function hasActionableFlag(codes) {
  return codes.some((code) => !["DERIVED_VALUE", "DEFAULT_VALUE", "TEMPLATE_VALUE", "INTENTIONAL_EMPTY"].includes(code));
}

export function isAutoFilledFlag(code) {
  return ["DERIVED_VALUE", "DEFAULT_VALUE", "TEMPLATE_VALUE"].includes(code);
}

export function inferConfidenceLevel(value) {
  if (value >= 0.85) {
    return "HIGH";
  }
  if (value >= 0.6) {
    return "MEDIUM";
  }
  if (value > 0) {
    return "LOW";
  }
  return "NONE";
}

export function formatConfidenceLevelLabel(level) {
  const labels = {
    HIGH: "Tinggi",
    MEDIUM: "Sedang",
    LOW: "Rendah",
    NONE: "Kosong",
  };
  return labels[level] ?? level;
}
