const PASSPORT_CROP_FIELD_NAMES = [
  "originalPassportImagePath",
  "croppedPassportImagePath",
  "nusukUploadImagePath",
  "cropMetadata",
];

function stringValue(value: any): string {
  return String(value ?? "").trim();
}

function uniqueStrings(values: any[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
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

function clonePlainObject(value: any): any {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

export function passportCropApplied(member: any): boolean {
  return Boolean(
    stringValue(member?.croppedPassportImagePath)
    || stringValue(member?.nusukUploadImagePath)
    || (member?.cropMetadata && typeof member.cropMetadata === "object")
  );
}

export function passportUploadImagePathForMember(member: any): string {
  return uniqueStrings([
    member?.nusukUploadImagePath,
    member?.croppedPassportImagePath,
    member?.passportImagePath,
  ])[0] || "";
}

export function passportPreviewImagePathForMember(member: any): string {
  return passportUploadImagePathForMember(member);
}

export function passportCropSourceImageCandidates(member: any): string[] {
  return uniqueStrings([
    member?.originalPassportImagePath,
    member?.cropMetadata?.sourceImagePath,
    member?.passportImagePath,
    member?.croppedPassportImagePath,
    member?.nusukUploadImagePath,
  ]);
}

export function applyCroppedPassportImageToMember(member: any, savedImage: any, cropMetadata: any = {}, options: any = {}): any {
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

export function preservePassportCropFields(sourceMember: any, targetMember: any): any {
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
