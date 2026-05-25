#!/bin/bash
set -e

# If client code is mounted at /client, index it and create a group
if [ -d "/client" ] && [ "$(ls -A /client 2>/dev/null)" ]; then
  # Check if client index already exists (persistent volume)
  if [ ! -f "/client/.gitnexus/lbug" ]; then
    echo "[mage-os-gitnexus] Client code detected at /client — indexing..."
    cd /client
    NODE_OPTIONS='--max-old-space-size=16384' gitnexus analyze --skip-agents-md --skip-skills 2>&1 | tail -5
    cd /workspace
  else
    echo "[mage-os-gitnexus] Client index found at /client/.gitnexus/lbug — reusing."
    # Register the existing index
    gitnexus index /client 2>/dev/null || true
  fi

  # Register client in the registry if not already there
  REGISTRY="/root/.gitnexus/registry.json"
  if ! grep -q '"client"' "$REGISTRY" 2>/dev/null; then
    echo "[mage-os-gitnexus] Registering client index..."
    gitnexus index /client --name client 2>/dev/null || true
  fi

  # Create group linking both indexes
  if [ ! -f "/root/.gitnexus/groups/mageos-project/group.yaml" ]; then
    echo "[mage-os-gitnexus] Creating group: mageos-project (mageos + client)"
    gitnexus group create mageos-project --force 2>/dev/null
    gitnexus group add mageos-project "core/mageos" mageos 2>/dev/null
    gitnexus group add mageos-project "project/client" client 2>/dev/null
  fi

  echo "[mage-os-gitnexus] Ready. Mage-OS + client indexes linked."
  echo "[mage-os-gitnexus] Use 'gitnexus group query mageos-project \"your query\"' for cross-index search."
else
  echo "[mage-os-gitnexus] No client code mounted. Serving Mage-OS index only."
  echo "[mage-os-gitnexus] Mount your code at /client to enable cross-index analysis:"
  echo "  docker run -v /path/to/your/project:/client ..."
fi

# Run the requested command (default: gitnexus mcp)
exec gitnexus "$@"
