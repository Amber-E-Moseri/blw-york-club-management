// Installed Hub apps launched before the unified platform opened "/", which is now the public website. When such an
// app is launched in standalone mode at the root, send it to the Hub. Ordinary browser visits are not affected.
// Kept as an external script so the site's Content-Security-Policy (script-src 'self') still applies.
(function () {
  try {
    var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (standalone && window.location.pathname === '/') window.location.replace('/hub');
  } catch (e) {
    /* No matchMedia or no storage: stay on the public site. */
  }
})();
