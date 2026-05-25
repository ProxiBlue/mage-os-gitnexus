#!/bin/bash
set -e

# Mount custom code folders at /mounts/<name> — each becomes a separate
# index in the gitnexus group. The container handles all indexing internally,
# no gitnexus needed on the host.
#
# Examples:
#   -v /path/to/app/code/MyVendor:/mounts/myvendor
#   -v /path/to/vendor/paypal/braintree:/mounts/braintree
#   -v /path/to/app/design/frontend/MyTheme:/mounts/mytheme
#
# Each mount is indexed independently and linked via a gitnexus group
# for cross-index queries with the pre-built Mage-OS graph.

GROUP_NAME="mageos-project"
MOUNTS_DIR="/mounts"
HAS_MOUNTS=false
MEMBER_COUNT=0

# Always start with the pre-built Mage-OS index in the group
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
  echo "[mage-os-gitnexus] Cross-index queries available via MCP."
else
  echo "[mage-os-gitnexus] No custom mounts found. Serving Mage-OS index only."
  echo ""
  echo "  Mount your code folders to add them to the graph:"
  echo "    -v /path/to/app/code/MyVendor:/mounts/myvendor"
  echo "    -v /path/to/vendor/paypal/braintree:/mounts/braintree"
  echo "    -v /path/to/app/design/frontend/MyTheme:/mounts/mytheme"
fi

echo ""

# Run the requested command (default: gitnexus mcp)
exec gitnexus "$@"
