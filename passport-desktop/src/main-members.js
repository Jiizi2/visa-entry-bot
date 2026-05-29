import {
  cloneJson,
  nestedArrayValue,
  nestedNumberValue,
  nestedStringValue,
  normalizeDateToNusuk,
  normalizeText,
  pathParts,
  uniqueValues,
  valueByPath,
} from "./main-utils.js";

export const CHILD_AGE_LIMIT = 18;
export const COMPANION_RELATION_OPTIONS = [
  "Other",
  "Father",
  "Son",
  "Brother",
  "Grandfather",
  "Grandson",
  "Maternal Uncle",
  "Niece (Brother side)",
  "Mother",
  "Daughter",
  "Sister",
  "Grandmother",
  "Granddaughter",
  "Maternal Aunt",
  "Niece (Sister side)",
  "Nephew (Brother side)",
  "Nephew (Sister side)",
  "Mother in law",
  "Women Set",
  "Daughter in law",
  "Son in law",
  "Step Mother",
  "Step Father",
  "Father in law",
  "Paternal Aunt",
  "Paternal Uncle",
  "Wife",
  "Husband",
  "Wife's father",
  "Husband's mother",
  "Husband's father",
  "Brother in law (Wife's brother)",
  "Brother in law (Husband's brother)",
];
export const DEFAULT_COMPANION_RELATION = "Mother";

export function memberDisplayName(member) {
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

export function memberPassport(member) {
  const resolved = resolvedProfileOf(member);
  return resolved.passportNumber || passportExtractedOf(member).passportNumber || "";
}

export function syncMemberChildMetadata(member) {
  if (!member || typeof member !== "object") {
    return { isChild: false, age: null };
  }
  const info = childInfoForMember(member);
  member.isChild = info.isChild;
  member.ageAtReview = Number.isFinite(info.age) ? info.age : null;
  if (!info.isChild) {
    delete member.companionMemberId;
    delete member.companionRelation;
    delete member.companion;
  }
  return info;
}

export function childInfoForMember(member) {
  const resolved = resolvedProfileOf(member);
  const dob = resolved.dob || passportExtractedOf(member).dob || "";
  const age = ageFromDateValue(dob);
  return {
    age,
    isChild: Number.isFinite(age) && age < CHILD_AGE_LIMIT,
  };
}

export function ageFromDateValue(value, now = new Date()) {
  const normalized = normalizeDateToNusuk(value);
  if (!normalized) {
    return null;
  }
  const [year, month, day] = normalized.split("/").map((part) => Number(part));
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

export function companionCandidatesFor(member, members = []) {
  const activeId = String(member?.id || "");
  return members
    .filter((candidate) => String(candidate.id || "") !== activeId)
    .filter((candidate) => !childInfoForMember(candidate).isChild)
    .filter((candidate) => memberPassport(candidate) || memberDisplayName(candidate) !== "-");
}

export function buildCompanionSnapshot(member, relation = "") {
  return {
    id: String(member?.id || ""),
    name: memberDisplayName(member),
    passportNumber: memberPassport(member),
    relation: normalizeCompanionRelation(relation),
  };
}

export function inferDefaultCompanionRelation(_childMember, companionMember) {
  const gender = normalizeText(resolvedProfileOf(companionMember).gender || passportExtractedOf(companionMember).gender || "");
  if (gender === "female" || gender === "f") {
    return DEFAULT_COMPANION_RELATION;
  }
  return DEFAULT_COMPANION_RELATION;
}

export function normalizeCompanionRelation(value) {
  const normalized = normalizeText(value);
  return COMPANION_RELATION_OPTIONS.find((option) => normalizeText(option) === normalized)
    || COMPANION_RELATION_OPTIONS.find((option) => normalizeText(option).includes(normalized) || normalized.includes(normalizeText(option)))
    || DEFAULT_COMPANION_RELATION;
}

export function resolvedProfileOf(member) {
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

export function ensureResolvedProfile(member) {
  if (!member.resolvedProfile || typeof member.resolvedProfile !== "object") {
    member.resolvedProfile = cloneJson(resolvedProfileOf(member));
  }
  return member.resolvedProfile;
}

export function passportExtractedOf(member) {
  if (member?.passportExtracted && typeof member.passportExtracted === "object") {
    return member.passportExtracted;
  }

  return resolvedProfileOf(member);
}

export function rawValueFrom(section, key) {
  if (!section || typeof section !== "object") {
    return "";
  }
  return String(valueByPath(section, key) ?? "").trim();
}

export function valueFrom(section, key) {
  const value = rawValueFrom(section, key);
  return value || "-";
}

export function fieldFlagsForMember(member, key) {
  const parts = pathParts(key);
  return [
    ...uniqueValues(nestedArrayValue(member?.reviewFlags, ["resolvedProfile", ...parts])),
    ...uniqueValues(nestedArrayValue(member?.reviewFlags, ["passportExtracted", ...parts])),
  ];
}

export function confidenceLevelForMember(member, key) {
  const parts = pathParts(key);
  return nestedStringValue(member?.confidenceLevel, ["resolvedProfile", ...parts])
    || nestedStringValue(member?.confidenceLevel, ["passportExtracted", ...parts])
    || "NONE";
}

export function confidenceValueForMember(member, key) {
  const parts = pathParts(key);
  return nestedNumberValue(member?.fieldConfidence, ["resolvedProfile", ...parts])
    ?? nestedNumberValue(member?.fieldConfidence, ["passportExtracted", ...parts])
    ?? 0;
}
