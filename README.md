# Sentence by Sentence

A Pomodoro clock that doesn't nag. Set a planned focus time and the clock counts down, then keeps counting past zero, silently, until you stop it. When you stop, it shows how long you actually spent on the task.

Focus time is rewarded with a story: every stretch of focus (one minute by default, adjustable down to seconds) unlocks the next sentence of a novel you load yourself.

![Icon](icons/icon-180.png)

## Features

- **Flexible focus:** Pick a planned duration (15, 25, 45, 60 or any number of minutes). At zero the clock turns amber and counts overtime instead of alarming you.
- **Honest totals:** Stopping shows time on task, planned time, and how far over or under you went. Today's sessions are logged with a running total.
- **History:** Every session is kept, with nothing trimmed. The History tab shows totals for today, 7 days, 30 days and all time, your streak, a daily chart, top tasks and a searchable list. You can rename or delete sessions and export everything as CSV.
- **Sync (optional):** Keep history, story progress and timer settings in step across browsers through a secret gist on your own GitHub account.
- **Breaks:** A 5-minute default break (configurable), quick picks for 10, 15 or 20 minutes, a custom length, or stop the clock entirely.
- **Story rewards:** Load your own stories as **EPUB, HTML or plain text**. AO3 downloads work directly, with tags, summaries and author's notes skipped.
- **Chinese support:** Splits sentences on 。！？…, auto-detects GBK/GB18030 and Big5 text files, and handles full-width indented paragraphs.
- **Keeps your place:** Each story remembers how far you've unlocked and where you were reading. New sentences never scroll the page.
- **Themes:** Sage (follows system light/dark), Parchment, Sakura, Rice Paper, Night Library, Ocean Dusk.
- **Fully offline:** No server, no build step, no account needed. Everything is saved in your browser's local storage. Sync is opt-in.

## Run it

Open `index.html` in a browser by double-clicking it. That's all.

To host it, enable **GitHub Pages** for the repository (Settings → Pages → Deploy from branch → `main`, root). The app is then available at `https://<you>.github.io/<repo>/`.

> **Your data lives in the browser, per address.** Stories and progress saved under `file://…/index.html` are separate from those saved on your GitHub Pages URL, and separate between browsers. Moving the file to a new folder also counts as a new address.

## Sync across devices

Sync is off until you turn it on. Open **History**, scroll to **Sync across devices** (or click the "Sync off" chip in the header), then:

1. On GitHub, go to **Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token**. Tick **only** the `gist` scope and pick an expiry.
2. Paste the token into the page and click **Connect**. Do the same on each device. A second device finds the existing sync gist automatically, and merges its own data in with no "which one wins" question.

Things to know:

- The token is saved only in that browser. With just the `gist` scope it can read and write your gists and nothing else. You can revoke it on GitHub at any time. Don't connect on a shared computer.
- Your data goes into a **secret** gist named "Sentence by Sentence sync". Secret gists are unlisted, not private: anyone who has the link can read it. It contains task names, story titles and timing. It never contains story text or your token.
- Story files aren't synced. Add the same file on another device and its progress and reading position line up automatically.
- What syncs: sessions (including renames and deletions), progress and reading position per story, story removals, and timer settings. What doesn't: story text, the theme, which story is open, and a session in progress.
- If two devices earn sentences in the same story while both are offline, the larger total wins. All sessions are still kept.
- **Disconnect** (in the same panel) forgets the token and gist on that device only. Your local data stays, and the gist stays on GitHub; delete it there if you want it gone.
- If the token expires or is revoked, the chip shows "Token rejected". Paste a new one and nothing is lost. Offline changes are pushed when you're back online.

## Pin it like an app

Windows only pins programs, not documents, so point a shortcut at your browser in app mode:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --app="file:///C:/path/to/sentence-by-sentence/index.html"
```

Then set the shortcut's icon to `icons/icon.ico` and choose **Pin to taskbar**. On a Mac, use `icons/icon.icns` (or paste `icons/icon-1024.png` in Get Info).

## Project layout

```
index.html            the whole app: markup, styles and script in one file
vendor/jszip.min.js   JSZip 3.10.1, used to unzip EPUB files (MIT or GPLv3)
icons/                app icon in every size, plus make_icon.py to regenerate them
tests/                Playwright tests: smoke, sync (mocked GitHub), history
CLAUDE.md             notes for Claude Code: architecture, storage schema, conventions
```

## Tests

The app needs no tooling. The optional smoke test needs Node 18+:

```
npm install
npx playwright install chromium
npm test
```

- The smoke test unlocks sentences at 1 second each. It checks that the reading position doesn't move during or after a session and is restored after a reload.
- The sync tests check the merge rules and simulate two devices sharing a gist, plus token, offline and deleted-gist failures. They use a mocked GitHub API and never contact the real one.
- The history tests check totals, streaks, filters and CSV export against fixture logs.
