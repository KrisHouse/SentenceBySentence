# CLAUDE.md

Notes for working on **Sentence by Sentence**, a single-page focus timer that rewards focus time by revealing a user-supplied story one sentence at a time.

## Ground rules

- **One file, no build step.** All markup, CSS and JS live in `index.html`. Keep it that way unless the owner asks otherwise. It must keep working when opened directly from disk (`file://`) with no server and no network.
- **No new network dependencies.** Don't load scripts, fonts or data from CDNs except the Google Fonts stylesheet already there (it degrades to system fonts offline). If a library is needed, vendor it into `vendor/` like JSZip.
- **Never break saved data.** Users have stories and progress in `localStorage`. Any change to the stored shape needs a one-time migration at load (see "Migrations" below). Never rename storage keys without migrating.
- **Plain JS in an IIFE.** No frameworks, no modules, no `import`. The script is one `(function(){ "use strict"; … })();` block, organized by `/* ---------- section ---------- */` comments.

## Script map (in order)

| Section | What it does |
|---|---|
| `SAMPLE_TEXT` | Built-in sample story ("The Keeper at Gannet Rock"), always present under id `sample` |
| storage | `load`/`save`/`saveRaw`/`loadRaw` wrappers (all try/catch), state + run objects, migrations |
| text parsing | `stripGutenberg`, `guessTitle`, CJK detection (`isCJK`, `endsCJK`), `splitSentences` |
| helpers | `$`, `perMs`, `perLabel`, `fmt` (ms → `m:ss` / `h:mm:ss`), `esc`, `hashId`, `book()`, `sentences()`, `focusElapsed`, `liveRevealed` |
| wake lock | Optional screen wake lock during focus; failures are ignored |
| actions | `startFocus`, `togglePause`, `stopFocus` (commits earned sentences + log entry), `startBreak`, `toIdle` |
| controls per mode | `renderControls()` rebuilds the left-panel controls for `idle` / `focus` / `summary` / `break` |
| live display | `tick()` runs every 250 ms: ring, digits, pill, next-sentence bar; calls `renderBook` when the unlocked count changes |
| book rendering | `renderBook(fresh)` rebuilds the prose from unlocked sentences; `renderBookList` fills the story picker |
| reading position | Saves/restores the top visible sentence per story; "Jump to newest" button |
| removing a story | Remove button + in-page confirmation strip (no `confirm()` dialogs) |
| EPUB / HTML extraction | `blockText`, `storyRoot` (AO3 cleanup), `parseHtml`, `parseEpub` (JSZip), `decodeText` (UTF-8 → GB18030/Big5 fallback), `readStory`, file input handler |
| log | Today's sessions list and header total |
| themes | `SKINS` list, `applySkin()` sets `data-skin` on `<html>` |
| boot | Validates `run.mode`, renders everything, starts the 250 ms interval |

## Timing model

- Focus time is measured from timestamps (`startedAt`, `accMs`), never by counting ticks, so background tabs and sleep don't drift.
- Sentences unlocked = `floor((book.carryMs + focusElapsed) / perMs())`. On stop, whole units are added to `book.revealed` and the remainder goes to `book.carryMs`, so partial time carries to the next session.
- The countdown never alerts. Past zero it shows `+m:ss` in the "overtime" color (`--brass`).

## Storage schema (`localStorage`)

| Key | Contents |
|---|---|
| `sbs-state-v1` | Settings, story shelf and log (below) |
| `sbs-run-v1` | Current clock state, so a reload mid-session resumes |
| `sbs-text-<id>` | Raw extracted story text for an added story (may fail for very large files; the app then asks the user to re-add the file after reload and keeps their place) |

`sbs-state-v1`:

```js
{
  focusMin: 25,            // planned focus, minutes
  perSec: 60,              // focus seconds per unlocked sentence
  perUnit: "min"|"sec",    // how the setting is displayed
  perMin, perV2,           // legacy fields kept for migrations; don't use perMin
  breakMin: 5,
  task: "",                // last task name typed
  skin: ""|"parchment"|"sakura"|"rice"|"night"|"ocean",
  activeId: "sample",
  books: {
    [id]: {                // id = "sample" or hashId(fileName + "|" + size)
      name, author, fileName,
      revealed,            // committed unlocked sentence count
      carryMs,             // leftover focus ms toward the next sentence
      readAt,              // index of the sentence at the top of the reading view
      zh,                  // cached "is Chinese" flag for typography
      sample               // true only for the built-in story
    }
  },
  log: [ { task, start /*epoch ms*/, ms, planned } ]   // trimmed to 7 days
}
```

`sbs-run-v1` has `mode` of `idle`, `focus`, `summary` or `break`, plus mode-specific fields (`task`, `plannedMs`, `accMs`, `startedAt`, `running`, `startEpoch`, `elapsedMs`, `earned`, `lastTask`).

### Migrations (top of the script, after `state` is loaded)

1. `perV2`: one-time reset of the old 5-minute default to 1 minute.
2. `perSec`: converts `perMin` to `perSec` and sets `perUnit`.

Add new ones in the same style: check for a missing field or flag, transform once, `save()`.

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

## Testing

There's no unit test suite. `tests/smoke.mjs` is an end-to-end check with Playwright:

```
npm install && npx playwright install chromium && npm test
```

After changes, also check by hand: start/pause/stop a focus session, overtime display, each break option, adding an EPUB, an HTML file and a GBK-encoded Chinese .txt, removing a story, switching themes, and reloading mid-session.

## Icons

`icons/make_icon.py` (Pillow) draws the icon and writes `icon-1024.png`, `icon-180.png`, `favicon-64.png`, `icon.ico` and `icon.icns`. Edit and re-run it rather than editing the images by hand.
