// MV3 service worker. Its only job is to keep exactly one offscreen document
// alive (offscreen.js owns the actual sql.js Database) and hand content
// scripts a promise that resolves once it's safe to send lookup messages.
// Lookup messages themselves go straight from content scripts to
// offscreen.js via chrome.runtime.sendMessage -- this worker ignores them
// (it only listens for "sjm-ensure-offscreen").

const OFFSCREEN_URL = "offscreen.html";
let creating = null;

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  if (existing.length > 0) return;

  if (creating) {
    await creating;
    return;
  }

  creating = chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["WORKERS"],
    justification:
      "Runs sql.js (SQLite compiled to WASM) to query the bundled Scimago journal metrics database offline; service workers can be suspended mid-init.",
  });
  try {
    await creating;
  } finally {
    creating = null;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "sjm-ensure-offscreen") return false;
  ensureOffscreenDocument().then(() => sendResponse({ ok: true }));
  return true;
});
