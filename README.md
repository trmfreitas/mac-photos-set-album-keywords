# mac-photos-set-album-keywords

Synchronises macOS Photos album membership into each photo's keyword metadata. This lets you search, filter, and export photos by album anywhere keywords are supported — even outside the Photos app.

Album names are stamped as keywords prefixed with `a:`:

```
Album "2026 Rome Trip"  →  keyword  a:2026 Rome Trip
```

---

## Expected Photos library structure

The script is designed around the following organisation in the Photos app:

```
📁 2024                   ← folder (year)
   📷 2024 Summer Holiday  ← album (year + activity)
   📷 2024 Birthday Party
📁 2025
   📷 2025 Japan Trip
   📷 2025 Christmas
📁 2026
   📷 2026 Rome Trip
   ...
```

- **Folders** represent years (or any other top-level grouping).
- **Albums** inside each folder represent individual events or activities.
- Each album's name becomes an `a:` keyword on every photo it contains.

### Ignored items

| Item | Why it is skipped |
|------|-------------------|
| Folder `Smart` | Contains smart albums managed by Photos — not real albums |
| Albums starting with `SYS-` | System albums used internally by the organisation system — not for tagging |
| Albums listed in `SKIP_ALBUMS` | Manually excluded via config (e.g. `Duplicates`) |
| Folders listed in `SKIP_FOLDERS` | Manually excluded via config |

---

## How it works

1. **Fetch & sort** all top-level folders alphabetically by name.
2. **Filter** to folders whose name is ≥ `START_FOLDER` (e.g. `START_FOLDER=2026` processes `2026`, `2027`, …).
3. For each qualifying folder, iterate its albums.
4. For each album (unless skipped — see above), iterate every photo:
   - Read current keywords.
   - Remove any stale `a:*` keywords from previous runs.
   - If the current album keyword (`a:<albumName>`) is not already present, add it and write the updated keyword list back.
5. Log the count of updated photos per album.

Existing non-`a:` keywords are always preserved.

### Retry logic

Every call to the Photos app is wrapped in a **3-attempt retry** with a **1-second fixed delay** between attempts, guarding against AppleEvent timeouts on large libraries. If all three attempts fail the error is logged and the script stops.

---

## Files

| File | Description |
|------|-------------|
| `photos-set-keywords.js` | Main JXA script (JavaScript for Automation) |
| `photos-set-keywords.applescript` | Original AppleScript (kept for reference) |
| `run.sh` | Shell wrapper — loads `.env` and runs the JXA script |
| `.env.template` | Configuration template — copy to `.env` and edit |
| `.env` | Your local configuration (not committed) |

---

## Setup

1. Copy the template and edit it:

```bash
cp .env.template .env
```

`.env` options:

```dotenv
# Folders are sorted by name. Processing starts with the first folder whose name
# is >= START_FOLDER (e.g. "2026" processes "2026", "2027", etc.).
# Leave empty to process all folders.
START_FOLDER=2026

# Process only this specific album. Leave empty to process all albums.
TARGET_ALBUM=

# Comma-separated folder names to skip entirely (in addition to "Smart").
# Example: SKIP_FOLDERS=Archive, Trash
SKIP_FOLDERS=

# Comma-separated album names to skip (in addition to SYS-* albums).
# Example: SKIP_ALBUMS=Duplicates, Temp
SKIP_ALBUMS=Duplicates

# Log verbosity: debug | info | warn | error
LOG_LEVEL=info
```

---

## Usage

**Normal run (uses `.env`):**

```bash
./run.sh
```

**Override values inline without editing `.env`:**

```bash
START_FOLDER=2025 ./run.sh
TARGET_ALBUM="2026 Rome Trip" LOG_LEVEL=debug ./run.sh
```

**Run the JXA script directly:**

```bash
START_FOLDER=2026 LOG_LEVEL=debug osascript -l JavaScript photos-set-keywords.js
```

