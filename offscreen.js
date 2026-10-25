// Owns the sql.js Database instances for the extension's lifetime. Lives in an
// offscreen document rather than the background service worker because MV3
// service workers can be suspended mid-computation and don't reliably survive
// the synchronous WASM init + multi-MB fetch this requires.
//
// Two bundled snapshots: assets/journals.sqlite (Scimago: Quartile/SJR/H-index) and
// assets/sinta.sqlite (SINTA: Indonesian S1-S6 accreditation + metrics). A lookup answers
// { scimago: row|null, sinta: row|null }, or null when neither has the journal.

async function openDb(SQL, path) {
  const buf = await fetch(chrome.runtime.getURL(path)).then((r) => r.arrayBuffer());
  return new SQL.Database(new Uint8Array(buf));
}

const dbPromise = (async () => {
  const SQL = await initSqlJs({
    locateFile: (file) => chrome.runtime.getURL(`lib/${file}`),
  });
  // Both files are fetched at once. SINTA is optional: if its file is missing or unreadable,
  // Scimago lookups keep working.
  const [scimago, sinta] = await Promise.all([
    openDb(SQL, "assets/journals.sqlite"),
    openDb(SQL, "assets/sinta.sqlite").catch(() => null),
  ]);
  return { scimago, sinta };
})();

function normalizeIssn(s) {
  if (!s) return null;
  const cleaned = s.replace(/[^0-9Xx]/g, "").toUpperCase();
  return cleaned.length === 8 ? cleaned : null;
}

// Keep in sync with norm_title() in sinta-scraper/build_sinta_db.py and the Scimago exporter.
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

function queryOne(db, sql, params) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    return stmt.step() ? stmt.getAsObject() : null;
  } finally {
    stmt.free();
  }
}

const SCIMAGO_COLS = "sourceid, issn, eissn, sjr, sjr_best_quartile, h_index";

function lookupScimago(db, { sourceid, issn, eissn, title } = {}) {
  if (sourceid != null) {
    // an exact Scimago sourceid was given: no fuzzy fallback if it isn't found
    return queryOne(db, `SELECT ${SCIMAGO_COLS} FROM journals WHERE sourceid = :s LIMIT 1`, { ":s": sourceid });
  }

  const candidates = [normalizeIssn(issn), normalizeIssn(eissn)].filter(Boolean);
  for (const code of candidates) {
    const row = queryOne(
      db,
      `SELECT ${SCIMAGO_COLS} FROM journals WHERE issn = :c OR eissn = :c LIMIT 1`,
      { ":c": code }
    );
    if (row) return row;
  }

  const normTitle = normalizeTitle(title);
  if (normTitle) {
    return queryOne(db, `SELECT ${SCIMAGO_COLS} FROM journals WHERE norm_title = :t LIMIT 1`, { ":t": normTitle });
  }
  return null;
}

const SINTA_COLS = "sinta_id, level, impact, h5_index, citations_5yr, citations, scopus, garuda";

// ISSNs first (several SINTA profiles can share one ISSN: best level, then highest impact wins),
// then the normalised title -- the SINTA table only stores a norm_title when it is unique.
function lookupSinta(db, issns, title) {
  if (!db) return null;
  for (const code of issns) {
    const row = queryOne(
      db,
      `SELECT ${SINTA_COLS} FROM sinta WHERE issn = :c OR eissn = :c ORDER BY level ASC, impact DESC LIMIT 1`,
      { ":c": code }
    );
    if (row) return row;
  }
  const normTitle = normalizeTitle(title);
  if (normTitle) {
    return queryOne(db, `SELECT ${SINTA_COLS} FROM sinta WHERE norm_title = :t LIMIT 1`, { ":t": normTitle });
  }
  return null;
}

function lookupOne(dbs, entry = {}) {
  const scimago = lookupScimago(dbs.scimago, entry);
  if (entry.sourceid != null && !scimago) return null;

  const issns = [
    normalizeIssn(entry.issn),
    normalizeIssn(entry.eissn),
    scimago && scimago.issn,
    scimago && scimago.eissn,
  ].filter(Boolean);
  // Once Scimago has identified the journal, SINTA may only be joined on ISSN. A title match there
  // is wrong whenever an Indonesian journal shares its name with an international one (34 such
  // pairs, e.g. "Journal of Food Engineering": Elsevier 0260-8774 vs SINTA 2810-0824).
  const sinta = lookupSinta(dbs.sinta, Array.from(new Set(issns)), scimago ? null : entry.title);

  return scimago || sinta ? { scimago, sinta } : null;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "sjm-lookup-batch") return false;
  dbPromise.then((dbs) => {
    const results = (msg.entries || []).map((entry) => lookupOne(dbs, entry));
    sendResponse({ results });
  });
  return true; // keep the message channel open for the async response
});
