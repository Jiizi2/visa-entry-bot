import { childInfoForMember, memberDisplayName, memberPassport, memberReviewStatus } from "./members";

export function isMemberReadyForEntry(member: any) {
  return memberReviewStatus(member) === "VALID";
}

export function isMemberReviewConfirmed(member: any, reviewedMemberIds = new Set<string>()) {
  return Boolean(member?.reviewConfirmed === true || reviewedMemberIds.has(member?.id));
}

export function isMemberReadyForJson(member: any, reviewedMemberIds = new Set<string>()) {
  return isMemberReadyForEntry(member) && isMemberReviewConfirmed(member, reviewedMemberIds);
}

export function passportCropApplied(member: any) {
  return Boolean(
    member?.croppedPassportImagePath?.trim()
    || member?.nusukUploadImagePath?.trim()
    || (member?.cropMetadata && typeof member.cropMetadata === "object")
  );
}

export function defaultSelectedIds(manifest: any) {
  if (!Array.isArray(manifest?.members)) return [];
  return manifest.members
    .filter((m: any) => isMemberReadyForEntry(m) && m.id)
    .map((m: any) => m.id);
}

export function effectiveSelectedIdsForExport(manifest: any, selectedIds = new Set<string>()) {
  const members = Array.isArray(manifest?.members) ? manifest.members : [];
  const base = selectedIds.size > 0
    ? new Set(Array.from(selectedIds).map(id => String(id || "")).filter(Boolean))
    : new Set<string>(defaultSelectedIds(manifest));

  for (const member of members) {
    if (!base.has(String(member.id || ""))) continue;
    const companionId = String(member.companionMemberId || "").trim();
    if (companionId) {
      base.add(companionId);
    }
  }
  return base;
}

export function validateCompanionsForExport(manifest: any, selectedIds = new Set<string>()) {
  const selectedIdsForExport = effectiveSelectedIdsForExport(manifest, selectedIds);
  const members = Array.isArray(manifest?.members) ? manifest.members : [];
  const missingChildren = members
    .filter((m: any) => selectedIdsForExport.has(String(m.id || "")))
    .filter((m: any) => childInfoForMember(m).isChild)
    .filter((m: any) => {
      const companionId = String(m.companionMemberId || "").trim();
      const companion = members.find((c: any) => String(c.id || "") === companionId);
      return !companion || childInfoForMember(companion).isChild;
    });

  if (missingChildren.length === 0) {
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

export function buildManifestForEntryExport(manifest: any, selectedIds = new Set<string>()) {
  const nextSelectedIds = effectiveSelectedIdsForExport(manifest, selectedIds);
  const source = JSON.parse(JSON.stringify(manifest));
  const members = Array.isArray(source?.members) ? source.members : [];
  const enrichedMembers = members.map((m: any) => enrichMemberForEntry(m, members));
  
  enrichedMembers.sort((left: any, right: any) => {
    const leftChild = childInfoForMember(left).isChild ? 1 : 0;
    const rightChild = childInfoForMember(right).isChild ? 1 : 0;
    return leftChild - rightChild;
  });
  
  source.members = enrichedMembers;
  for (const m of enrichedMembers) {
    const companionId = String(m.companionMemberId || "").trim();
    if (companionId) nextSelectedIds.add(companionId);
  }
  
  return { manifest: source, selectedIds: nextSelectedIds };
}

export function enrichMemberForEntry(member: any, allMembers: any[]) {
  const nextMember = JSON.parse(JSON.stringify(member));
  
  // upload path resolution
  const paths = [
    nextMember?.nusukUploadImagePath,
    nextMember?.croppedPassportImagePath,
    nextMember?.passportImagePath,
  ].filter(Boolean);
  const uploadImagePath = Array.from(new Set(paths))[0] || "";
  if (uploadImagePath) {
    nextMember.passportImagePath = uploadImagePath;
  }

  const info = childInfoForMember(nextMember);
  nextMember.isChild = info.isChild;
  nextMember.ageAtReview = Number.isFinite(info.age) ? info.age : null;
  
  const companionId = String(nextMember.companionMemberId || "").trim();
  if (info.isChild && companionId) {
    const companion = allMembers.find(c => String(c.id || "") === companionId);
    if (companion) {
      const relation = nextMember.companionRelation || "Mother";
      nextMember.companionRelation = relation;
      nextMember.companion = {
        id: String(companion.id || ""),
        name: memberDisplayName(companion),
        passportNumber: memberPassport(companion),
        relation: relation,
      };
    }
  } else {
    delete nextMember.companionMemberId;
    delete nextMember.companionRelation;
    delete nextMember.companion;
  }
  return nextMember;
}

export function buildExportPreviewState({
  members = [],
  selectedIds = new Set<string>(),
  review = { remaining: 0, reviewed: 0, total: 0 },
  reviewedMemberIds = new Set<string>(),
  canExportReviewedJson = false,
  isEntryRunning = false,
}: any) {
  const readyMembers = members.filter((m: any) => selectedIds.has(String(m.id || "")) && isMemberReadyForJson(m, reviewedMemberIds));
  const failedMembers = members.filter((m: any) => memberReviewStatus(m) === "ERROR");
  const skippedMembers = members.filter((m: any) => !readyMembers.includes(m) && memberReviewStatus(m) !== "ERROR");
  const reviewedMembers = members.filter((m: any) => 
    memberReviewStatus(m) === "ERROR" || Boolean(m?.reviewConfirmed === true || reviewedMemberIds.has(m?.id))
  );
  
  const canExport = canExportReviewedJson && !isEntryRunning;
  const description = review.remaining > 0
    ? `${review.reviewed}/${review.total} passport sudah ditandai dicek. Selesaikan review sebelum export JSON.`
    : `${readyMembers.length} jamaah akan masuk batch extension. Data error, belum reviewed, atau tidak dipilih tetap tampil sebagai pembanding.`;

  return {
    members: review.remaining > 0 ? reviewedMembers : members,
    selectedIds,
    review,
    readyMembers,
    failedMembers,
    skippedMembers,
    reviewedMembers,
    reviewedMemberIds,
    canExport,
    description,
  };
}
