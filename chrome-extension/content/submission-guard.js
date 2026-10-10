(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};

  function submissionError(message) {
    const error = new Error(`Entry dihentikan: ${message}. Periksa hasil penyimpanan di daftar Nusuk, lalu catat hasilnya di panel untuk melanjutkan.`);
    error.name = "NusukSubmissionError";
    return error;
  }

  function memberIdentity(context) {
    const member = context?.member || {};
    return {
      memberId: String(member.id || ""),
      passportNumber: String(member.resolvedProfile?.passportNumber || "").toUpperCase().replace(/\s+/g, ""),
      passportImagePath: String(member.passportImagePath || "").replace(/\\/g, "/").toLowerCase(),
    };
  }

  function assertNoPending(state) {
    if (state.pendingSubmission) {
      throw submissionError(`hasil simpan jamaah ${state.pendingSubmission.memberId} (${state.pendingSubmission.passportNumber}) belum terkonfirmasi; pengiriman ulang diblokir`);
    }
  }

  function assertPendingMember(state, context) {
    const expected = memberIdentity(context);
    if (!state.pendingSubmission || Object.keys(expected).some(key => state.pendingSubmission[key] !== expected[key])) {
      throw submissionError("konfirmasi sukses tidak memiliki pengiriman yang cocok dengan jamaah aktif");
    }
  }

  async function submitOnce({ state, context, runId, persistState, checkpoint, click }) {
    assertNoPending(state);
    root.identityGuard.verifySummaryIdentity(context);
    const identity = memberIdentity(context);
    if (!identity.memberId || !identity.passportNumber || !identity.passportImagePath) {
      throw root.identityGuard.identityError("identitas pengiriman belum lengkap");
    }
    // Save the lock before sending anything. A reload or delayed response must never submit twice.
    const pending = { ...identity, startedAt: new Date().toISOString() };
    state.pendingSubmission = pending;
    try {
      await persistState({ required: true, submissionCheckpoint: true });
    } catch (error) {
      throw submissionError(`checkpoint sebelum simpan tidak dapat disimpan (${error.message || error})`);
    }
    await checkpoint(runId);
    if (state.pendingSubmission !== pending || Object.keys(identity).some(key => memberIdentity(context)[key] !== identity[key])) {
      throw submissionError("data jamaah berubah sebelum pengiriman");
    }
    // Storage is asynchronous: read the actual form again at the last moment.
    root.identityGuard.verifySummaryIdentity(context);
    await click();
  }

  root.submissionGuard = Object.freeze({ submissionError, assertNoPending, assertPendingMember, submitOnce });
})();
