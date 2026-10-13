// Google Scholar search-results annotator.
//
// Verified against a real result-row sample (2026-09-13, `google_scholar_search_results.html`).
// Unlike Scopus/ScienceDirect, Scholar exposes no sourceid/ISSN to key off -- the venue name
// sits inside the free-text `.gs_a` line, e.g.
//   "X Chang, T Wang, J Gong - Energy & Environmental Science, 2016 - pubs.rsc.org"
// which is "<authors> - <venue>, <year> - <host>". Split on " - " (the middle segment(s), since
// venue names occasionally contain their own " - ") and hand the remainder to
// sjmStripVenueTail() to drop the trailing ", <year>". Rows with only 2 segments (no venue, e.g.
// preprints/theses/patents) are skipped -- they have nothing to look up. This is inherently
// fuzzier than Scopus/ScienceDirect's exact-id matching: it's a normalized-title match only, so
// abbreviated venue names or house styles Scholar doesn't spell out in full will miss.

const SELECTORS = {
  row: "div.gs_r.gs_or",
  authorsLine: ".gs_a",
  title: ".gs_rt",
};

const processed = new WeakSet();

function extractKey(row) {
  const line = row.querySelector(SELECTORS.authorsLine);
  if (!line) return null;
  const parts = (line.textContent || "").split(/\s+-\s+/).filter((p) => p.trim());
  if (parts.length < 3) return null; // no distinct venue segment
  const venueRaw = parts.slice(1, -1).join(" - ");
  const title = sjmStripVenueTail(venueRaw);
  if (!title) return null;
  return { title };
}

function injectBadge(row, result) {
  if (row.querySelector(".sjm-badge")) return;
  const line = row.querySelector(SELECTORS.authorsLine);
  if (!line) return;
  const badge = sjmBuildBadge(result);
  badge.classList.add("sjm-badge--block");
  // Above the authors/venue line, right under the title -- matches the
  // "badge as its own line under the title" placement used on Scopus/
  // ScienceDirect (Scholar has no separate venue element to key off, so the
  // whole .gs_a line, authors included, sits below instead of just the
  // venue).
  const title = row.querySelector(SELECTORS.title);
  if (title && title.parentElement) {
    title.parentElement.insertBefore(badge, title.nextSibling);
  } else {
    line.parentElement.insertBefore(badge, line);
  }
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
      "[Scimago Journal Metrics] No Google Scholar result rows matched SELECTORS.row -- " +
        "the site's markup likely changed. See the comment at the top of content-scholar-results.js."
    );
  }
}, 3000);
