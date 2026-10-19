# CLAUDE.md

Notes for working on **Sentence by Sentence**, a single-page focus timer that rewards focus time by revealing a user-supplied story one sentence at a time. It has two tabs, Focus (the timer and story) and History (every session ever recorded), and optional cross-device sync through a secret GitHub gist.

## Ground rules

- **One file, no build step.** All markup, CSS and JS live in `index.html`. Keep it that way unless the owner asks otherwise. It must keep working when opened directly from disk (`file://`) with no server and no network.
- **No new network dependencies.** Don't load scripts, fonts or data from CDNs except the Google Fonts stylesheet already there (it degrades to system fonts offline). If a library is needed, vendor it into `vendor/` like JSZip. The only other network use is the opt-in GitHub sync, which talks to `api.github.com` (and `gist.githubusercontent.com` for large files) and nothing else.
- **Sync is an add-on.** With sync off the app makes no requests. With it on, sync never blocks or interrupts the timer, and a failed sync never loses local data.
- **Never break saved data.** Users have stories and progress in `localStorage`. Any change to the stored shape needs a one-time migration at load (see "Migrations" below). Never rename storage keys without migrating.
- **Plain JS in an IIFE.** No frameworks, no modules, no `import`. The script is one `(function(){ "use strict"; … })();` block, organized by `/* ---------- section ---------- */` comments.

## Script map (in order)

| Section | What it does |
|---|---|
| `SAMPLE_TEXT` | Built-in sample story ("The Keeper at Gannet Rock"), always present under id `sample` |
| storage | `load`/`save`/`saveRaw`/`loadRaw` wrappers (all try/catch), state + run objects, migrations, device identity (`device`, `uaName`, `newLogId`) |
| text parsing | `stripGutenberg`, `guessTitle`, CJK detection (`isCJK`, `endsCJK`), `splitSentences` |
| helpers | `$`, `perMs`, `perLabel`, `fmt` (ms → `m:ss` / `h:mm:ss`), `esc`, `hashId`, `book()`, `sentences()`, `focusElapsed`, `liveRevealed`, local-date helpers `dayKey`/`dayStart` (built from y/m/d, so DST-safe), `hm` (ms → `3h 05m`) |
| wake lock | Optional screen wake lock during focus; failures are ignored |
| actions | `startFocus`, `togglePause`, `stopFocus` (commits earned sentences + log entry, then syncs), `startBreak`, `toIdle`; `logChanged()` and `settingsChanged()` save, refresh and schedule a sync |
| controls per mode | `renderControls()` rebuilds the left-panel controls for `idle` / `focus` / `summary` / `break` |
| live display | `tick()` runs every 250 ms: ring, digits, pill, next-sentence bar, the header's live "Focusing" chip and sync chip; calls `renderBook` when the unlocked count changes |
| book rendering | `renderBook(fresh)` rebuilds the prose from unlocked sentences; `renderBookList` fills the story picker |
| reading position | Saves/restores the top visible sentence per story; "Jump to newest" button |
| removing a story | Remove button + in-page confirmation strip (no `confirm()` dialogs) |
| EPUB / HTML extraction | `blockText`, `storyRoot` (AO3 cleanup), `parseHtml`, `parseEpub` (JSZip), `decodeText` (UTF-8 → GB18030/Big5 fallback), `readStory`, file input handler |
| log | Today's sessions list and header total |
| views | `#focus` / `#history` hash routing (`showView`, `applyView`). The Focus view's scroll position is saved while it's hidden, and story opens are deferred via `restorePending` |
| history | Summary cards and streak, inline-SVG daily chart (`renderChart`, tooltip), range/search state `H`, `renderTopTasks`, `renderSessions` (day groups, 60 per "Show more"), rename/delete row actions, `historyCsv` export |
| sync merge | `mergeSyncData` (pure), `canon`, `normEntry`/`normBook`/`normSettings`, `toSyncDoc`, `applySyncDoc` |
| sync (GitHub gist) | `sync` config, `gh()` fetch wrapper with `SyncError` kinds, `findOrCreateGist`, `readGist`, `runSync` (single-flight), `requestSync`/`scheduleSyncAt`, `createNewGist`, online/visibility triggers |
| sync UI | Header chip (`renderSyncChip`), Sync panel at the bottom of History (`renderSyncPanel`, `renderSyncStatus`), `connectSync`, `disconnectSync` |
| themes | `SKINS` list, `applySkin()` sets `data-skin` on `<html>` |
| boot | Validates `run.mode`, picks the view from the hash, renders everything, starts the 250 ms interval, exposes `window.__sbsTest` on `#selftest`, starts a sync if connected |

## Timing model

- Focus time is measured from timestamps (`startedAt`, `accMs`), never by counting ticks, so background tabs and sleep don't drift.
- Sentences unlocked = `floor((book.carryMs + focusElapsed) / perMs())`. On stop, whole units are added to `book.revealed` and the remainder goes to `book.carryMs`, so partial time carries to the next session.
- The countdown never alerts. Past zero it shows `+m:ss` in the "overtime" color (`--brass`).

## Storage schema (`localStorage`)

| Key | Contents |
|---|---|
| `sbs-state-v1` | Settings, story shelf and log (below) |
| `sbs-run-v1` | Current clock state, so a reload mid-session resumes |
| `sbs-text-<id>` | Raw extracted story text for an added story (may fail for very large files; the app then asks the user to re-add the file after reload and keeps their place). Never synced |
| `sbs-device-v1` | `{ id: "d_<random10>", name: "Windows · Chrome" }`. Per device, never synced |
| `sbs-sync-v1` | `{ token, gistId, lastSyncAt, lastError: {kind, message, at} \| null, pending }`. Per device. **The token lives only here**: never log it, and never put it in `sbs-state-v1` or the gist |

`sbs-state-v1`:

```js
{
  focusMin: 25,            // planned focus, minutes  (synced as "settings")
  perSec: 60,              // focus seconds per unlocked sentence
  perUnit: "min"|"sec",    // how the setting is displayed
  perMin, perV2,           // legacy fields kept for migrations; don't use perMin
  breakMin: 5,
  settingsAt,              // when focusMin/perSec/perUnit/breakMin last changed (0 = never)
  task: "",                // last task name typed
  skin: ""|"parchment"|"sakura"|"rice"|"night"|"ocean",   // not synced
  activeId: "sample",                                         // not synced
  books: {
    [id]: {                // id = "sample" or hashId(fileName + "|" + size)
      name, author, fileName,
      revealed,            // committed unlocked sentence count
      carryMs,             // leftover focus ms toward the next sentence
      readAt,              // index of the sentence at the top of the reading view
      updatedAt,           // bumped on any change to revealed/carryMs/name, and on (re-)adding the file
      readAtAt,            // bumped when readAt changes
      zh,                  // cached "is Chinese" flag for typography (local only)
      sample               // true only for the built-in story
    }
  },
  log: [ {                 // every session, never trimmed (~120 bytes each)
    id,                    // "s_<base36 time>_<random6>", or "legacy_<start>_<ms>" for pre-sync entries
    start, end,            // epoch ms; end is missing on legacy entries (UI shows "—")
    ms, planned,           // focused ms (excluding pauses), planned ms
    task, earned,          // earned = sentences unlocked by this session
    bookId, bookName, device,
    updatedAt              // bumped on rename
  } ],
  deletedLog: { [id]: deletedAt },      // tombstones so sync can't bring a deleted session back
  removedBooks: { [id]: removedAt },    // story removal tombstones
  devices: { [deviceId]: name }         // names for History; replaced by the merged map after each sync
}
```

`sbs-run-v1` has `mode` of `idle`, `focus`, `summary` or `break`, plus mode-specific fields (`task`, `plannedMs`, `accMs`, `startedAt`, `running`, `startEpoch`, `elapsedMs`, `earned`, `lastTask`).

### Migrations (top of the script, after `state` is loaded)

1. `perV2`: one-time reset of the old 5-minute default to 1 minute.
2. `perSec`: converts `perMin` to `perSec` and sets `perUnit`.
3. Log ids: entries without `id` get `"legacy_" + start + "_" + ms` and `updatedAt = start`. The id is deterministic, so two devices migrating the same entries agree.
4. `devices` and `deletedLog` maps are created.
5. `removedBooks`: books get `updatedAt = 0` and `readAtAt = 0`. `settingsAt` is 1 if the settings differ from the defaults, else 0, so a new device's defaults never win over them.

Add new ones in the same style: check for a missing field or flag, transform once, `save()`.

## Sync

One **secret** gist (description `Sentence by Sentence sync`) holds one file, `sentence-by-sentence.json`. Secret gists are unlisted, not private: anyone with the URL can read them. The file holds task names, story titles and timing, never story text or the token.

```json
{
  "app": "sentence-by-sentence", "schema": 1, "updatedAt": 1792293728000,
  "log": [ /* entries as in state.log */ ],
  "deletedLog": { "s_abc_123456": 1792293000000 },
  "books": { "b1x9k": { "name": "…", "author": "…", "fileName": "…", "revealed": 412, "carryMs": 23000,
                        "updatedAt": 1792293728000, "readAt": 380, "readAtAt": 1792293700000 } },
  "hiddenBooks": { /* same shape: records that lost to a removal, kept so merges stay order-independent */ },
  "removedBooks": { "b77qa": 1792200000000 },
  "settings": { "focusMin": 25, "perSec": 60, "perUnit": "min", "breakMin": 5, "updatedAt": 1792200000000 },
  "devices": { "d_k2j3h4g5f6": "Windows · Chrome" }
}
```

Written pretty-printed with 1-space indent, so the gist's revision history shows readable diffs. A remote `schema` above 1 stops syncing with a message, and nothing is written.

### Merge rules

`mergeSyncData(a, b)` is **pure** (no DOM, storage or clock) and must stay **commutative, associative and idempotent**: `tests/sync.mjs` checks this on random fixtures. Every rule that picks one side has a deterministic tie-break (larger `canon()` string) for equal timestamps. Inputs are normalized, and malformed entries are dropped.

| Data | Rule |
|---|---|
| `log` | Union by `id`. On the same id, the larger `updatedAt` wins. Ids in `deletedLog` are dropped. Sorted by `start`, then `id` |
| `deletedLog`, `removedBooks` | Union, max timestamp |
| `books[id]` `revealed` + `carryMs` | Taken as a pair: larger `revealed`, then larger `carryMs` |
| `books[id]` `readAt` | From the larger `readAtAt` |
| `books[id]` name/author/fileName | From the larger `updatedAt`. The merged `updatedAt` is the max |
| book vs removal | All records for an id are joined first. Then the book goes in `books` if `updatedAt > removedBooks[id]`, otherwise in `hiddenBooks`. Re-adding or using a story after a removal elsewhere wins. **Never drop hidden records**: that breaks associativity (A at 300, B removes, C re-adds at 3 gives different results in different orders). Consequence: with sync on, a re-added story resumes from the furthest point any device reached |
| `settings` | Whole object, last writer wins by `updatedAt` |
| `devices` | Union. Each device sends only its own entry and sets its own name after merging, so only the owner ever writes it |

**Known, accepted limitation:** if two devices earn sentences on the same story while both are offline, the larger total wins and the other device's progress for that period is lost. All sessions are still kept in the log.

### Sync cycle and triggers

`runSync()` runs one cycle at a time. A request during a run queues exactly one more.
1. Find or create the gist: page through `GET /gists?per_page=100` looking for the file, or `POST /gists`.
2. `GET /gists/{id}` with `cache: "no-store"`. A truncated file is read from `raw_url`.
3. Merge local into remote, then `applySyncDoc` writes it back into local state. It keeps local-only fields. It deletes text for stories whose removal won, and switches `activeId`. It never removes the story open in a running focus session, and it holds settings changes until Stop.
4. `PATCH` only if the merged doc differs from what was pulled, ignoring `updatedAt`.

If two devices write concurrently, one write is lost on the gist. Every device keeps its full copy, so its next sync pushes the difference again.

Triggers:
- page load
- Stop
- 2 s after session rename/delete, story add/remove, or a timer settings change
- 30 s after a reading-position change
- the page becoming visible
- `online` while a push is pending
- **Sync now**

There is no idle timer. `requestSync` keeps the earliest due time.

Errors (`SyncError.kind`):

| Kind | Behaviour |
|---|---|
| `auth` (401) | "Token rejected". No more automatic retries until a new token is entered |
| `notfound` (404) | "Create a new sync gist" button |
| `rate` (403/429 with rate-limit headers, or a "rate limit" message) | Waits until the reset time |
| `network` | `pending = true`, "Offline — pending", retried on `online` |
| others | `forbidden`, `corrupt`, `schema`, `http` |

The sync engine has only been run against the Playwright mock of `api.github.com`, not against real GitHub. That includes CORS from `file://`, and whether fine-grained tokens work with the Gists API.

## Text import rules

- **Plain text:** Gutenberg header/footer stripped. Paragraphs split on blank lines. For Chinese text with one paragraph per line, lines become paragraphs, and unindented lines are joined to the previous paragraph when most lines are indented.
- **HTML / EPUB:** Text is taken from leaf block elements. AO3's `#preface`, `#afterword`, `.endnotes` and `.meta` blocks are removed, but chapter headings inside `.meta` are kept. EPUB chapters follow the OPF spine order; nav, cover, toc and title pages are skipped.
- **Sentences:** `Intl.Segmenter` when available, otherwise a regex that also knows 。！？…. Opening quotes and brackets left at the end of a segment are moved to the next sentence.
- The AO3 cleanup was written against AO3's known download structure but **hasn't been verified on many real files**. If someone reports notes or tags showing up as sentences, check `storyRoot()` first.

## Styling

- All colors are CSS custom properties on `:root`: `--paper --surface --sheet --ink --muted --line --accent --accent-soft --brass --brass-soft --danger --danger-soft`. The default "Sage" palette has light and dark versions (via `prefers-color-scheme` and `[data-theme]`). Other themes are `:root[data-skin="…"]` blocks that set every token plus `color-scheme`.
- To add a theme, add a `[data-skin]` block with all 12 tokens and an entry in `SKINS` (two swatch colors for the picker).
- Fonts: Literata (prose), Figtree (UI), Spline Sans Mono (clock), each with system fallbacks including CJK serif fonts.
- Respect `prefers-reduced-motion`. Keep the layout working at 400px wide.

## UI constraints

- No `alert`/`confirm`/`prompt`. Confirmations are built into the page (see the remove-story strip).
- New sentences must **never** scroll the reading view. Only first open of a story (`lastShown < 0`) restores the saved position.
- Controls are disabled during focus where changing them would corrupt the session (story picker, add, remove).
- Switching tabs must never interrupt a session. History isn't rebuilt on ticks, only when the log changes or the tab opens.
- Deleting a session never takes back the sentences it earned. It records a `deletedLog` tombstone.

## Testing

There's no unit test suite. Three end-to-end Playwright scripts run with `npm test`:

```
npm install && npx playwright install chromium && npm test
# or with an existing Chromium: CHROMIUM_PATH=/path/to/chrome npm test
```

| File | Covers |
|---|---|
| `tests/smoke.mjs` | Sentences unlock without moving the reading view; position restored after reload. Blocks web fonts so the layout is deterministic |
| `tests/sync.mjs` | Merge properties via `window.__sbsTest.mergeSyncData` (exposed only on `#selftest`), connect/find/create gist, two devices sharing a gist, 401, offline + `online` retry, deleted gist, rate limit |
| `tests/history.mjs` | Summary totals and streak against fixture logs (including a session crossing midnight), range/search filters, chart day count, top tasks, CSV, rename/delete, 400px layout, tab switch during a session |
| `tests/helpers.mjs` | In-memory GitHub gist mock (`makeGitHub`) and `device()` (one browser context per device) |

Tests never call real GitHub: everything under `https://api.github.com/**` is answered by the mock.

After changes, also check by hand:
- start, pause and stop a focus session
- overtime display
- each break option
- adding an EPUB, an HTML file and a GBK-encoded Chinese .txt
- removing a story
- switching themes (check History in all six)
- reloading mid-session
- with a real token if possible: connecting two browsers and syncing between them

## Icons

`icons/make_icon.py` (Pillow) draws the icon and writes `icon-1024.png`, `icon-180.png`, `favicon-64.png`, `icon.ico` and `icon.icns`. Edit and re-run it rather than editing the images by hand.
