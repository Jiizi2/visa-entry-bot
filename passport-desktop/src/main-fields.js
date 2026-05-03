import { normalizeDateToNusuk } from "./main-utils.js";

export const REVIEW_FIELDS = [
  ["firstName", "Nama Depan (English)"],
  ["fatherName", "Nama Ayah (English)"],
  ["grandfatherName", "Nama Kakek (English)"],
  ["familyName", "Nama Keluarga (English)"],
  ["dob", "Tanggal Lahir"],
  ["nationality", "Kewarganegaraan"],
  ["passportNumber", "Nomor Passport"],
  ["countryOfIssued", "Negara Penerbit"],
  ["expiryDate", "Tanggal Berakhir"],
  ["gender", "Jenis Kelamin"],
  ["passportType", "Tipe Passport"],
  ["releaseDate", "Tanggal Rilis (Issued Date Passport)"],
  ["cityOfIssued", "Kota Penerbit"],
  ["arabic.firstName", "Nama Arab Depan"],
  ["arabic.fatherName", "Nama Arab Ayah"],
  ["arabic.grandfatherName", "Nama Arab Kakek"],
  ["arabic.familyName", "Nama Arab Keluarga"],
  ["birthCountry", "Negara Lahir"],
  ["birthCity", "Kota Lahir"],
  ["profession", "Profesi"],
  ["maritalStatus", "Status Pernikahan"],
  ["email", "Email"],
  ["mobileNumber", "Nomor Telepon"],
];

export const FIELD_CATEGORY_DEFS = [
  {
    id: "identity",
    label: "Identitas",
    keys: [
      "firstName",
      "fatherName",
      "grandfatherName",
      "familyName",
      "dob",
      "gender",
      "nationality",
      "birthCountry",
      "birthCity",
      "profession",
      "maritalStatus",
    ],
  },
  {
    id: "passport",
    label: "Passport",
    keys: [
      "passportNumber",
      "passportType",
      "countryOfIssued",
      "cityOfIssued",
      "issueDate",
      "releaseDate",
      "expiryDate",
    ],
  },
  {
    id: "arabic",
    label: "Nama Arab",
    keys: [
      "arabic.firstName",
      "arabic.fatherName",
      "arabic.grandfatherName",
      "arabic.familyName",
    ],
  },
  {
    id: "contact",
    label: "Kontak",
    keys: [
      "email",
      "mobileNumber",
    ],
  },
];

export const FIELD_CATEGORY_PAIRS = [
  {
    id: "identity",
    label: "Identitas + Passport",
    categoryIds: ["identity", "passport"],
  },
  {
    id: "arabic",
    label: "Nama Arab + Kontak",
    categoryIds: ["arabic", "contact"],
  },
];

const NUSUK_NAME_FIELD_MAX_LENGTH = 15;
const NUSUK_NAME_FIELDS = new Set([
  "firstName",
  "fatherName",
  "grandfatherName",
  "familyName",
  "arabic.firstName",
  "arabic.fatherName",
  "arabic.grandfatherName",
  "arabic.familyName",
]);

const DATE_FIELD_KEYS = new Set([
  "dob",
  "issueDate",
  "releaseDate",
  "expiryDate",
]);

export function maxLengthForField(fieldKey) {
  return NUSUK_NAME_FIELDS.has(String(fieldKey ?? "")) ? NUSUK_NAME_FIELD_MAX_LENGTH : null;
}

export function clampFieldValue(fieldKey, value) {
  const normalized = String(value ?? "").trim();
  const maxLength = maxLengthForField(fieldKey);
  if (!maxLength) {
    return normalized;
  }
  return normalized.slice(0, maxLength);
}

export function normalizeInputValueForField(fieldKey, value) {
  const normalized = String(value ?? "").trim();
  if (isDateFieldKey(fieldKey)) {
    return normalizeDateToNusuk(normalized) || normalized;
  }
  return clampFieldValue(fieldKey, normalized);
}

export function isDateFieldKey(fieldKey) {
  return DATE_FIELD_KEYS.has(String(fieldKey ?? "").trim());
}
