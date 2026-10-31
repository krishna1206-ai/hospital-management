// Loaded before first paint so a saved theme never flashes. A separate file because
// the production Content-Security-Policy does not allow inline scripts.
try {
  var theme = localStorage.getItem('hms-theme')
  if (theme) document.documentElement.dataset.theme = theme
} catch {
  // Storage can be blocked; the system theme still applies.
}
