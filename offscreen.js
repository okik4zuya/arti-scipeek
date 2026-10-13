// Owns the sql.js Database instance for the extension's lifetime. Lives in an
// offscreen document rather than the background service worker because MV3
// service workers can be suspended mid-computation and don't reliably survive
// the synchronous WASM init + multi-MB fetch this requires.

const dbPromise = (async () => {
  const SQL = await initSqlJs({
    locateFile: (file) => chrome.runtime.getURL(`lib/${file}`),
  });
  const buf = await fetch(chrome.runtime.getURL("assets/journals.sqlite")).then((r) =>
    r.arrayBuffer()
  );
  return new SQL.Database(new Uint8Array(buf));
})();

function normalizeIssn(s) {
  if (!s) return null;
  const cleaned = s.replace(/[^0-9Xx]/g, "").toUpperCase();
  return cleaned.length === 8 ? cleaned : null;
}

function normalizeTitle(s) {
  if (!s) return null;
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ") // Scimago spells "&" out as "and" in its Title column
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function lookupOne(db, { sourceid, issn, eissn, title } = {}) {
  if (sourceid != null) {
    const stmt = db.prepare(
      "SELECT sourceid, sjr, sjr_best_quartile, h_index FROM journals WHERE sourceid = :s LIMIT 1"
    );
    stmt.bind({ ":s": sourceid });
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row;
    }
    stmt.free();
    return null; // an exact Scimago sourceid was given and it wasn't found -- don't fall back to fuzzy matching
  }

  const candidates = [normalizeIssn(issn), normalizeIssn(eissn)].filter(Boolean);
  for (const code of candidates) {
    const stmt = db.prepare(
      "SELECT sourceid, sjr, sjr_best_quartile, h_index FROM journals WHERE issn = :c OR eissn = :c LIMIT 1"
    );
    stmt.bind({ ":c": code });
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row;
    }
    stmt.free();
  }

  const normTitle = normalizeTitle(title);
  if (normTitle) {
    const stmt = db.prepare(
      "SELECT sourceid, sjr, sjr_best_quartile, h_index, title FROM journals WHERE norm_title = :t LIMIT 1"
    );
    stmt.bind({ ":t": normTitle });
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row;
    }
    stmt.free();
  }

  return null;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "sjm-lookup-batch") return false;
  dbPromise.then((db) => {
    const results = (msg.entries || []).map((entry) => lookupOne(db, entry));
    sendResponse({ results });
  });
  return true; // keep the message channel open for the async response
});
