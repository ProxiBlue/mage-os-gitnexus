#!/bin/bash
# Pre-build a GitNexus index for a project mount.
#
# After this completes, <project-path>/.gitnexus/lbug exists on the host.
# A per-project DDEV gitnexus container reusing that path will see the
# cached lbug on startup and skip indexing — DDEV start stays fast.
#
# Runs in verbose mode (per-file logging, sequential workers) so when
# tree-sitter crashes on a specific file, the culprit can be identified.
# On crash, this script prints the failing file + the .gitnexusignore
# line to add + the retry command — no manual log spelunking needed.
#
# Usage:
#   scripts/build-mount.sh <project-path> <mount-name>
#
# Example:
#   scripts/build-mount.sh ~/workspace/uptactics/pvcpipesupplies pps
#   scripts/build-mount.sh ~/workspace/ittools/lcdscreen_mageos lcd

set -e

PROJECT_PATH="$1"
MOUNT_NAME="$2"

if [ -z "$PROJECT_PATH" ] || [ -z "$MOUNT_NAME" ]; then
  echo "Usage: $0 <project-path> <mount-name>" >&2
  echo "Example: $0 ~/workspace/uptactics/pvcpipesupplies pps" >&2
  exit 1
fi

PROJECT_PATH=$(realpath "$PROJECT_PATH" 2>/dev/null || echo "$PROJECT_PATH")

if [ ! -d "$PROJECT_PATH" ]; then
  echo "Error: project path '$PROJECT_PATH' is not a directory" >&2
  exit 1
fi

if ! docker image inspect mage-os-gitnexus:latest >/dev/null 2>&1; then
  echo "Error: mage-os-gitnexus:latest image not found locally." >&2
  echo "Build it first:" >&2
  echo "  cd $(dirname "$(realpath "$0")")/.. && docker compose build" >&2
  exit 1
fi

LOG=$(mktemp -t build-mount-XXXXXX.log)
trap "rm -f $LOG" EXIT

echo "[build-mount] Project: $PROJECT_PATH"
echo "[build-mount] Mount name: $MOUNT_NAME"
echo "[build-mount] Verbose mode — per-file logging enabled."
echo "[build-mount] Indexing — INDEX_ONLY=1 (container exits after build)..."
echo ""

docker run --rm \
  -e INDEX_ONLY=1 \
  -e VERBOSE=1 \
  -v "$PROJECT_PATH:/mounts/$MOUNT_NAME" \
  mage-os-gitnexus:latest \
  serve --host 0.0.0.0 2>&1 | tee "$LOG"

echo ""

if [ -f "$PROJECT_PATH/.gitnexus/lbug" ]; then
  SIZE=$(du -h "$PROJECT_PATH/.gitnexus/lbug" | cut -f1)
  echo "[build-mount] Done. Index at $PROJECT_PATH/.gitnexus/lbug ($SIZE)"
  exit 0
fi

# Failure path — locate the file that crashed the parser.
echo "[build-mount] FAILED — no lbug produced."
echo ""

CRASH_LINE=$(grep -nE "Napi::Error|terminate called|FATAL" "$LOG" | head -1 | cut -d: -f1)

if [ -n "$CRASH_LINE" ]; then
  # The last filepath-looking string in the log BEFORE the crash line
  # is almost always the culprit. Match common code-file extensions.
  CULPRIT=$(head -n "$CRASH_LINE" "$LOG" \
    | grep -oE "(/mounts/$MOUNT_NAME/[^[:space:]\"'\\\\]+|app/code/[^[:space:]\"'\\\\]+|vendor/[^[:space:]\"'\\\\]+)\.(php|phtml|js|jsx|ts|tsx|xml|css|html|json)" \
    | tail -1)

  if [ -n "$CULPRIT" ]; then
    REL_PATH=$(echo "$CULPRIT" | sed "s|^/mounts/$MOUNT_NAME/||")
    FILENAME=$(basename "$REL_PATH")
    DIRNAME=$(dirname "$REL_PATH")

    echo "==============================================================="
    echo "Tree-sitter crashed parsing:"
    echo "  $REL_PATH"
    echo ""
    echo "To exclude this exact file, append to:"
    echo "  $PROJECT_PATH/.gitnexusignore"
    echo "this line:"
    echo "  $REL_PATH"
    echo ""
    echo "Broader pattern (excludes any file with this name):"
    echo "  **/$FILENAME"
    echo ""
    echo "Or to exclude the whole directory:"
    echo "  $DIRNAME/"
    echo ""
    echo "One-liner — append exact file + retry:"
    echo "  echo '$REL_PATH' >> $PROJECT_PATH/.gitnexusignore && \\"
    echo "    rm -rf $PROJECT_PATH/.gitnexus && \\"
    echo "    $(realpath "$0") $PROJECT_PATH $MOUNT_NAME"
    echo "==============================================================="
  else
    echo "[build-mount] Napi::Error detected but couldn't auto-identify the culprit file."
    echo "Look at the last few \"Indexing\" or \"Parsing\" lines above for the file name,"
    echo "add it to $PROJECT_PATH/.gitnexusignore, then re-run."
  fi
else
  echo "[build-mount] No Napi::Error / terminate / FATAL in log."
  echo "Indexing failed for some other reason — review the log above."
fi

exit 1
