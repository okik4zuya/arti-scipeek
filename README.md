# ARTi SciPeek

**See a journal's quartile, SJR and H-index while you browse — right where you read about it.**

ARTi SciPeek is a Chrome extension (Manifest V3) that adds [Scimago Journal Rank](https://www.scimagojr.com)
metrics to the pages you already use. It works fully offline: the metrics ship inside the extension,
so nothing is sent to any server.

## Features

- **Inline badges** next to each journal in Scopus and ScienceDirect search results, and in Google
  Scholar search results and author profiles.
- **Floating tab** docked to the right edge of article and journal pages on major publisher sites.
  It shows the quartile and SJR; click it for SJR, H-index and a link to the journal's Scimago page.
- **Consistent colour ramp:** Q1 green, Q2 amber, Q3 orange, Q4 red.
- **Private by design:** no network requests, no tracking, no accounts.

## Supported sites

| Where | What you get |
|---|---|
| Scopus | Inline badges in search results; floating tab on document and source pages |
| ScienceDirect | Inline badges in search results; floating tab on article and journal pages |
| Google Scholar (all country domains) | Inline badges in results and profile publication lists |
| Springer, Nature, ACS, RSC, Taylor & Francis, Wiley, MDPI, IOP, IEEE Xplore, SAGE, Oxford Academic, Frontiers, Science (AAAS), AIP, APS, Cambridge, De Gruyter, PLOS, Cell Press | Floating tab on article and journal pages |

Publisher sites change their markup, so coverage varies. If a page shows no badge, see
[Troubleshooting](#troubleshooting).

## Install (from source)

1. Download or clone this repository.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Open any supported page, for example a Scopus search, or an article on `nature.com`.

After changing any file, click **Reload** on the extension card and refresh the page.

## How it works

1. A content script finds the journal on the page: from a Scopus source id, an ISSN in the page
   metadata or URL, or, as a last resort, an exact journal-title match.
2. It asks an offscreen document that holds a bundled SQLite database of Scimago data, queried
   in the browser with [sql.js](https://github.com/sql-js/sql.js) (SQLite compiled to WebAssembly).
3. The result is drawn as an inline badge or as the floating tab (in a Shadow DOM, so site styles
   cannot break it).

Matching is exact for Scopus (source id) and ISSN-based on most publishers. Google Scholar exposes
only free text, so it falls back to normalised title matching, which can miss unusual abbreviations.
Conference proceedings, theses, books and preprints are not ranked by Scimago and show "—".

## Project layout

| File | Purpose |
|---|---|
| `manifest.json` | Extension manifest and per-site script registration |
| `background.js` | Service worker; creates the offscreen document |
| `offscreen.html`, `offscreen.js` | Owns the SQLite database and answers lookups |
| `content-common.js` | Shared lookup, badge and text-cleanup helpers |
| `content-scopus.js`, `content-sciencedirect.js`, `content-scholar-*.js` | Inline badges for search results and profiles |
| `content-floating.js` | Floating tab for article and journal pages |
| `styles.css` | Inline badge styles |
| `popup.*` | Toolbar popup |
| `assets/journals.sqlite` | Trimmed Scimago snapshot (id, title, ISSN, SJR, quartile, H-index) |
| `lib/` | Vendored sql.js |

## Updating the data

The bundled snapshot comes from Scimago's yearly export. To refresh it, rebuild
`assets/journals.sqlite` from the new year's export with the same columns, then reload the extension
(and bump `version` in `manifest.json` if you publish it).

## Adding a publisher

1. Add its host, e.g. `*://*.example.com/*`, to the floating-tab `matches` list in `manifest.json`.
2. If its journal home pages have a recognisable URL, add a `[hostRegex, pathRegex]` entry to
   `JOURNAL_PATHS` in `content-floating.js`.
3. Article pages are picked up automatically when the page exposes `citation_issn` or
   `prism.issn` meta tags (most publishers do).

## Troubleshooting

If a page shows no badge, open DevTools → Console and look for
`[ARTi SciPeek] no journal key found`. It prints what the extension saw (meta tags, structured
data, ISSN text). To check a page by hand, run this on an article page:

```js
[...document.querySelectorAll('meta[name^=citation_],meta[name^=prism]')]
  .map(m => m.name + '=' + m.content)
  .filter(s => /issn|journal/i.test(s))
```

Some publishers (IEEE Xplore, for example) block unusual traffic, in which case the page itself may
not load.

## Privacy

ARTi SciPeek makes no network requests and collects no data. The only link it adds opens
scimagojr.com, and only when you click it. Its only stored data is the floating tab's position and
collapsed state, kept in your browser's local storage. See `privacy-policy.html`.

## Data and licensing

Journal metrics are derived from the [Scimago Journal & Country Rank](https://www.scimagojr.com)
(based on Scopus data). Check Scimago's terms of use before redistributing the bundled snapshot.
ARTi SciPeek is not affiliated with or endorsed by Scimago, Elsevier, or any publisher listed above.
