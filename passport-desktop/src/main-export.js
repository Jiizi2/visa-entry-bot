import { isMemberReadyForEntry } from "./main-entry.js";
import { applyEntryDefaultsToManifest } from "./main-entry-defaults.js";
import { cloneJson } from "./main-utils.js";
import {
  buildCompanionSnapshot,
  childInfoForMember,
  inferDefaultCompanionRelation,
  memberDisplayName,
  normalizeCompanionRelation,
} from "./main-members.js";
import {
  passportUploadImagePathForMember,
} from "./main-passport-image.js";

export function defaultSelectedIds(manifest) {
  if (!Array.isArray(manifest?.members)) {
    return [];
  }
  return manifest.members
    .filter((member) => isMemberReadyForEntry(member) && member.id)
    .map((member) => member.id);
}

export function confirmedReviewIds(manifest) {
  if (!Array.isArray(manifest?.members)) {
    return new Set();
  }

  return new Set(
    manifest.members
      .filter((member) => member?.reviewConfirmed === true && member.id)
      .map((member) => member.id),
  );
}

export function isMemberReviewConfirmed(member, reviewedMemberIds = new Set()) {
  return Boolean(member?.reviewConfirmed === true || reviewedMemberIds.has(member?.id));
}

export function isMemberReadyForJson(member, reviewedMemberIds = new Set()) {
  return isMemberReadyForEntry(member) && isMemberReviewConfirmed(member, reviewedMemberIds);
}

export function effectiveSelectedIdsForExport(manifest, selectedIds = new Set()) {
  const members = Array.isArray(manifest?.members) ? manifest.members : [];
  const base = selectedIds.size
    ? new Set(Array.from(selectedIds).map((id) => String(id || "")).filter(Boolean))
    : new Set(defaultSelectedIds(manifest));

  for (const member of members) {
    if (!base.has(String(member.id || ""))) {
      continue;
    }
    const companionId = String(member.companionMemberId || "").trim();
    if (companionId) {
      base.add(companionId);
    }
  }
  return base;
}

export function validateCompanionsForExport(manifest, selectedIds = new Set()) {
  const selectedIdsForExport = effectiveSelectedIdsForExport(manifest, selectedIds);
  const members = Array.isArray(manifest?.members) ? manifest.members : [];
  const missingChildren = members
    .filter((member) => selectedIdsForExport.has(String(member.id || "")))
    .filter((member) => childInfoForMember(member).isChild)
    .filter((member) => {
      const companionId = String(member.companionMemberId || "").trim();
      const companion = members.find((candidate) => String(candidate.id || "") === companionId);
      return !companion || childInfoForMember(companion).isChild;
    });

  if (!missingChildren.length) {
    return { ok: true, message: "", firstMemberId: "" };
  }

  const names = missingChildren.slice(0, 3).map(memberDisplayName).join(", ");
  const suffix = missingChildren.length > 3 ? ` dan ${missingChildren.length - 3} lainnya` : "";
  return {
    ok: false,
    message: `${missingChildren.length} jamaah anak belum memiliki companion dewasa: ${names}${suffix}.`,
    firstMemberId: String(missingChildren[0]?.id || ""),
  };
}

export function buildManifestForEntryExport(manifest, selectedIds = new Set(), entryDefaults = {}) {
  const nextSelectedIds = effectiveSelectedIdsForExport(manifest, selectedIds);
  const source = cloneJson(manifest);
  applyEntryDefaultsToManifest(source, entryDefaults);
  const members = Array.isArray(source?.members) ? source.members : [];
  const enrichedMembers = members.map((member) => enrichMemberForEntry(member, members));
  enrichedMembers.sort((left, right) => {
    const leftChild = childInfoForMember(left).isChild ? 1 : 0;
    const rightChild = childInfoForMember(right).isChild ? 1 : 0;
    return leftChild - rightChild;
  });
  source.members = enrichedMembers;
  for (const member of enrichedMembers) {
    const companionId = String(member.companionMemberId || "").trim();
    if (companionId) {
      nextSelectedIds.add(companionId);
    }
  }
  return {
    manifest: source,
    selectedIds: nextSelectedIds,
  };
}

export function enrichMemberForEntry(member, allMembers) {
  const nextMember = cloneJson(member);
  const uploadImagePath = passportUploadImagePathForMember(nextMember);
  if (uploadImagePath) {
    nextMember.passportImagePath = uploadImagePath;
  }
  const info = childInfoForMember(nextMember);
  nextMember.isChild = info.isChild;
  nextMember.ageAtReview = Number.isFinite(info.age) ? info.age : null;
  const companionId = String(nextMember.companionMemberId || "").trim();
  if (info.isChild && companionId) {
    const companion = allMembers.find((candidate) => String(candidate.id || "") === companionId);
    if (companion) {
      const relation = normalizeCompanionRelation(nextMember.companionRelation || nextMember.companion?.relation || inferDefaultCompanionRelation(nextMember, companion));
      nextMember.companionRelation = relation;
      nextMember.companion = buildCompanionSnapshot(companion, relation);
    }
  } else {
    delete nextMember.companionMemberId;
    delete nextMember.companionRelation;
    delete nextMember.companion;
  }
  return nextMember;
}
