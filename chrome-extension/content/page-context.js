(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  function readPageContext({ document = window.document, location = window.location } = {}) {
    const url = String(location.href || '').toLowerCase();
    const text = String(document.body?.innerText || '').toLowerCase();
    if (/\/(login|auth|signin|sessionexpired)(\/|\?|#|$)/.test(url)
        || document.querySelector("input[type='password'], input[name='password'], input[formcontrolname='password']")
        || text.includes('session expired') || text.includes('please login')) {
      return { pageStatus: 'login_required' };
    }
    if (document.readyState === 'loading') return { pageStatus: 'loading' };
    // Entry can start from the Mutamer list or an existing Add Mutamer form.
    if (/\/umrah\/mutamer\/(add-mutamer|mutamer-list)(\/|\?|#|$)/.test(url)) {
      return { pageStatus: 'ready' };
    }
    return { pageStatus: 'navigate_required', canNavigateToEntry: /^https:\/\/masar\.nusuk\.sa(?:\/|$)/.test(url) };
  }
  root.pageContext = { readPageContext };
})();
