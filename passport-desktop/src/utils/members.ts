import { normalizeDateToNusuk } from "./helpers";

export const CHILD_AGE_LIMIT = 18;
export const COMPANION_RELATION_OPTIONS = [
  "Other", "Father", "Son", "Brother", "Grandfather", "Grandson", "Maternal Uncle", "Niece (Brother side)",
  "Mother", "Daughter", "Sister", "Grandmother", "Granddaughter", "Maternal Aunt", "Niece (Sister side)",
  "Nephew (Brother side)", "Nephew (Sister side)", "Mother in law", "Women Set", "Daughter in law",
  "Son in law", "Step Mother", "Step Father", "Father in law", "Paternal Aunt", "Paternal Uncle",
  "Wife", "Husband", "Wife's father", "Husband's mother", "Husband's father", "Brother in law (Wife's brother)",
  "Brother in law (Husband's brother)",
];
export const DEFAULT_COMPANION_RELATION = "Mother";

export function memberReviewStatus(member: any) {
  return String(member?.reviewStatus ?? member?.status ?? "").toUpperCase();
}

export function resolvedProfileOf(member: any) {
  if (member?.resolvedProfile && typeof member.resolvedProfile === "object") {
    return member.resolvedProfile;
  }
  return {
    firstName: member?.firstName ?? "",
    fatherName: member?.fatherName ?? "",
    grandfatherName: member?.grandfatherName ?? "",
    familyName: member?.familyName ?? "",
    passportNumber: member?.passportNumber ?? "",
    nationality: member?.nationality ?? "",
    dob: member?.dob ?? "",
    issueDate: member?.issueDate ?? "",
    releaseDate: member?.releaseDate ?? "",
    expiryDate: member?.expiryDate ?? "",
    gender: member?.gender ?? "",
    passportType: member?.passportType ?? "",
    countryOfIssued: member?.countryOfIssued ?? "",
    cityOfIssued: member?.cityOfIssued ?? "",
    birthCountry: member?.birthCountry ?? "",
    birthCity: member?.birthCity ?? "",
    profession: member?.profession ?? "",
    maritalStatus: member?.maritalStatus ?? "",
    vaccinationCertificate: member?.vaccinationCertificate ?? "",
    vaccinationCertificatePath: member?.vaccinationCertificatePath ?? "",
    email: member?.email ?? "",
    mobileNumber: member?.mobileNumber ?? "",
    arabic: {
      firstName: member?.arabic?.firstName ?? "",
      fatherName: member?.arabic?.fatherName ?? "",
      grandfatherName: member?.arabic?.grandfatherName ?? "",
      familyName: member?.arabic?.familyName ?? "",
    },
  };
}

export function passportExtractedOf(member: any) {
  if (member?.passportExtracted && typeof member.passportExtracted === "object") {
    return member.passportExtracted;
  }
  return resolvedProfileOf(member);
}

export function memberDisplayName(member: any) {
  const resolved = resolvedProfileOf(member);
  const parts = [
    resolved.firstName,
    resolved.fatherName,
    resolved.grandfatherName,
    resolved.familyName,
  ].filter(Boolean);

  if (parts.length) {
    return parts.join(" ");
  }

  const extracted = passportExtractedOf(member);
  return [extracted.firstName, extracted.familyName].filter(Boolean).join(" ") || member?.fileName || "-";
}

export function memberPassport(member: any) {
  const resolved = resolvedProfileOf(member);
  return resolved.passportNumber || passportExtractedOf(member).passportNumber || "";
}

export function childInfoForMember(member: any) {
  const resolved = resolvedProfileOf(member);
  const dob = resolved.dob || passportExtractedOf(member).dob || "";
  const age = ageFromDateValue(dob);
  return {
    age,
    isChild: Number.isFinite(age) && (age as number) < CHILD_AGE_LIMIT,
  };
}

export function ageFromDateValue(value: any, now = new Date()) {
  if (!value) return null;
  const normalizedValue = normalizeDateToNusuk(value) || value;
  const parts = normalizedValue.split(/[-/]/);
  if (parts.length !== 3) return null;
  // Nusuk normalized date is YYYY/MM/DD
  // So parts[0] is year, parts[1] is month, parts[2] is day
  let year = Number(parts[0]);
  let month = Number(parts[1]);
  let day = Number(parts[2]);
  
  // Just in case it wasn't normalized properly and is DD/MM/YYYY
  if (year < 100 && parts[2].length === 4) {
    year = Number(parts[2]);
    day = Number(parts[0]);
  }
  
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  let age = now.getFullYear() - year;
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();
  if (currentMonth < month || (currentMonth === month && currentDay < day)) {
    age -= 1;
  }
  return age >= 0 && age < 130 ? age : null;
}

export function nestedValue(obj: any, path: string[]) {
  let current = obj;
  for (const part of path) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

export function valueByPath(obj: any, pathStr: string) {
  return nestedValue(obj, pathStr.split('.'));
}

export function rawValueFrom(section: any, key: string) {
  if (!section || typeof section !== "object") return "";
  return String(valueByPath(section, key) ?? "");
}

export function valueFrom(section: any, key: string) {
  const value = rawValueFrom(section, key);
  return value || "-";
}

export function fieldFlagsForMember(member: any, key: string) {
  const parts = key.split('.');
  const p1 = nestedValue(member?.reviewFlags, ["resolvedProfile", ...parts]);
  const p2 = nestedValue(member?.reviewFlags, ["passportExtracted", ...parts]);
  const arr = [...(Array.isArray(p1) ? p1 : []), ...(Array.isArray(p2) ? p2 : [])];
  return Array.from(new Set(arr));
}

export function confidenceLevelForMember(member: any, key: string) {
  const parts = key.split('.');
  return nestedValue(member?.confidenceLevel, ["resolvedProfile", ...parts])
    || nestedValue(member?.confidenceLevel, ["passportExtracted", ...parts])
    || "NONE";
}

export function confidenceValueForMember(member: any, key: string) {
  const parts = key.split('.');
  return nestedValue(member?.fieldConfidence, ["resolvedProfile", ...parts])
    ?? nestedValue(member?.fieldConfidence, ["passportExtracted", ...parts])
    ?? 0;
}
