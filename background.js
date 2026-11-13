// Fetches JSON for the content script so cross-origin job APIs aren't blocked by CORS.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "fetchJson") return;
  fetch(msg.url, { headers: { Accept: "application/json" }, credentials: "omit" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
  return true; // keep the channel open for the async response
});
