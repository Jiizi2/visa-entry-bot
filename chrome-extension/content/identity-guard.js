(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const NAME_FIELDS = ["firstName", "fatherName", "grandfatherName", "familyName"];
  const GROUPS = ["firstName", "secondName", "thirdName", "familyName"];
  const GROUP_ALIASES = [[], ["fatherName"], ["grandfatherName", "grandFatherName"], []];
  const LABELS = ["First Name", "Father's Name", "Grandfather Name", "Family Name"];
  const PASSPORT_LABELS = ["Passport Number", "Passport No", "Passport No.", "Passport #", "Passport Number (English)", "Passport No. (English)", "Nomor Paspor", "No Paspor", "No. Paspor", "رقم جواز السفر", "رقم الجواز"];
  const FULL_NAME_LABELS = ["Full Name", "Full Name (English)", "Name (English)", "Mutamer Name"];
  const ATTACHMENT_LABELS = ["Passport Image", "Passport File", "Passport Attachment"];
  const SUMMARY_NAME_LABELS = LABELS.map((label, index) => [label, `${label} (English)`, ...(index === 1 ? ["Father Name", "Father Name (English)"] : []), ...(index === 2 ? ["Grandfather's Name", "Grand Father Name"] : [])]);
  const FIELD_LABEL_SELECTOR = "label, dt, span, p, div, th, td, strong, b";
  const PASSPORT_LABEL_SET = new Set(PASSPORT_LABELS.map(normalizeFieldLabel));
  const IDENTITY_LABELS = new Set([...PASSPORT_LABELS, ...FULL_NAME_LABELS, ...ATTACHMENT_LABELS, ...SUMMARY_NAME_LABELS.flat()].map(normalizeFieldLabel));
  const DISPLAY_MARKS = /[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;
  const PASSPORT_INPUT_SELECTOR = [
    ...["passportNumber", "passportNo", "passportNum", "passport_number", "passport_no"].flatMap(field => ["formcontrolname", "name", "id"].map(attribute => `input[${attribute}='${field}' i]`)),
    ...["passportNumber", "passportNo"].flatMap(field => ["formcontrolname", "name"].map(attribute => `input[${attribute}$='.${field}' i]`)),
  ].join(", ");

  function identityError(message, retryable = false) {
    const error = new Error(`Entry dihentikan: ${message}. Periksa data dan paspor jamaah sebelum melanjutkan.`);
    error.name = "NusukIdentityError";
    error.retryable = retryable;
    error.detail = message;
    return error;
  }

  function recordDataWarning(context, key, message) {
    context.identityEvidence = context.identityEvidence || {};
    const warnings = context.identityEvidence.dataWarnings = context.identityEvidence.dataWarnings || [];
    if (warnings.some(warning => warning.key === key)) return;
    warnings.push({ key, message });
    context.onDataWarning?.({ key, message });
  }

  function normalizeName(value) {
    return String(value || "").toUpperCase().replace(/\s+/g, " ").trim();
  }

  function normalizePassport(value) {
    // Equivalent display characters only; never guess O/0, I/1 or a missing digit.
    const number = String(value || "").normalize("NFKC").toUpperCase()
      .replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) - (digit <= "٩" ? 0x660 : 0x6f0)))
      .replace(DISPLAY_MARKS, "").replace(/\s+/g, "");
    return /^[\-\u2013\u2014]*$/.test(number) ? "" : number;
  }

  function normalizeFieldLabel(value) {
    return normalizeName(value).normalize("NFKC").replace(/[’‘]/g, "'")
      .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "")
      .replace(/[\s:*]+$/g, "").trim();
  }

  function normalizeFilename(value) {
    return String(value || "").trim().toLowerCase();
  }

  // Summary display formatting only. File lookup and the selected disk path
  // remain exact; preserve letters, numeric suffixes, hyphens and extensions.
  function normalizeDisplayedFilename(value) {
    return normalizeFilename(value).normalize("NFC").replace(/[\s_]+/g, " ");
  }

  function visibleNodes(selector) {
    return root.domUtils.queryAll(selector).filter(root.domUtils.isVisible);
  }

  function visibleText(node) {
    return typeof node.innerText === "string" ? node.innerText : String(node.textContent || "");
  }

  function nameSelector(index, language) {
    const group = GROUPS[index];
    const label = LABELS[index];
    const labels = [label, ...(index === 1 ? ["Father Name"] : []), ...(index === 2 ? ["Grand father", "Grandfather's Name", "Grand Father Name"] : [])];
    const placeholders = language === "ar" ? labels.map(text => `${text} (Arabic)`) : labels.flatMap(text => [text, `${text} (English)`]);
    return [
      ...[group, ...GROUP_ALIASES[index]].flatMap(name => [
        `[formgroupname='${name}'] input[formcontrolname='${language}']`,
        `input[formcontrolname='${name}.${language}']`,
        `input[name='${name}.${language}']`,
      ]),
      ...placeholders.map(text => `input[placeholder="${text}" i]`),
    ].join(", ");
  }

  function nameInputs(index, language) {
    return visibleNodes(nameSelector(index, language));
  }

  // Only read values next to an exact field label; unrelated page text is not evidence.
  function labeledValues(labels) {
    const wanted = new Set(labels.map(normalizeFieldLabel));
    const values = [];
    const entries = visibleNodes(FIELD_LABEL_SELECTOR).flatMap(node => {
      const text = visibleText(node).trim();
      if (wanted.has(normalizeFieldLabel(text))) return [{ node, label: text }];
      const inline = text.match(/^([^:\n：]{1,80})[:：\n]\s*([\s\S]*)$/);
      return inline && wanted.has(normalizeFieldLabel(inline[1])) ? [{ node, label: inline[1], value: inline[2].trim() }] : [];
    });
    for (const { node, label, value } of entries) {
      // Prefer the closest label rather than also reading its encompassing card.
      if (entries.some(entry => entry.node !== node && node.contains?.(entry.node))) continue;
      const previousCount = values.length;
      if (node.control && root.domUtils.isVisible(node.control) && "value" in node.control) {
        values.push(node.control.value);
        continue;
      }
      if (value !== undefined) {
        if (value.length <= 250) values.push(/^[\s\-\u2013\u2014]*$/.test(value) ? "" : value);
        continue;
      }
      const cell = node.closest?.("th, td");
      const sibling = node.tagName === "DT" ? node.nextElementSibling : cell?.nextElementSibling;
      if (sibling && (node.tagName === "DT" ? sibling.tagName === "DD" : sibling.tagName === "TD") && root.domUtils.isVisible(sibling)) {
        const inputs = Array.from(sibling.querySelectorAll("input")).filter(root.domUtils.isVisible);
        if (inputs.length <= 1) values.push(inputs.length ? inputs[0].value : visibleText(sibling).trim());
        continue;
      }
      let scope = node.parentElement;
      for (let depth = 0; scope && depth < 3; depth++, scope = scope.parentElement) {
        if (scope === node.ownerDocument?.body || scope === node.ownerDocument?.documentElement) break;
        const otherLabels = Array.from(scope.querySelectorAll?.(FIELD_LABEL_SELECTOR) || []).filter(root.domUtils.isVisible);
        if (otherLabels.some(other => other !== node && !other.contains?.(node)
          && (["LABEL", "DT", "TH"].includes(other.tagName) || IDENTITY_LABELS.has(normalizeFieldLabel(visibleText(other)))))) break;
        const inputs = Array.from(scope.querySelectorAll?.("input") || []).filter(root.domUtils.isVisible);
        if (inputs.length === 1) {
          values.push(inputs[0].value);
          break;
        }
        if (inputs.length > 1 || scope.tagName === "FORM") break;
        const text = visibleText(scope).trim();
        if (text.length > 250) break;
        const remainder = text.replace(label, "").replace(/^[\s:：*]+/, "").trim();
        if (remainder) {
          values.push(/^[\s\-\u2013\u2014]*$/.test(remainder) ? "" : remainder);
          break;
        }
      }
      // A displayed field with no value is still a present, empty field. In a
      // summary it must not disappear from the split-name consistency check.
      if (values.length === previousCount) values.push("");
    }
    return values;
  }

  function assertValues(values, expected, normalize, label, retryableMismatch = false) {
    const actual = [...new Set(values.map(normalize).filter(Boolean))];
    if (!actual.length) throw identityError(`${label} di halaman Nusuk tidak dapat diverifikasi`, true);
    if (actual.some(value => value !== normalize(expected))) {
      throw identityError(`${label} Nusuk (${actual.join(" / ")}) berbeda dari data jamaah (${expected})`, retryableMismatch);
    }
  }

  function passportValues() {
    const values = visibleNodes(PASSPORT_INPUT_SELECTOR)
      .map(node => node.value);
    values.push(...visibleNodes("input[placeholder], input[aria-label]")
      .filter(node => ["placeholder", "aria-label"].some(attribute => PASSPORT_LABEL_SET.has(normalizeFieldLabel(node.getAttribute(attribute)))))
      .map(node => node.value));
    values.push(...labeledValues(PASSPORT_LABELS));
    return values;
  }

  function hasVerifiedPassportIdentity(context) {
    const expected = normalizePassport(context?.member?.resolvedProfile?.passportNumber);
    return Boolean(expected && context.identityEvidence?.passportNumber === expected);
  }

  async function waitForIdentityCheck(checkName, context, { checkpoint, sleep, runId, timeoutMs = 15000, onWait } = {}) {
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    let notified = false;
    while (true) {
      await checkpoint(runId);
      try {
        root.identityGuard[checkName](context);
        return;
      } catch (error) {
        // Angular can expose the previous value before replacing it. Wait for
        // the requested check to pass before allowing navigation or submission.
        if (error?.name !== "NusukIdentityError" || Date.now() >= deadline) throw error;
        if (!notified) {
          onWait?.();
          notified = true;
        }
      }
      await sleep(Math.min(180, Math.max(1, deadline - Date.now())), runId);
    }
  }

  function verifyPassportIdentity(context) {
    const expected = context?.member?.resolvedProfile?.passportNumber;
    if (!expected) throw identityError("nomor paspor jamaah kosong");
    assertValues(passportValues(), expected, normalizePassport, "Nomor paspor");
    context.identityEvidence = context.identityEvidence || {};
    context.identityEvidence.passportNumber = normalizePassport(expected);
  }

  function fullName(profile) {
    return NAME_FIELDS.map(field => profile?.[field]).filter(Boolean).join(" ");
  }

  function reviewedProfile(context) {
    const member = context?.member || {};
    const profile = member.resolvedProfile || {};
    if (member.reviewConfirmed !== true || String(member.reviewStatus || member.status || "").trim().toUpperCase() !== "VALID") {
      throw identityError("data nama EntryMate belum dikonfirmasi melalui review");
    }
    if (!normalizeName(profile.firstName) || !normalizeName(profile.familyName)) {
      throw identityError("nama hasil review EntryMate belum lengkap");
    }
    return profile;
  }

  function verifyMemberPassport(context) {
    // Some Member Forms hide this field after Passport Details. Reuse only
    // the number verified in this member's run, and reject any live conflict.
    if (passportValues().some(value => normalizePassport(value)) || !hasVerifiedPassportIdentity(context)) {
      verifyPassportIdentity(context);
    }
    const uploaded = context.identityEvidence?.passportFile;
    if (uploaded && (uploaded.memberId !== String(context.member.id)
      || uploaded.path !== String(context.member.passportImagePath))) {
      throw identityError("file paspor yang diunggah bukan milik jamaah aktif");
    }
    // Nusuk may hide or rename the attachment display. A readable conflict
    // still blocks entry; unavailable display evidence is only a reminder.
    verifyPassportFile(context, false);
  }

  function recordPassportUpload(context, requestedPath, selectedFilename) {
    const member = context?.member || {};
    const expectedPath = String(member.passportImagePath || "");
    const expectedFile = expectedPath.replace(/\\/g, "/").split("/").pop();
    if (!expectedPath || String(requestedPath) !== expectedPath
      || (selectedFilename && selectedFilename !== expectedFile)) {
      throw identityError("file upload paspor berbeda dari berkas jamaah aktif");
    }
    context.identityEvidence = context.identityEvidence || {};
    context.identityEvidence.passportFile = { memberId: String(member.id), path: expectedPath };
  }

  function verifyPassportName(context) {
    const profile = reviewedProfile(context);
    // Nusuk OCR is diagnostic only. The operator-reviewed EntryMate profile
    // supplies the names after the active passport and available file are checked.
    const fields = GROUPS.map((_, index) => nameInputs(index, "en"));
    const values = fields.map(inputs => {
      const observed = [...new Set(inputs.map(input => normalizeName(input.value)))];
      if (observed.length > 1) throw identityError("beberapa kolom nama paspor menampilkan data yang berbeda");
      return observed[0] || "";
    });
    const observedName = values.filter(Boolean).join(" ");
    const expectedName = normalizeName(fullName(profile));
    // Every destination needed for the reviewed name must exist. An unknown
    // control cannot be treated as an OCR omission that can be filled safely.
    NAME_FIELDS.forEach((field, index) => {
      if (normalizeName(profile[field]) && !fields[index].length) {
        throw identityError(`kolom ${field} (en) tidak dapat diverifikasi`, true);
      }
    });
    verifyMemberPassport(context);
    if (!Object.prototype.hasOwnProperty.call(context.identityEvidence, "uploadedPassportName")) {
      context.identityEvidence.uploadedPassportName = observedName;
      if (observedName !== expectedName) {
        context.identityEvidence.nameCorrection = { observedName, expectedName };
      }
    }
    context.identityEvidence.passportName = expectedName;
  }

  function verifyMemberNames(context, { warnOnly = false } = {}) {
    const profile = reviewedProfile(context);
    if (context.identityEvidence?.passportName !== normalizeName(fullName(profile)) || !hasVerifiedPassportIdentity(context)) {
      throw identityError("paspor aktif belum diverifikasi untuk jamaah ini");
    }
    verifyMemberPassport(context);
    for (const language of ["en", "ar"]) {
      const expected = language === "ar" ? profile.arabic || {} : profile;
      NAME_FIELDS.forEach((field, index) => {
        const inputs = nameInputs(index, language);
        const value = normalizeName(expected[field]);
        if (!inputs.length && !value && (index === 1 || index === 2)) return;
        if (!inputs.length) throw identityError(`kolom ${field} (${language}) tidak dapat diverifikasi`, true);
        const mismatched = inputs.filter(input => normalizeName(input.value) !== value);
        if (mismatched.length) {
          const message = `kolom ${field} (${language}) berubah, terpotong, atau masih berisi nama lain`;
          if (warnOnly) {
            recordDataWarning(context, `member_name_${language}_${field}`, message);
            return;
          }
          const error = identityError(message, Boolean(value) && mismatched.every(input => !normalizeName(input.value)));
          error.code = "name_fields_mismatch";
          throw error;
        }
      });
    }
  }

  function checkMemberNames(context) {
    verifyMemberNames(context, { warnOnly: true });
  }

  async function ensureMemberNames(context, { checkpoint, sleep, runId, isCurrentForm } = {}) {
    for (let attempt = 0; ; attempt++) {
      await checkpoint(runId);
      if (!isCurrentForm()) throw identityError("halaman Member Form berubah sebelum pemeriksaan nama");
      try {
        verifyMemberNames(context);
        return;
      } catch (error) {
        if (error?.code !== "name_fields_mismatch") throw error;
        if (attempt >= 2) {
          checkMemberNames(context);
          return;
        }
      }
      // verifyMemberNames has checked the reviewed profile and active passport.
      // Repair only its known name controls; never correct a different passport.
      const profile = reviewedProfile(context);
      const destinations = [];
      for (const language of ["en", "ar"]) {
        const expected = language === "ar" ? profile.arabic || {} : profile;
        NAME_FIELDS.forEach((field, index) => {
          const inputs = nameInputs(index, language);
          if (!inputs.length && (normalizeName(expected[field]) || index === 0 || index === 3)) {
            throw identityError(`kolom ${field} (${language}) tidak dapat diverifikasi`, true);
          }
          if (inputs.length > 1) throw identityError("beberapa kolom nama terlihat; pengisian ulang tidak dapat dilakukan dengan aman");
          for (const input of inputs) {
            destinations.push({ input, value: String(expected[field] || "").trim() });
          }
        });
      }
      for (const { input, value } of destinations) {
        if (!isCurrentForm()) throw identityError("halaman Member Form berubah sebelum pengisian ulang nama");
        verifyMemberPassport(context);
        if (normalizeName(input.value) !== normalizeName(value)) root.domUtils.setInputValue(input, value);
      }
      await sleep(300, runId);
    }
  }

  function verifySummaryIdentity(context) {
    // The live passport number remains mandatory, including after a reload.
    // Name differences are reminders for the operator's individual review.
    const profile = reviewedProfile(context);
    verifyPassportIdentity(context);
    const values = labeledValues(FULL_NAME_LABELS);
    const parts = SUMMARY_NAME_LABELS.map(labels => labeledValues(labels));
    parts.forEach((part, index) => {
      const mismatched = part.map(value => normalizeName(/^[\s\-\u2013\u2014]*$/.test(value) ? "" : value))
        .filter(value => value !== normalizeName(profile[NAME_FIELDS[index]]));
      if (mismatched.length) {
        recordDataWarning(context, `summary_name_${NAME_FIELDS[index]}`, `kolom ${NAME_FIELDS[index]} pada ringkasan berbeda dari data jamaah`);
      }
    });
    if (!values.some(value => normalizeName(value))) {
      if (parts[0].length && parts[3].length) {
        values.push(parts.map(part => /^[\s\-]*$/.test(part[0] || "") ? "" : part[0]).filter(Boolean).join(" "));
      }
    }
    try {
      assertValues(values, fullName(profile), normalizeName, "Nama pada ringkasan");
    } catch (error) {
      if (error?.name !== "NusukIdentityError") throw error;
      recordDataWarning(context, "summary_full_name", error.detail);
    }
    verifyPassportFile(context);
  }

  function verifyPassportFile(context, required = true) {
    const expectedPath = String(context?.member?.passportImagePath || "").replace(/\\/g, "/");
    const expectedFile = expectedPath.split("/").pop();
    if (!expectedFile) throw identityError("path file paspor jamaah kosong");
    const filenames = labeledValues(ATTACHMENT_LABELS)
      .flatMap(value => String(value).split(/\r?\n/))
      .map(line => line.trim().match(/^(.+?\.[a-z0-9]{2,10})(?=$|[\s\u00b7\u2022])/i)?.[1])
      .filter(Boolean);
    if (!filenames.length) {
      if (required || labeledValues(ATTACHMENT_LABELS).some(value => String(value).trim())) {
        recordDataWarning(context, "passport_file_unreadable", "nama file paspor pada halaman Nusuk tidak terbaca; periksa lampiran jamaah ini");
      }
      return;
    }
    assertValues(filenames, expectedFile, normalizeDisplayedFilename, "File paspor pada ringkasan");
    if (filenames.some(value => normalizeFilename(value) !== normalizeFilename(expectedFile))) {
      const batchMembers = context?.batchMembers || context?.members || [];
      const ambiguous = batchMembers.some(member => {
        const path = String(member?.passportImagePath || member?.fileName || "").replace(/\\/g, "/");
        return normalizeFilename(path) !== normalizeFilename(expectedPath)
          && normalizeDisplayedFilename(path.split("/").pop()) === normalizeDisplayedFilename(expectedFile);
      });
      if (ambiguous) throw identityError(`File paspor pada ringkasan ambigu (${filenames.join(" / ")}); beberapa file batch memiliki nama tampilan yang sama`);
    }
  }

  root.identityGuard = Object.freeze({ nameSelector, identityError, recordDataWarning, hasVerifiedPassportIdentity, waitForIdentityCheck, recordPassportUpload, verifyPassportIdentity, verifyPassportName, verifyMemberNames, checkMemberNames, ensureMemberNames, verifySummaryIdentity });
})();
