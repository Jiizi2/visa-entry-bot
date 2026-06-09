export function createRecentBatchActions({
  dom,
  state,
  basenameFromPath,
  recentEntryByPath,
  saveRecentBatches,
  renderAll,
  requestFrame = (callback) => callback(),
}) {
  let recentDeletePath = "";
  let recentEditPath = "";

  function openRecentDeleteModal(path) {
    const entry = recentEntryByPath(path);
    if (!entry || !dom.recentDeleteModal) {
      return;
    }

    recentDeletePath = entry.path;
    if (dom.recentDeleteModalDesc) {
      const label = entry.label || basenameFromPath(entry.path);
      dom.recentDeleteModalDesc.textContent =
        `Hapus "${label}" dari Riwayat Pilihan? File scan dan manifest tidak ikut dihapus.`;
    }
    dom.recentDeleteModal.classList.remove("is-hidden");
    dom.recentDeleteModal.setAttribute("aria-hidden", "false");
    requestFrame(() => dom.recentDeleteCancelButton?.focus());
  }

  function closeRecentDeleteModal() {
    recentDeletePath = "";
    if (!dom.recentDeleteModal) {
      return;
    }
    dom.recentDeleteModal.classList.add("is-hidden");
    dom.recentDeleteModal.setAttribute("aria-hidden", "true");
  }

  function confirmRecentDelete() {
    const targetPath = recentDeletePath;
    if (!targetPath) {
      closeRecentDeleteModal();
      return;
    }

    const removedEntry = recentEntryByPath(targetPath);
    state.recentBatches = state.recentBatches.filter((entry) => entry.path !== targetPath);
    saveRecentBatches(state.recentBatches);
    closeRecentDeleteModal();
    state.statusHeadline = "Riwayat dihapus";
    state.statusDetail = `${removedEntry?.label || basenameFromPath(targetPath)} dihapus dari Riwayat Pilihan.`;
    renderAll();
  }

  function openRecentEditModal(path) {
    const entry = recentEntryByPath(path);
    if (!entry || !dom.recentEditModal || !dom.recentEditInput) {
      return;
    }

    recentEditPath = entry.path;
    dom.recentEditInput.value = entry.label || basenameFromPath(entry.path);
    dom.recentEditModal.classList.remove("is-hidden");
    dom.recentEditModal.setAttribute("aria-hidden", "false");
    requestFrame(() => {
      dom.recentEditInput.focus();
      dom.recentEditInput.select();
    });
  }

  function closeRecentEditModal() {
    recentEditPath = "";
    if (!dom.recentEditModal) {
      return;
    }
    dom.recentEditModal.classList.add("is-hidden");
    dom.recentEditModal.setAttribute("aria-hidden", "true");
  }

  function confirmRecentEdit() {
    const targetPath = recentEditPath;
    if (!targetPath || !dom.recentEditInput) {
      closeRecentEditModal();
      return;
    }

    const entry = recentEntryByPath(targetPath);
    if (!entry) {
      closeRecentEditModal();
      return;
    }

    const nextLabel = dom.recentEditInput.value.trim() || basenameFromPath(targetPath);
    state.recentBatches = state.recentBatches.map((item) =>
      item.path === targetPath
        ? { ...item, label: nextLabel }
        : item,
    );
    saveRecentBatches(state.recentBatches);
    closeRecentEditModal();
    state.statusHeadline = "Riwayat diperbarui";
    state.statusDetail = `Nama riwayat diubah menjadi ${nextLabel}.`;
    renderAll();
  }

  return {
    openRecentDeleteModal,
    closeRecentDeleteModal,
    confirmRecentDelete,
    openRecentEditModal,
    closeRecentEditModal,
    confirmRecentEdit,
  };
}
