(function () {
  const MUTAMER_LIST_URL = 'https://masar.nusuk.sa/umrah/mutamer/mutamer-list';
  function createNusukHandoff({ chrome, getTarget, setTarget, hasSession, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    async function pageContext(tab) {
      if (tab.status === 'loading') return { pageStatus: 'loading' };
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'NUSUK_QUERY_CONTEXT' });
        return response?.pageStatus ? response : { pageStatus: 'needs_refresh' };
      } catch (_) {
        return { pageStatus: 'needs_refresh' };
      }
    }

    async function list() {
      const tabs = await chrome.tabs.query({ url: ['https://masar.nusuk.sa/*', 'https://*.nusuk.sa/*'] });
      const results = await Promise.all(tabs.map(async tab => ({
        tabId: tab.id, windowId: tab.windowId, title: tab.title || 'Nusuk',
        url: tab.url, active: Boolean(tab.active), ...await pageContext(tab),
      })));
      return { tabs: results, selectedTabId: getTarget() };
    }

    async function open(tabId, preserveSession = true) {
      const context = await list();
      let selected = context.tabs.find(tab => tab.tabId === tabId);
      if (tabId != null && !selected) throw new Error('Tab Nusuk yang dipilih sudah ditutup. Pilih tab lain.');
      const associated = context.tabs.find(tab => tab.tabId === getTarget());
      if (preserveSession && hasSession() && !associated && tabId == null && context.tabs.length) return { ...context, status: 'choose_tab' };
      if (preserveSession && hasSession() && associated && selected && selected.tabId !== associated.tabId) {
        throw new Error('Pekerjaan masih terkait dengan tab Nusuk lain. Jeda atau selesaikan pekerjaan di tab tersebut.');
      }
      selected ||= (preserveSession ? associated : null) || (context.tabs.length === 1 ? context.tabs[0] : null);
      if (!selected && context.tabs.length > 1) return { ...context, status: 'choose_tab' };
      if (!selected) {
        const tab = await chrome.tabs.create({ url: 'https://masar.nusuk.sa/', active: true });
        selected = { tabId: tab.id, windowId: tab.windowId, title: 'Nusuk', url: tab.url, pageStatus: 'loading' };
      }
      setTarget(selected.tabId);
      // Do not set url or reload: keep the existing Nusuk document and login.
      await chrome.tabs.update(selected.tabId, { active: true });
      if (selected.windowId != null) await chrome.windows.update(selected.windowId, { focused: true });
      return { status: selected.pageStatus, selectedTabId: selected.tabId, tabs: [selected] };
    }

    async function prepareEntry(tab, { isCancelled = () => false, forceFresh = false } = {}) {
      const checkCancelled = () => { if (isCancelled()) throw new Error('Persiapan pengisian dibatalkan.'); };
      checkCancelled();
      const context = await pageContext(tab);
      checkCancelled();
      if (!forceFresh && context.pageStatus === 'ready' && context.contentReady !== false) return tab;
      if (context.pageStatus === 'login_required') throw new Error('Login ke Nusuk terlebih dahulu, lalu pilih Mulai pengisian kembali. Data batch tetap tersimpan.');
      if (context.pageStatus === 'needs_refresh') throw new Error('Muat ulang tab Nusuk sekali agar extension aktif, lalu coba lagi.');
      if (!/^https:\/\/masar\.nusuk\.sa(?:\/|$)/.test(tab.url || '')) {
        throw new Error('Buka Masar Nusuk pada browser ini sebelum memulai pengisian.');
      }
      if (forceFresh || !['ready', 'loading'].includes(context.pageStatus)) {
        if (!forceFresh && !context.canNavigateToEntry) throw new Error('Buka Masar Nusuk pada browser ini sebelum memulai pengisian.');
        await chrome.tabs.update(tab.id, { url: MUTAMER_LIST_URL, active: true });
      }
      const deadline = now() + 20000;
      while (now() < deadline) {
        checkCancelled();
        const current = await chrome.tabs.get(tab.id);
        if (!/^https:\/\/masar\.nusuk\.sa(?:\/|$)/.test(current.url || '')) {
          throw new Error('Selesaikan login Nusuk, lalu pilih Mulai pengisian kembali. Data batch tetap tersimpan.');
        }
        const page = await pageContext(current);
        checkCancelled();
        if (page.pageStatus === 'login_required') throw new Error('Login ke Nusuk terlebih dahulu, lalu pilih Mulai pengisian kembali. Data batch tetap tersimpan.');
        if (page.pageStatus === 'ready' && page.contentReady !== false) return current;
        await sleep(250);
      }
      throw new Error('Mu’tamer List belum siap. Tunggu halaman selesai dimuat, lalu pilih Mulai pengisian kembali. Data batch tetap tersimpan.');
    }

    return { list, open, pageContext, prepareEntry };
  }
  globalThis.createNusukHandoff = createNusukHandoff;
})();
