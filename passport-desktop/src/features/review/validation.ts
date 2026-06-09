import {
  FIELD_CATEGORY_DEFS,
  FIELD_CATEGORY_PAIRS,
  REVIEW_FIELDS,
  isReviewFieldRequired,
} from "../../shared/fields.js";
import {
  childInfoForMember,
  ensureResolvedProfile,
  memberDisplayName,
  rawValueFrom,
} from "../../shared/members.js";

export function reviewCompletionValidation(member: any, members: any[] = []) {
  if (!member) {
    return { ok: false, message: "Belum ada passport aktif untuk direview.", categoryId: "", fieldKey: "" };
  }

  const companionIssue = companionBlockingIssue(member, members);
  if (companionIssue) {
    return companionIssue;
  }

  const missingFields = missingRequiredReviewFields(member);
  if (missingFields.length) {
    const visibleLabels = missingFields.slice(0, 3).map((item) => item.label).join(", ");
    const suffix = missingFields.length > 3 ? ` dan ${missingFields.length - 3} lainnya` : "";
    return {
      ok: false,
      target: "field",
      message: `${missingFields.length} data wajib belum diisi: ${visibleLabels}${suffix}.`,
      categoryId: missingFields[0].categoryId,
      fieldKey: missingFields[0].key,
    };
  }

  return { ok: true, message: "", categoryId: "", fieldKey: "" };
}

export function requiredFieldBlockingIssueForBatch(members: any[] = []) {
  for (const member of members) {
    const missingFields = missingRequiredReviewFields(member);
    if (!missingFields.length) {
      continue;
    }

    const visibleLabels = missingFields.slice(0, 3).map((item) => item.label).join(", ");
    const suffix = missingFields.length > 3 ? ` dan ${missingFields.length - 3} lainnya` : "";
    return {
      ok: false,
      target: "field",
      memberId: String(member.id || ""),
      message: `${memberDisplayName(member)} belum lengkap: ${visibleLabels}${suffix}.`,
      categoryId: missingFields[0].categoryId,
      fieldKey: missingFields[0].key,
    };
  }

  return { ok: true, message: "", categoryId: "", fieldKey: "", memberId: "" };
}

export function companionBlockingIssue(member: any, members: any[] = []) {
  const childInfo = childInfoForMember(member);
  if (!childInfo.isChild) {
    return null;
  }

  const companionId = String(member.companionMemberId || "").trim();
  const companion = members.find((candidate) => String(candidate.id || "") === companionId);
  if (companion && !childInfoForMember(companion).isChild) {
    return null;
  }

  return {
    ok: false,
    target: "companion",
    message: "Companion dewasa wajib dipilih sebelum lanjut ke passport berikutnya.",
    categoryId: FIELD_CATEGORY_PAIRS[0]?.id ?? "identity",
    fieldKey: "",
  };
}

export function missingRequiredReviewFields(member) {
  const resolved = ensureResolvedProfile(member);
  return REVIEW_FIELDS
    .filter(([key]) => isReviewFieldRequired(key))
    .filter(([key]) => !rawValueFrom(resolved, key))
    .filter(([key]) => !isReviewFieldAllowedEmpty(member, key))
    .map(([key, label]) => ({
      key,
      label,
      categoryId: fieldCategoryPairIdForKey(key),
    }));
}

export function isReviewFieldAllowedEmpty(_member, key) {
  return !isReviewFieldRequired(key);
}

export function fieldCategoryPairIdForKey(key) {
  for (const pair of FIELD_CATEGORY_PAIRS) {
    const categoryKeys = pair.categoryIds
      .map((categoryId) => FIELD_CATEGORY_DEFS.find((item) => item.id === categoryId))
      .filter(Boolean)
      .flatMap((category: any) => category.keys);
    if (categoryKeys.includes(key)) {
      return pair.id;
    }
  }
  return FIELD_CATEGORY_PAIRS[0]?.id ?? "identity";
}
