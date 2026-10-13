// Google Scholar profile (citations) page annotator.
//
// Verified against a real profile-table sample (2026-09-13, `google_scholar_profile.html`). Each
// publication row (`tr.gsc_a_tr`) has two `.gs_gray` divs in its `td.gsc_a_t`: authors, then
// "<venue> <vol> (<issue>), <pages>" with the year appended by a nested `.gs_oph` span, e.g.
//   "IOP conference series: earth and environmental science 105 (1), 012059, 2018"
// No sourceid/ISSN here either, so this hands the second `.gs_gray` div's full text straight to
// sjmStripVenueTail() (same helper used by the search-results script) to strip the trailing year
// and volume/issue/page numbers, leaving the venue name for a normalized-title lookup. Rows for
// conference proceedings, theses, etc. legitimately won't match anything in the journal snapshot.
//
// The table paginates via a "Show more" button that appends rows to #gsc_a_b -- the existing
// MutationObserver picks those up the same way as the initial load.

const SELECTORS = {
  row: "tr.gsc_a_tr",
  cell: "td.gsc_a_t",
  title: "a.gsc_a_at",
};

const processed = new WeakSet();

function extractKey(row) {
  const cell = row.querySelector(SELECTORS.cell);
  if (!cell) return null;
  const grayLines = cell.querySelectorAll(".gs_gray");
  if (grayLines.length < 2) return null;
  const title = sjmStripVenueTail(grayLines[1].textContent || "");
  if (!title) return null;
  return { title };
}

function injectBadge(row, result) {
  const cell = row.querySelector(SELECTORS.cell);
  if (!cell || cell.querySelector(".sjm-badge")) return;
  const title = cell.querySelector(SELECTORS.title);
  if (!title) return;
  const badge = sjmBuildBadge(result);
  badge.classList.add("sjm-badge--block");
  // Right under the title, above the authors/venue lines -- same "own line
  // under the title" placement as Scopus/ScienceDirect and the search-results
  // script.
  title.parentElement.insertBefore(badge, title.nextSibling);
}

async function scan() {
  const rows = Array.from(document.querySelectorAll(SELECTORS.row)).filter(
    (r) => !processed.has(r)
  );
  if (rows.length === 0) return;
  rows.forEach((r) => processed.add(r));
  await sjmAnnotateRows(rows, extractKey, injectBadge);
}

const observer = new MutationObserver(() => {
  clearTimeout(observer._t);
  observer._t = setTimeout(scan, 300);
});
observer.observe(document.body, { childList: true, subtree: true });

scan();

setTimeout(() => {
  if (document.querySelectorAll(SELECTORS.row).length === 0) {
    console.warn(
      "[Scimago Journal Metrics] No Google Scholar profile rows matched SELECTORS.row -- " +
        "the site's markup likely changed. See the comment at the top of content-scholar-profile.js."
    );
  }
}, 3000);
