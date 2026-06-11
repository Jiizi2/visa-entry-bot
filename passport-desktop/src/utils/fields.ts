import { normalizeDateToNusuk } from "./helpers";
import { transliterateName } from "./transliterator";

export interface ReviewFieldDef {
  required: boolean;
}

export type ReviewFieldTuple = [string, string, Readonly<ReviewFieldDef>];

function reviewField(key: string, label: string, options: Partial<ReviewFieldDef> = {}): ReviewFieldTuple {
  return [key, label, Object.freeze({ required: options.required !== false })];
}

export const REVIEW_FIELDS: ReviewFieldTuple[] = [
  reviewField("firstName", "Nama Depan (English)"),
  reviewField("fatherName", "Nama Ayah (English)", { required: false }),
  reviewField("grandfatherName", "Nama Kakek (English)", { required: false }),
  reviewField("familyName", "Nama Keluarga (English)"),
  reviewField("dob", "Tanggal Lahir"),
  reviewField("nationality", "Kewarganegaraan"),
  reviewField("passportNumber", "Nomor Passport"),
  reviewField("countryOfIssued", "Negara Penerbit", { required: false }),
  reviewField("expiryDate", "Tanggal Berakhir"),
  reviewField("gender", "Jenis Kelamin"),
  reviewField("passportType", "Tipe Passport"),
  reviewField("releaseDate", "Tanggal Rilis (Issued Date Passport)"),
  reviewField("cityOfIssued", "Kota Penerbit"),
  reviewField("arabic.firstName", "Nama Arab Depan"),
  reviewField("arabic.fatherName", "Nama Arab Ayah", { required: false }),
  reviewField("arabic.grandfatherName", "Nama Arab Kakek", { required: false }),
  reviewField("arabic.familyName", "Nama Arab Keluarga"),
  reviewField("birthCountry", "Negara Lahir"),
  reviewField("birthCity", "Kota Lahir"),
  reviewField("profession", "Profesi"),
  reviewField("maritalStatus", "Status Pernikahan"),
  reviewField("email", "Email"),
  reviewField("mobileNumber", "Nomor Telepon"),
];

export interface FieldCategoryDef {
  id: string;
  label: string;
  keys: string[];
}

export const FIELD_CATEGORY_DEFS: FieldCategoryDef[] = [
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

const LATIN_NAME_TO_ARABIC_FIELD: Record<string, string> = Object.freeze({
  firstName: "arabic.firstName",
  fatherName: "arabic.fatherName",
  grandfatherName: "arabic.grandfatherName",
  familyName: "arabic.familyName",
});

export function maxLengthForField(fieldKey?: string | null): number | null {
  return NUSUK_NAME_FIELDS.has(String(fieldKey ?? "")) ? NUSUK_NAME_FIELD_MAX_LENGTH : null;
}

export function isReviewFieldRequired(fieldKey?: string | null): boolean {
  const normalizedKey = String(fieldKey ?? "").trim();
  const field = REVIEW_FIELDS.find(([key]) => key === normalizedKey);
  return Boolean(field && field[2]?.required !== false);
}

export function clampFieldValue(fieldKey: string, value: string): string {
  const normalized = String(value ?? "").trim();
  const maxLength = maxLengthForField(fieldKey);
  if (!maxLength) {
    return normalized;
  }
  return normalized.slice(0, maxLength);
}

export function normalizeInputValueForField(fieldKey: string, value: string): string {
  const normalized = String(value ?? "").trim();
  if (isDateFieldKey(fieldKey)) {
    return normalizeDateToNusuk(normalized) || normalized;
  }
  return clampFieldValue(fieldKey, normalized);
}

export function isDateFieldKey(fieldKey?: string | null): boolean {
  return DATE_FIELD_KEYS.has(String(fieldKey ?? "").trim());
}

export function arabicFieldForLatinName(fieldKey?: string | null): string {
  return LATIN_NAME_TO_ARABIC_FIELD[String(fieldKey ?? "").trim()] || "";
}

export function transliteratedArabicValueForField(fieldKey: string, value: string): string {
  const arabicFieldKey = arabicFieldForLatinName(fieldKey);
  if (!arabicFieldKey) {
    return "";
  }
  return normalizeInputValueForField(arabicFieldKey, transliterateName(value));
}
