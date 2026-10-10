(function () {
  function createBatchFileImporter({ validate, accept, notify, blocked = () => false, busy = () => {} }) {
    let importing = false;
    async function importFiles(files) {
      if (importing) { notify('Tunggu file JSON selesai dimuat.', 'warning'); return false; }
      const reason = blocked();
      if (reason) { notify(typeof reason === 'string' ? reason : 'Batch sedang aktif. Periksa pekerjaan lalu reset sebelum mengganti file JSON.', 'error'); return false; }
      const selected = Array.from(files || []);
      if (selected.length !== 1 || !/\.json$/i.test(selected[0]?.name || '')) {
        notify('Letakkan satu file .json hasil review EntryMate.', 'error');
        return false;
      }
      importing = true;
      busy(true);
      notify('Membaca dan memeriksa file JSON…', 'neutral');
      try {
        const manifest = JSON.parse(await selected[0].text());
        validate(manifest, { allowOcrManifest: false });
        if (blocked()) throw new Error('Pekerjaan sudah dimulai. Reset sebelum mengganti batch.');
        const response = await accept(manifest);
        if (response?.ok !== true) throw new Error(response?.error || 'Tab Nusuk belum menerima file. Muat ulang tab, lalu seret file kembali.');
        notify(`${manifest.members.length} jamaah dimuat dari ${selected[0].name}. Periksa batch, lalu mulai pengisian.`, 'success');
        return true;
      } catch (error) {
        notify(error instanceof SyntaxError ? 'Isi file bukan JSON yang valid. Buat ulang file di halaman Entry.' : error.message || String(error), 'error');
        return false;
      } finally {
        importing = false;
        busy(false);
      }
    }
    function bindDropTarget(target, dropZone) {
      let depth = 0;
      const isFile = event => Array.from(event.dataTransfer?.types || []).includes('Files') || event.dataTransfer?.files?.length;
      target.addEventListener('dragenter', event => {
        if (!isFile(event)) return;
        event.preventDefault();
        depth++;
        dropZone?.classList.add('is-drag-over');
      });
      target.addEventListener('dragover', event => {
        if (!isFile(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = importing || blocked() ? 'none' : 'copy';
      });
      target.addEventListener('dragleave', event => {
        if (!isFile(event)) return;
        if (--depth <= 0) { depth = 0; dropZone?.classList.remove('is-drag-over'); }
      });
      target.addEventListener('drop', event => {
        if (!isFile(event)) return;
        event.preventDefault();
        depth = 0;
        dropZone?.classList.remove('is-drag-over');
        void importFiles(event.dataTransfer.files);
      });
    }
    return { importFiles, bindDropTarget, isImporting: () => importing };
  }
  globalThis.createBatchFileImporter = createBatchFileImporter;
})();
