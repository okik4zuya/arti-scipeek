# ARTi SciPeek — Journal Metrics for Scopus, ScienceDirect & Google Scholar

Adds a **Quartile**, **SJR**, **H-index** and a direct **Scimago link** for journals, in two forms:

- **Inline badges** next to each journal in Scopus and ScienceDirect search results, and Google
  Scholar search results / profile (citations) pages.
- **A floating tab** docked to the right edge on article pages and journal home pages of 20
  publisher sites (plus Scopus document and source pages).

Fully offline — bundles a trimmed Scimago snapshot as SQLite and queries it in-browser via
[sql.js](https://github.com/sql-js/sql.js) (SQLite compiled to WASM). No server, no network calls,
no data leaves the browser. Badge colours are one ramp across both forms: Q1 green, Q2 amber, Q3
orange, Q4 red.

## Load it (unpacked, for testing)

1. `chrome://extensions` → enable **Developer mode** (top right).
2. **Load unpacked** → select this `extension/` folder.
3. Visit a Scopus/ScienceDirect search-results page, a `scholar.google.com/scholar?...` results or
   `scholar.google.com/citations?...` profile page, or an article/journal page on a supported
   publisher (e.g. a `nature.com/articles/...` page).
4. After changing any file (especially `manifest.json`), click **Reload** on the extension card and
   refresh the page.

## Refreshing the data (roughly yearly, whenever Scimago updates)

1. Download the new year's export from Scimago and ingest it as usual:
   `ingest --file scimagojr-2026.csv --year 2026` (see the arti-jfinder README).
2. Re-run the export script to rebuild `assets/journals.sqlite`:
   ```
   python "~/.arti/tools/arti-jfinder/export_extension_db.py"
   ```
3. Reload the extension in `chrome://extensions` (or bump `manifest.json`'s `version` and
   republish, if distributed).

## Scopus: verified against a real page ✅

`content-scopus.js` was checked against a real Scopus results page (table view, 2026-09-13). Each
result's journal sits in `div[data-component="document-source"]`, whose link's href embeds
`/sourceid/<id>` — and that numeric id **is** the Scimago sourceid directly (Scimago is built on
Scopus's own source ids), so matching is an exact primary-key lookup, not fuzzy title/ISSN
matching. Cross-checked 10 sample rows against the bundled DB: 9/10 resolved correctly, 1 not
found (a very new/niche journal not yet in the 2025 Scimago snapshot — correct "not found"
behavior, not a bug). If Scopus changes this markup later, a `console.warn` names what broke.

## ScienceDirect search results: verified ✅ (exact ISSN match)

`content-sciencedirect.js` was checked against a real results page (2026-09-13). Each result's
journal link is `a.subtype-srctitle-link[href*="/science/journal/"]` and its href embeds the ISSN
with the hyphen stripped (e.g. `/science/journal/25425293` → 2542-5293), so matching is by ISSN;
title matching is only a fallback.

## Article & journal pages: floating badge

`content-floating.js` mounts a tab docked to the right edge of the page (like Unpaywall's) on
article pages and journal home pages of ScienceDirect, Cell, Springer, Nature, ACS, RSC, Taylor &
Francis, Wiley, MDPI, IOP, IEEE, Sage, OUP, Frontiers, Science, AIP, APS, Cambridge, De Gruyter and
PLOS, and on Scopus document/source pages. Search-result pages keep their inline badges; the
floating tab is never mounted there.

**Behaviour**
- Collapsed: a gradient tab with the quartile and SJR value. Click to expand into a card with SJR,
  H-index and an "Open on Scimago" button; "–" collapses it again.
- Drag it up/down; the vertical position and collapsed state are remembered per site
  (`localStorage`). It always stays flush with the right edge.
- Rendered in a Shadow DOM inside the browser's top layer (Popover API), so host-page CSS cannot
  restyle it and other extensions' floating widgets cannot cover it.
- Journals not found in the Scimago snapshot show a white "—" tab. Pages where the journal can only
  be guessed from visible text show a badge only on an exact title match, never a "—".

**How the journal is identified** (`extractKeys()`, first hit wins)
1. Scopus: the `sourceid` from `/sourceid/<id>` in the URL, or from the journal link / embedded
   state on document pages, or the source name printed before the document-type label.
2. Article pages: `citation_issn`, `citation_eissn`, `prism.issn`, JSON-LD `issn`, then
   `citation_journal_title` / `prism.publicationName`. Some publishers (nature.com) put the eISSN
   here; the lookup matches ISSN or eISSN.
3. Journal home pages: `JOURNAL_PATHS` marks them per host; ISSN comes from `itemprop="issn"`, the
   URL (`/journal/<issn>`), JSON-LD, or an "ISSN" text scan; the title (h1, `og:title`,
   `document.title`, with "Home"/"Publications" suffixes stripped) is the fallback.
4. Any other page on a listed host: the `h1`/`og:title` as a journal name, exact-match only.

Metadata can arrive late (JS-rendered pages, bot-check interstitials), so extraction re-runs on
`<head>`/root mutations, URL changes, `load`, and at 1.5 / 4 / 10 / 20 s.

**Verification status**
- Confirmed on a live page (2026-10-13): Scopus source pages (`/sourceid/<id>`); nature.com article
  and journal home; link.springer.com journal home.
- Live-tested by the researcher with no problem reported after the fixes below (not individually
  re-confirmed): article pages on ScienceDirect, Cell, Springer, ACS, RSC, MDPI, IOP, OUP, Frontiers,
  AIP, APS, Cambridge, De Gruyter, PLOS; journal home pages on the other listed hosts.
- Fixed but not yet re-confirmed: Wiley, Taylor & Francis, Sage and Science articles (host patterns
  now cover subdomains and late metadata); Wiley, ACS and RSC journal pages; Scopus document pages
  (`/pages/publications/<n>`, journal read from page text).
- IEEE Xplore: the site answers with HTTP 418 (bot protection) in some setups, so the page itself
  does not load; not an extension fault.

**Debugging a page that shows nothing.** About 12 s after load a console line
`[ARTi SciPeek] no journal key found on <url>` prints what was seen (meta tags, JSON-LD, ISSN text,
source links, `h1`, a text sample). To inspect a host by hand, run on an article page:
`[...document.querySelectorAll('meta[name^=citation_],meta[name^=prism]')].map(m=>m.name+'='+m.content).filter(s=>/issn|journal/i.test(s))`
then adjust `extractKeys()` / `JOURNAL_PATHS` in `content-floating.js`.

**Adding a publisher:** add its host (`*://*.example.com/*`) to the floating-script `matches` block in
`manifest.json`, and a `[hostRegex, pathRegex]` row to `JOURNAL_PATHS` if its journal home pages
have a recognisable URL. Sites that already have inline scripts (ScienceDirect, Scopus) load
`content-floating.js` in their existing block, so `content-common.js` is never injected twice.

## Google Scholar works on every Google ccTLD, not just .com

Google Scholar is reachable under many country domains (`scholar.google.co.id`,
`scholar.google.co.uk`, `scholar.google.de`, …), not only `scholar.google.com`. Chrome match
patterns don't support a trailing wildcard for the TLD (`scholar.google.*` is invalid), so
`manifest.json` lists ~45 common Google ccTLDs explicitly for both the results and profile content
scripts. If badges don't appear on a Scholar domain that isn't in that list, add
`*://scholar.google.<tld>/scholar*` / `.../citations*` to the relevant `matches` array and reload
the unpacked extension.

## Google Scholar: verified against real samples ✅ (title matching, not exact-id)

`content-scholar-results.js` (search results) and `content-scholar-profile.js` (a profile's
publication table) were checked against real Scholar markup samples (`google_scholar_search_results.html`,
`google_scholar_profile.html`, project root, 2026-09-13). Scholar exposes no sourceid or ISSN
anywhere in its markup, so both scripts pull the venue name out of free text (`.gs_a` on results
pages; the second `.gs_gray` line per row on profile pages) and strip the trailing year and
volume/issue/page numbers (`sjmStripVenueTail()` in `content-common.js`) before doing a
normalized-title lookup. This is inherently fuzzier than Scopus/ScienceDirect's exact-id/ISSN
matching — conference proceedings, theses, books, and preprints won't be in the Scimago snapshot
and correctly show "not found"; a journal whose Scimago title differs enough from how Scholar
renders it (unusual abbreviations, subtitle differences) can also miss. All 6 distinct journal
venues across both samples were verified to resolve correctly by title after two fixes this made
necessary (both now shipped, benefiting all three sites' title-fallback path, not just Scholar):
`normalizeTitle()` in `offscreen.js` now maps `&` → `and` (Scimago spells "Energy & Environmental
Science" as "Energy and Environmental Science"), and `journals.sqlite` now carries a precomputed
`norm_title` column (`export_extension_db.py`'s `normalize_title()`, mirroring the JS function
exactly) that lookups match against instead of raw SQL `lower(title)` — the old query never
stripped punctuation, so title-only matches (the *only* path Scholar has) silently always missed.

## Before publishing to the Chrome Web Store

- Verify Scimago's terms of use permit redistributing this derived subset (sourceid, title, ISSN,
  SJR, H-index, quartile only — no other columns) inside a publicly distributed extension. This is a
  licensing check, not a technical blocker.
- The floating script adds ~20 publisher hosts to the permissions shown at install; update
  `privacy-policy.html` and the store listing to name them.

## Architecture

- `assets/journals.sqlite` — trimmed snapshot (`sourceid, title, norm_title, issn, eissn, sjr,
  sjr_best_quartile, h_index`), rebuilt by `export_extension_db.py`.
- `lib/sql-wasm.js` + `lib/sql-wasm.wasm` — vendored sql.js (MIT), pinned to a fixed version.
- `background.js` — MV3 service worker; only responsibility is lazily creating the offscreen
  document.
- `offscreen.html` / `offscreen.js` — owns the sql.js `Database` instance for the extension's
  lifetime. Runs here rather than in the service worker because MV3 service workers can be
  suspended mid-computation and don't reliably survive the WASM init + multi-MB fetch.
- `content-floating.js` — edge-docked floating tab for article/journal pages; key extraction
  (meta tags, JSON-LD, Scopus source ids), Shadow DOM + top-layer UI, drag, SPA re-runs.
- `content-common.js` — shared badge-rendering, venue-text-cleanup, and message-passing helpers.
- `styles.css` — inline badge styles (gradient Q1–Q4 ramp, `!important` so host CSS cannot override).
- `popup.html` / `popup.js` / `popup.css` — toolbar popup listing the supported sites.
- `content-scopus.js` / `content-sciencedirect.js` / `content-scholar-results.js` /
  `content-scholar-profile.js` — per-site `MutationObserver`-driven row detection and annotation;
  see the selector notes above.

## Verifying it's fully offline

DevTools → Network tab while browsing a search-results page with the extension active — no
requests to scimagojr.com or any other host should appear (the injected link only opens
scimagojr.com when a user clicks it).
