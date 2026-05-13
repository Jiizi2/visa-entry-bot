(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};

  const ENTRY_BATCH_SCHEMA_VERSION = "nusuk-entry-batch-v1";
  const OCR_MANIFEST_SCHEMA_VERSION = "passport-manifest-v1";
  const OCR_CONTRACT_VERSION = "passport-extracted-resolved-profile-v4";
  const MAX_ERROR_MESSAGES = 8;

  const REQUIRED_PROFILE_FIELDS = [
    ["firstName", "nama depan"],
    ["familyName", "nama keluarga"],
    ["passportNumber", "nomor passport"],
    ["nationality", "nationality"],
    ["gender", "gender"],
    ["dob", "tanggal lahir"],
    ["expiryDate", "tanggal expired passport"],
    ["passportType", "tipe passport"],
    ["cityOfIssued", "kota penerbit passport"],
    ["birthCountry", "negara lahir"],
    ["birthCity", "kota lahir"],
    ["maritalStatus", "status menikah"],
    ["profession", "profesi"],
    ["email", "email"],
    ["mobileNumber", "nomor HP"],
    ["arabic.firstName", "nama depan Arab"],
    ["arabic.familyName", "nama keluarga Arab"],
  ];

  const REQUIRED_ISO_DATE_FIELDS = ["dob", "expiryDate"];
  const VALID_REVIEW_STATUSES = new Set(["VALID"]);

  function validateManifestForEntry(manifest, options = {}) {
    const result = inspectManifestForEntry(manifest, options);
    if (!result.valid) {
      throw new Error(formatManifestValidationErrors(result.errors));
    }
    return result;
  }

  function inspectManifestForEntry(manifest, options = {}) {
    const errors = [];
    const warnings = [];
    const allowOcrManifest = options.allowOcrManifest !== false;

    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      return {
        valid: false,
        errors: ["Root JSON harus berupa object."],
        warnings,
        memberCount: 0,
      };
    }

    const schemaVersion = stringValue(manifest.schemaVersion);
    if (!schemaVersion) {
      warnings.push("schemaVersion tidak ada; gunakan file export JSON terbaru dari desktop.");
    } else if (schemaVersion === OCR_MANIFEST_SCHEMA_VERSION) {
      if (!allowOcrManifest) {
        errors.push("Upload harus memakai nusuk-entry-batch.json dari tombol Export JSON desktop.");
      } else {
        warnings.push("File ini manifest OCR mentah; untuk production lebih aman upload nusuk-entry-batch.json hasil Export JSON.");
      }
    } else if (schemaVersion !== ENTRY_BATCH_SCHEMA_VERSION) {
      errors.push(`schemaVersion tidak dikenal: ${schemaVersion}.`);
    }

    const contractVersion = stringValue(manifest.contractVersion);
    if (contractVersion && contractVersion !== OCR_CONTRACT_VERSION) {
      errors.push(`contractVersion tidak dikenal: ${contractVersion}.`);
    }

    if (!Array.isArray(manifest.members) || !manifest.members.length) {
      errors.push("JSON harus memiliki members[] yang tidak kosong.");
      return { valid: false, errors, warnings, memberCount: 0 };
    }

    const seenIds = new Set();
    manifest.members.forEach((member, index) => {
      validateMember(member, index, seenIds, errors);
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      memberCount: manifest.members.length,
    };
  }

  function validateMember(member, index, seenIds, errors) {
    const label = `members[${index + 1}]`;
    if (!member || typeof member !== "object" || Array.isArray(member)) {
      errors.push(`${label} harus berupa object.`);
      return;
    }

    const id = stringValue(member.id);
    if (!id) {
      errors.push(`${label}.id wajib diisi agar pilihan jamaah stabil.`);
    } else if (seenIds.has(id)) {
      errors.push(`${label}.id duplikat: ${id}.`);
    } else {
      seenIds.add(id);
    }

    const status = stringValue(member.reviewStatus || member.status).toUpperCase();
    if (!VALID_REVIEW_STATUSES.has(status)) {
      errors.push(`${memberLabel(member, label)} belum siap entry: reviewStatus harus VALID.`);
    }

    if (member.reviewConfirmed !== true) {
      errors.push(`${memberLabel(member, label)} belum ditandai sudah dicek di desktop.`);
    }

    if (!stringValue(member.passportImagePath) && !stringValue(member.fileName)) {
      errors.push(`${memberLabel(member, label)} harus punya passportImagePath atau fileName untuk upload passport.`);
    }

    const profile = member.resolvedProfile;
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      errors.push(`${memberLabel(member, label)} tidak memiliki resolvedProfile.`);
      return;
    }

    for (const [path, fieldLabel] of REQUIRED_PROFILE_FIELDS) {
      if (!stringValue(deepValue(profile, path))) {
        errors.push(`${memberLabel(member, label)} field ${fieldLabel} wajib diisi.`);
      }
    }

    if (!stringValue(profile.issueDate) && !stringValue(profile.releaseDate)) {
      errors.push(`${memberLabel(member, label)} harus punya issueDate atau releaseDate.`);
    }

    for (const fieldName of REQUIRED_ISO_DATE_FIELDS) {
      const value = stringValue(profile[fieldName]);
      if (value && !isIsoDate(value)) {
        errors.push(`${memberLabel(member, label)} resolvedProfile.${fieldName} harus format YYYY-MM-DD.`);
      }
    }

    const entryDate = stringValue(profile.releaseDate || profile.issueDate);
    if (entryDate && !isIsoDate(entryDate)) {
      errors.push(`${memberLabel(member, label)} issueDate/releaseDate harus format YYYY-MM-DD.`);
    }

    const email = stringValue(profile.email);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push(`${memberLabel(member, label)} email tidak valid.`);
    }

    const phoneDigits = stringValue(profile.mobileNumber).replace(/\D/g, "");
    if (phoneDigits && phoneDigits.length < 8) {
      errors.push(`${memberLabel(member, label)} nomor HP terlalu pendek.`);
    }
  }

  function memberLabel(member, fallback) {
    const profile = member?.resolvedProfile || {};
    const passport = stringValue(profile.passportNumber || member?.passportExtracted?.passportNumber);
    const fileName = stringValue(member?.fileName);
    if (passport && fileName) {
      return `${fallback} (${passport}, ${fileName})`;
    }
    if (passport || fileName) {
      return `${fallback} (${passport || fileName})`;
    }
    return fallback;
  }

  function formatManifestValidationErrors(errors) {
    const items = Array.isArray(errors) ? errors.filter(Boolean) : [];
    const shown = items.slice(0, MAX_ERROR_MESSAGES);
    const remaining = Math.max(0, items.length - shown.length);
    const suffix = remaining ? `; dan ${remaining} error lain.` : "";
    return `JSON belum siap untuk entry Nusuk: ${shown.join("; ")}${suffix}`;
  }

  function formatManifestUploadMessage(memberCount, validation, fileName = "") {
    const prefix = fileName
      ? `${memberCount} data jamaah dimuat dari ${fileName}.`
      : `${memberCount} data jamaah berhasil dimuat.`;
    const warnings = Array.isArray(validation?.warnings) ? validation.warnings.filter(Boolean) : [];
    if (!warnings.length) {
      return prefix;
    }
    return `${prefix} Catatan: ${warnings.slice(0, 2).join(" ")}`;
  }

  function deepValue(node, rawPath) {
    const parts = String(rawPath || "").split(".").filter(Boolean);
    let current = node;
    for (const part of parts) {
      if (!current || typeof current !== "object" || !(part in current)) {
        return "";
      }
      current = current[part];
    }
    return current;
  }

  function stringValue(value) {
    return String(value ?? "").trim();
  }

  function isIsoDate(value) {
    const match = stringValue(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      return false;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
      && date.getUTCMonth() === month - 1
      && date.getUTCDate() === day;
  }

  root.manifestValidator = Object.freeze({
    ENTRY_BATCH_SCHEMA_VERSION,
    OCR_MANIFEST_SCHEMA_VERSION,
    OCR_CONTRACT_VERSION,
    inspectManifestForEntry,
    validateManifestForEntry,
    formatManifestValidationErrors,
    formatManifestUploadMessage,
  });
})();
