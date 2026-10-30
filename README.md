# FicShelf

A privacy-first personal fanfiction library for Android phones. Import files you already downloaded, organise them with your own tags, ratings and notes, and find a fic fast with combinable filters. It is a mobile-first PWA: no backend, no account, nothing leaves your device.

## Privacy

| Rule | How it is met |
|---|---|
| No AI on story content | No LLM APIs, embeddings or semantic search. Story prose is never read, indexed or summarised. |
| No uploads or tracking | No network calls with your data, no analytics, no accounts, no cloud sync. |
| Originals untouched | Files are never modified. A stored copy is the exact same bytes. |
| Metadata only | Only existing file metadata or an explicit labelled header is read. Missing fields stay empty and you fill them in. |

## Features

| Area | What it does |
|---|---|
| Import | EPUB, PDF, HTML, TXT. Multiple files at once, hash-based duplicate detection, review and correct before saving, auto vs manual fields shown. |
| Metadata | EPUB OPF fields, PDF document info, HTML meta tags, AO3-style labelled headers, TXT `---` header. Originals are kept separate from your edits. |
| Filters | Fandom, relationship, original tags (required or excluded), personal tags, word range, completion, reading status, rating, format. |
| Filter logic | Choices in one group match any; different groups must all match; required tags must all be present; excluded tags hide a fic if any is present. |
| Saved filters | Name and save a combination; it persists after closing the app. |
| Personal tags | Create, rename, delete, tag one or many fics. Deleting a tag never deletes a fic. |
| Reading | Status, 1 to 5 star rating, notes, favourites, Random Fic. |
| Local copies | Optional. Store an EPUB or PDF in the browser and open it inside FicShelf. |
| Backup | Export or restore a metadata JSON backup. It never contains story files. |

## Requirements

- Node.js 18 or newer (developed on 22)
- npm

## Running it

```bash
npm install          # install dependencies
npm run dev          # dev server at http://localhost:5173
npm test             # run the test suite
npm run build        # type-check and build to dist/
npm run preview      # serve the production build locally
```

## Installing on Android

PWAs need HTTPS (localhost is the only exception), so the app has to be hosted to install on a phone.

1. Run `npm run build`.
2. Upload the `dist/` folder to any static host (Netlify, GitHub Pages, Cloudflare Pages).
3. Open the HTTPS URL in Chrome on the phone.
4. Menu (three dots), then **Install app** or **Add to Home screen**.

The app shell and your library metadata work offline after the first load. The hosted site only serves the app code and never sees your library.

## Local copies

Importing with "Store a copy" off keeps metadata only. With it on, the file is saved in the browser's IndexedDB.

| Behaviour | Detail |
|---|---|
| Formats | EPUB and PDF only. |
| Open Fic | EPUBs open in the built-in reader. PDFs open in the browser viewer if it has one, otherwise in another app via the share sheet or a download. |
| Space check | Quota is estimated before storing and errors are shown if it won't fit. |
| Integrity | Stored copies are checked against the imported file's hash before opening. |
| Removal | Removing a copy keeps your metadata and your original file. |

Browser storage is limited and can be cleared when the device runs low on space or when you clear site data. Asking for persistent storage (Settings) makes this less likely but does not guarantee anything. Keep your original files as the master copy.

## Project structure

```
src/
  App.tsx           UI: home, library, collections, settings, import review, details
  Reader.tsx        EPUB reader, PDF viewer, share/download fallback
  extract.ts        Metadata extraction and file hashing
  filter.ts         Filter engine and metadata search
  db.ts             Dexie schema (versioned), backup/restore, add/remove helpers
  storage.ts        Local-copy storage, quota checks, integrity checks
  types.ts          Shared types
  fixtures.ts       Synthetic test files (fictional metadata)
  *.test.ts         Filter, extraction and storage tests
```

Stack: React, TypeScript, Vite, Tailwind CSS, Dexie (IndexedDB), vite-plugin-pwa, JSZip, pdf-lib, epub.js.

## Database

Tables: `works`, `tags`, `filters`, `files` (schema v2). To change the schema, add a new `this.version(n+1).stores({...}).upgrade(...)` block in `db.ts`. Never edit an existing version.

## Tests

33 tests cover filtering (combined, excluded, ranges, status), extraction for every format, corrupt and password-protected files, "no prose is read" checks, hash determinism, duplicate detection, tag deletion, backup and restore, and local-copy storage (quota, missing, corrupted, removal). Fixtures are generated in memory with fictional data. No real fanfiction is used.

## Known limitations

- HTML and TXT files cannot be stored as local copies yet.
- Android Chrome has no inline PDF viewer, so PDFs open in another app.
- The reader is basic (no table of contents, font controls or search).
- Hashing and verification load the whole file into memory, which can strain very large files on low-memory phones.
- The filter panel has no controls yet for author, character, warning, chapter range or date added. The engine supports them.
- The reader, share sheet and storage estimates are untested on real devices.
- Backups never include stored files.

## Hosting on GitHub Pages

1. Push this project to a GitHub repo on the `main` branch.
2. In the repo, open **Settings, Pages**, and set **Source** to **GitHub Actions**.
3. The workflow in `.github/workflows/deploy.yml` runs the tests, builds with the correct base path, and deploys.
4. Open `https://YOUR-USERNAME.github.io/REPO-NAME/` in Chrome on Android, let it load once, then use **Install app**.

Your library is stored in the browser for that exact URL. Export a metadata backup before changing the repo name or host.
