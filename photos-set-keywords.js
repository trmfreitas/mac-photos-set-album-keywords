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

const START_FOLDER  = getenv("START_FOLDER", "");
const TARGET_ALBUM  = getenv("TARGET_ALBUM", "");
const LOG_LEVEL_STR = getenv("LOG_LEVEL", "info").toLowerCase();

// Comma-separated lists of folder/album names to skip entirely.
const SKIP_FOLDERS = getenv("SKIP_FOLDERS", "").split(",").map(s => s.trim()).filter(Boolean);
const SKIP_ALBUMS  = getenv("SKIP_ALBUMS",  "").split(",").map(s => s.trim()).filter(Boolean);

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLogLevel = LOG_LEVELS[LOG_LEVEL_STR] ?? LOG_LEVELS.info;

// ─── Logger ───────────────────────────────────────────────────────────────────

function ts() {
  return new Date().toISOString().replace("T", " ").slice(0, 23);
}

const log = {
  debug: (msg) => { if (currentLogLevel <= LOG_LEVELS.debug) console.log(`[${ts()}] DEBUG  ${msg}`); },
  info:  (msg) => { if (currentLogLevel <= LOG_LEVELS.info)  console.log(`[${ts()}] INFO   ${msg}`); },
  warn:  (msg) => { if (currentLogLevel <= LOG_LEVELS.warn)  console.log(`[${ts()}] WARN   ${msg}`); },
  error: (msg) => { if (currentLogLevel <= LOG_LEVELS.error) console.log(`[${ts()}] ERROR  ${msg}`); },
};

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
        log.error(`[${label}] Failed after ${RETRY_ATTEMPTS} attempt(s): ${err.message || err}`);
        throw err;
      }
      log.warn(`[${label}] Attempt ${attempt}/${RETRY_ATTEMPTS} failed (${err.message || err}). Retrying in ${RETRY_DELAY_S}s…`);
      delay(RETRY_DELAY_S);
    }
  }
}

// ─── processAlbum ─────────────────────────────────────────────────────────────

function processAlbum(albumName, mediaItems) {
  if (albumName.startsWith("SYS-")) {
    log.debug(`Skipping system album: ${albumName}`);
    return;
  }

  if (SKIP_ALBUMS.includes(albumName)) {
    log.debug(`Skipping album (in skip list): ${albumName}`);
    return;
  }

  if (TARGET_ALBUM && albumName !== TARGET_ALBUM) {
    log.debug(`Skipping (not target album): ${albumName}`);
    return;
  }

  log.info(`Processing album: ${albumName}`);

  const newKeyword = `a:${albumName}`;
  let nChanged = 0;

  for (let i = 0; i < mediaItems.length; i++) {
    const photo = mediaItems[i];

    const currentKeywords = withRetry(
      `getKeywords(photo ${i + 1} in "${albumName}")`,
      () => photo.keywords()
    );

    let alreadyTagged = false;
    const filteredKeywords = [];

    for (const k of currentKeywords) {
      if (k === newKeyword) {
        alreadyTagged = true;
        filteredKeywords.push(k);
      } else if (!k.startsWith("a:")) {
        filteredKeywords.push(k);
      } else {
        log.debug(`Removing stale keyword "${k}" from photo ${i + 1} in "${albumName}"`);
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
    log.info(`Updated ${nChanged} photo(s) in album "${albumName}"`);
  } else {
    log.debug(`No changes needed in album "${albumName}"`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function run() {
  const photos = Application("Photos");

  log.info("─── Photos keyword sync ───────────────────────────────");
  log.info(`  START_FOLDER  : "${START_FOLDER || "(all folders)"}"`);
  log.info(`  TARGET_ALBUM  : "${TARGET_ALBUM || "(all albums)"}"`);
  log.info(`  SKIP_FOLDERS  : ${SKIP_FOLDERS.length ? SKIP_FOLDERS.map(s => `"${s}"`).join(", ") : "(none)"}`);
  log.info(`  SKIP_ALBUMS   : ${SKIP_ALBUMS.length  ? SKIP_ALBUMS.map(s  => `"${s}"`).join(", ") : "(none)"}`);
  log.info("───────────────────────────────────────────────────────");

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
    log.info(`Processing ${folders.length} folder(s) with name >= "${START_FOLDER}"`);
  }

  for (const { folder, name: folderName } of folders) {
    if (folderName === "Smart" || SKIP_FOLDERS.includes(folderName)) {
      log.debug(`Skipping folder: ${folderName}`);
      continue;
    }

    log.info(`Entering folder: ${folderName}`);

    const albums = withRetry(`getAlbums("${folderName}")`, () => folder.albums());

    for (const album of albums) {
      const albumName  = withRetry(`getAlbumName in "${folderName}"`,  () => album.name());
      const mediaItems = withRetry(`getMediaItems("${albumName}")`,    () => album.mediaItems());
      processAlbum(albumName, mediaItems);
    }
  }

  log.info("Done.");
}

// ─── Entry point ─────────────────────────────────────────────────────────────

run();
