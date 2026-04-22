#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
JS_SCRIPT="$SCRIPT_DIR/photos-set-keywords.js"

# Load .env if it exists
if [[ -f "$ENV_FILE" ]]; then
  # Export each non-comment, non-empty line
  set -o allexport
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +o allexport
fi

export START_FOLDER="${START_FOLDER:-}"
export TARGET_ALBUM="${TARGET_ALBUM:-}"
export LOG_LEVEL="${LOG_LEVEL:-info}"

echo "[run.sh] START_FOLDER=\"$START_FOLDER\"  TARGET_ALBUM=\"$TARGET_ALBUM\"  LOG_LEVEL=\"$LOG_LEVEL\""

osascript -l JavaScript "$JS_SCRIPT"
