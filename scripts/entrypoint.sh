#!/bin/bash
set -e

# ── Mode: rebuild ──────────────────────────────────────────────────────────
# Mount your full Mage-OS project at /project and set REBUILD=1 to run a
# full gitnexus analyze. The new index replaces the pre-built one.
#
# Usage:
#   docker run --rm -it \
#     -e REBUILD=1 \
#     -v /path/to/mageos/project:/project \
#     -v mageos-index:/output \
#     mage-os-gitnexus:2.3.0
#
# The index is written to /output/ (mount a volume to persist it).
# Use the .gitnexusignore from this repo in your project root.
#
# ── Mode: serve (default) ─────────────────────────────────────────────────
# Starts the MCP server with the pre-built index + any custom mounts.
#
# Mount custom code folders at /mounts/<name> — each becomes a separate
# index in the gitnexus group.
#
# Examples:
#   -v /path/to/app/code/MyVendor:/mounts/myvendor
#   -v /path/to/vendor/paypal/braintree:/mounts/braintree

GROUP_NAME="mageos-project"
MOUNTS_DIR="/mounts"

# ── Rebuild mode ───────────────────────────────────────────────────────────
if [ "${REBUILD:-0}" = "1" ]; then
  if [ ! -d "/project" ] || [ -z "$(ls -A /project 2>/dev/null)" ]; then
    echo "[mage-os-gitnexus] ERROR: REBUILD=1 but /project is empty."
    echo "  Mount your Mage-OS project: -v /path/to/project:/project"
    exit 1
  fi

  echo "[mage-os-gitnexus] Rebuild mode — full index of /project"
  cd /project

  # Copy .gitnexusignore if not present
  if [ ! -f ".gitnexusignore" ] && [ -f "/workspace/.gitnexusignore" ]; then
    cp /workspace/.gitnexusignore .gitnexusignore
    echo "  Copied default .gitnexusignore"
  fi

  echo "  Starting gitnexus analyze (this may take 60-90+ minutes)..."
  NODE_OPTIONS='--max-old-space-size=32768' gitnexus analyze --force \
    --skip-agents-md --skip-skills 2>&1

  # Copy index to /output if mounted
  if [ -d "/output" ]; then
    cp .gitnexus/lbug /output/lbug
    cp .gitnexus/meta.json /output/meta.json
    echo ""
    echo "  Index copied to /output/"
    echo "  Size: $(du -sh /output/lbug | cut -f1)"
  fi

  echo ""
  echo "[mage-os-gitnexus] Rebuild complete."
  echo "  Stats: $(gitnexus status 2>/dev/null | grep Stats || echo 'see meta.json')"

  # If no command args beyond default, exit after rebuild
  if [ "$1" = "mcp" ]; then
    echo "  To serve: remove REBUILD=1 and restart."
    exit 0
  fi

  exec gitnexus "$@"
  exit 0
fi

# ── Serve mode (default) ──────────────────────────────────────────────────

HAS_MOUNTS=false
MEMBER_COUNT=0

# Start with the pre-built Mage-OS index
gitnexus group create "$GROUP_NAME" --force 2>/dev/null || true
gitnexus group add "$GROUP_NAME" "core/mageos" mageos 2>/dev/null || true
MEMBER_COUNT=$((MEMBER_COUNT + 1))

# Process each mounted directory
if [ -d "$MOUNTS_DIR" ]; then
  for MOUNT_PATH in "$MOUNTS_DIR"/*/; do
    [ -d "$MOUNT_PATH" ] || continue

    MOUNT_NAME=$(basename "$MOUNT_PATH")
    INDEX_NAME="custom-${MOUNT_NAME}"

    echo "[mage-os-gitnexus] Found mount: $MOUNT_NAME"
    HAS_MOUNTS=true

    # Check for existing index
    if [ -f "${MOUNT_PATH}.gitnexus/lbug" ]; then
      echo "  Reusing existing index."
    else
      echo "  Indexing ${MOUNT_NAME}..."
      cd "$MOUNT_PATH"

      # Create a minimal git repo if needed (gitnexus requires one)
      if [ ! -d ".git" ]; then
        git init -q
        git add -A 2>/dev/null || true
        git commit -q -m "index" --allow-empty 2>/dev/null || true
      fi

      NODE_OPTIONS='--max-old-space-size=4096' gitnexus analyze \
        --skip-agents-md --skip-skills --index-only 2>&1 | tail -3
      cd /workspace
    fi

    # Register in gitnexus
    gitnexus index "$MOUNT_PATH" --name "$INDEX_NAME" 2>/dev/null || true

    # Add to group
    gitnexus group add "$GROUP_NAME" "custom/${MOUNT_NAME}" "$INDEX_NAME" 2>/dev/null || true
    MEMBER_COUNT=$((MEMBER_COUNT + 1))

    echo "  Registered as: custom/${MOUNT_NAME}"
  done
fi

if [ "$HAS_MOUNTS" = true ]; then
  echo ""
  echo "[mage-os-gitnexus] Ready. Group '$GROUP_NAME' has $MEMBER_COUNT members."
else
  echo "[mage-os-gitnexus] Serving Mage-OS index only."
  echo "  Mount code at /mounts/<name> to add custom indexes."
fi

echo ""

# Run the requested command (default: gitnexus mcp)
exec gitnexus "$@"
