#!/usr/bin/env osascript -l JavaScript

// photos-set-keywords.js
// JXA (JavaScript for Automation) port of photos-set-keywords.applescript
// Applies album-name keywords (prefixed with "a:") to all photos in each album.
//
// Usage: ./run.sh  (loads .env automatically)
//   or:  START_FOLDER=2026 osascript -l JavaScript photos-set-keywords.js

ObjC.import("stdlib");

// ─── Environment helper ───────────────────────────────────────────────────────
// $.getenv() throws if the variable is not set, so we wrap it safely.

function getenv(name, fallback) {
  try {
    const val = $.getenv(name);
    return (val !== null && val !== undefined) ? (ObjC.unwrap(val) || fallback) : fallback;
  } catch (_) {
    return fallback;
  }
}

// ─── Configuration ────────────────────────────────────────────────────────────

const START_FOLDER = getenv("START_FOLDER", "");
const TARGET_ALBUM = getenv("TARGET_ALBUM", "");

// Comma-separated lists of folder/album names to skip entirely.
const SKIP_FOLDERS = getenv("SKIP_FOLDERS", "").split(",").map(s => s.trim()).filter(Boolean);
const SKIP_ALBUMS  = getenv("SKIP_ALBUMS",  "").split(",").map(s => s.trim()).filter(Boolean);

// ─── Logging ──────────────────────────────────────────────────────────────────

const C = {
  reset:  "\x1b[0m",
  dim:    "\x1b[2m",
  cyan:   "\x1b[36m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  red:    "\x1b[31m",
};

function ts() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function log(msg)  { console.log(`${C.dim}[${ts()}]     ${msg}${C.reset}`); }
function info(msg) { console.log(`[${ts()}]  ${C.cyan}i${C.reset}  ${msg}`); }
function ok(msg)   { console.log(`[${ts()}]  ${C.green}v${C.reset}  ${msg}`); }
function warn(msg) { console.log(`[${ts()}]  ${C.yellow}!${C.reset}  ${msg}`); }
function fail(msg) { console.log(`[${ts()}]  ${C.red}x${C.reset}  ${msg}`); }
function sep()     { console.log(`${C.dim}[${ts()}]  ${"─".repeat(55)}${C.reset}`); }

// ─── Retry helper ─────────────────────────────────────────────────────────────
// Retries fn up to RETRY_ATTEMPTS times with a fixed 1-second delay between
// attempts to handle AppleEvent timeout errors gracefully.
// JXA's delay() takes seconds.

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_S  = 1;

function withRetry(label, fn) {
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return fn();
    } catch (err) {
      if (attempt === RETRY_ATTEMPTS) {
        fail(`[${label}] Failed after ${RETRY_ATTEMPTS} attempt(s): ${err.message || err}`);
        throw err;
      }
      warn(`[${label}] Attempt ${attempt}/${RETRY_ATTEMPTS} failed (${err.message || err}). Retrying in ${RETRY_DELAY_S}s…`);
      delay(RETRY_DELAY_S);
    }
  }
}

// ─── processAlbum ─────────────────────────────────────────────────────────────

function processAlbum(albumName, mediaItems) {
  if (albumName.startsWith("SYS-")) {
    log(`Skipping system album: ${albumName}`);
    return;
  }

  if (SKIP_ALBUMS.includes(albumName)) {
    log(`Skipping album (in skip list): ${albumName}`);
    return;
  }

  if (TARGET_ALBUM && albumName !== TARGET_ALBUM) {
    log(`Skipping (not target album): ${albumName}`);
    return;
  }

  info(`Processing album: ${albumName}`);

  const newKeyword = `a:${albumName}`;
  let nChanged = 0;

  for (let i = 0; i < mediaItems.length; i++) {
    const photo = mediaItems[i];

    const currentKeywords = withRetry(
      `getKeywords(photo ${i + 1} in "${albumName}")`,
      () => photo.keywords()
    ) || [];

    let alreadyTagged = false;
    const filteredKeywords = [];

    for (const k of currentKeywords) {
      if (k === newKeyword) {
        alreadyTagged = true;
        filteredKeywords.push(k);
      } else if (!k.startsWith("a:")) {
        filteredKeywords.push(k);
      } else {
        log(`Removing stale keyword "${k}" from photo ${i + 1} in "${albumName}"`);
      }
    }

    if (!alreadyTagged) {
      withRetry(`setKeywords(photo ${i + 1} in "${albumName}")`, () => {
        photo.keywords = [...filteredKeywords, newKeyword];
      });
      nChanged++;
    }
  }

  if (nChanged > 0) {
    ok(`${nChanged} photo(s) updated in "${albumName}"`);
  } else {
    log(`No changes needed in "${albumName}"`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function run() {
  const photos = Application("Photos");

  sep();
  info(`START_FOLDER  : "${START_FOLDER || "(all folders)"}"`);
  info(`TARGET_ALBUM  : "${TARGET_ALBUM || "(all albums)"}"`);
  info(`SKIP_FOLDERS  : ${SKIP_FOLDERS.length ? SKIP_FOLDERS.map(s => `"${s}"`).join(", ") : "(none)"}`);
  info(`SKIP_ALBUMS   : ${SKIP_ALBUMS.length  ? SKIP_ALBUMS.map(s  => `"${s}"`).join(", ") : "(none)"}`);
  sep();

  const rawFolders = withRetry("getFolders", () => photos.folders());

  // Collect folder names, sort alphabetically, then filter to those >= START_FOLDER.
  const folderEntries = rawFolders.map(f => ({
    folder: f,
    name: withRetry("getFolderName", () => f.name()),
  }));

  folderEntries.sort((a, b) => a.name.localeCompare(b.name));

  const folders = START_FOLDER
    ? folderEntries.filter(({ name }) => name >= START_FOLDER)
    : folderEntries;

  if (START_FOLDER) {
    info(`Processing ${folders.length} folder(s) with name >= "${START_FOLDER}"`);
  }

  for (const { folder, name: folderName } of folders) {
    if (folderName === "Smart" || SKIP_FOLDERS.includes(folderName)) {
      log(`Skipping folder: ${folderName}`);
      continue;
    }

    info(`Entering folder: ${folderName}`);

    const albums = withRetry(`getAlbums("${folderName}")`, () => folder.albums());

    for (const album of albums) {
      const albumName  = withRetry(`getAlbumName in "${folderName}"`,  () => album.name());
      const mediaItems = withRetry(`getMediaItems("${albumName}")`,    () => album.mediaItems());
      processAlbum(albumName, mediaItems);
    }
  }

  sep();
  ok("Done.");
}

// ─── Entry point ─────────────────────────────────────────────────────────────

run();
