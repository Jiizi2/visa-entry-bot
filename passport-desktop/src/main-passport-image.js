const PASSPORT_CROP_FIELD_NAMES = [
  "originalPassportImagePath",
  "croppedPassportImagePath",
  "nusukUploadImagePath",
  "cropMetadata",
];

function stringValue(value) {
  return String(value ?? "").trim();
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = stringValue(value);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    result.push(text);
  }
  return result;
}

function clonePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

export function passportCropApplied(member) {
  return Boolean(
    stringValue(member?.croppedPassportImagePath)
    || stringValue(member?.nusukUploadImagePath)
    || (member?.cropMetadata && typeof member.cropMetadata === "object")
  );
}

export function passportUploadImagePathForMember(member) {
  return uniqueStrings([
    member?.nusukUploadImagePath,
    member?.croppedPassportImagePath,
    member?.passportImagePath,
  ])[0] || "";
}

export function passportPreviewImagePathForMember(member) {
  return passportUploadImagePathForMember(member);
}

export function passportCropSourceImageCandidates(member) {
  return uniqueStrings([
    member?.originalPassportImagePath,
    member?.cropMetadata?.sourceImagePath,
    member?.passportImagePath,
    member?.croppedPassportImagePath,
    member?.nusukUploadImagePath,
  ]);
}

export function applyCroppedPassportImageToMember(member, savedImage, cropMetadata = {}, options = {}) {
  const nextMember = clonePlainObject(member) || {};
  const savedPath = stringValue(savedImage?.relativePath) || stringValue(savedImage?.path);
  if (!savedPath) {
    return nextMember;
  }

  const originalPath = stringValue(nextMember.originalPassportImagePath)
    || stringValue(cropMetadata.sourceImagePath)
    || stringValue(member?.passportImagePath);
  if (originalPath) {
    nextMember.originalPassportImagePath = originalPath;
  }

  const timestamp = typeof options.now === "function"
    ? options.now()
    : new Date();
  nextMember.croppedPassportImagePath = savedPath;
  nextMember.nusukUploadImagePath = savedPath;
  nextMember.passportImagePath = savedPath;
  nextMember.cropMetadata = {
    ...(nextMember.cropMetadata && typeof nextMember.cropMetadata === "object" ? nextMember.cropMetadata : {}),
    ...cropMetadata,
    sourceImagePath: originalPath || stringValue(cropMetadata.sourceImagePath),
    croppedImagePath: savedPath,
    croppedAt: timestamp instanceof Date ? timestamp.toISOString() : String(timestamp || ""),
  };
  return nextMember;
}

export function preservePassportCropFields(sourceMember, targetMember) {
  const nextMember = clonePlainObject(targetMember) || {};
  if (!passportCropApplied(sourceMember)) {
    return nextMember;
  }

  for (const fieldName of PASSPORT_CROP_FIELD_NAMES) {
    if (Object.prototype.hasOwnProperty.call(sourceMember || {}, fieldName)) {
      nextMember[fieldName] = clonePlainObject(sourceMember[fieldName]);
    }
  }

  const uploadPath = passportUploadImagePathForMember(sourceMember);
  if (uploadPath) {
    nextMember.passportImagePath = uploadPath;
  }
  return nextMember;
}
