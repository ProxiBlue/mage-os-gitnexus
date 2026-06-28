#!/bin/bash
set -e

# Keep stdout clean for the eventual `exec gitnexus "$@"`. MCP mode uses
# stdout for JSON-RPC; any setup chatter on stdout breaks the protocol on
# strict clients. Save original stdout on fd 3, route everything else to
# stderr, then restore stdout just before exec'ing gitnexus.
exec 3>&1 1>&2

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

  # TARGET: which vendor subtree(s) to index. Default = mageos (most users).
  #   mageos — vendor/mage-os/
  #   hyva   — vendor/hyva-themes/
  #   deps   — Magento's runtime PHP deps (laminas, symfony, monolog, etc.) — must match the Mage-OS version
  #   all    — all of the above
  TARGET="${TARGET:-mageos}"
  case "$TARGET" in
    mageos|hyva|deps) TARGETS="$TARGET" ;;
    all) TARGETS="mageos hyva deps" ;;
    *)
      echo "[mage-os-gitnexus] ERROR: TARGET must be 'mageos', 'hyva', 'deps', or 'all' (got '$TARGET')"
      exit 1
      ;;
  esac

  cd /project

  # Allow git to operate on the mounted host directory (UID mismatch)
  git config --global --add safe.directory /project

  # Tunable parameters via environment variables
  HEAP_SIZE="${GITNEXUS_HEAP_SIZE:-32768}"
  WORKERS="${GITNEXUS_WORKERS:-}"
  WORKER_TIMEOUT="${GITNEXUS_WORKER_TIMEOUT:-60}"
  MAX_FILE_SIZE="${GITNEXUS_MAX_FILE_SIZE:-512}"
  SUB_BATCH_BYTES="${GITNEXUS_SUB_BATCH_BYTES:-16777216}"

  ANALYZE_ARGS="--force --skip-agents-md --skip-skills --worker-timeout $WORKER_TIMEOUT --max-file-size $MAX_FILE_SIZE"
  [ -n "$WORKERS" ] && ANALYZE_ARGS="$ANALYZE_ARGS --workers $WORKERS"
  [ "${GITNEXUS_VERBOSE:-0}" = "1" ] && ANALYZE_ARGS="$ANALYZE_ARGS --verbose"

  echo "[mage-os-gitnexus] Rebuild mode"
  echo "  Targets: $TARGETS"
  echo "  Config:"
  echo "    Heap:            ${HEAP_SIZE}MB"
  echo "    Workers:         ${WORKERS:-auto}"
  echo "    Worker timeout:  ${WORKER_TIMEOUT}s"
  echo "    Max file size:   ${MAX_FILE_SIZE}KB"
  echo "    Sub-batch bytes: ${SUB_BATCH_BYTES}"

  for T in $TARGETS; do
    IGNORE_FILE="/workspace/.gitnexusignore.$T"
    if [ ! -f "$IGNORE_FILE" ]; then
      echo "[mage-os-gitnexus] ERROR: missing $IGNORE_FILE"
      exit 1
    fi

    echo ""
    echo "[mage-os-gitnexus] ─── Target: $T ───"
    cp "$IGNORE_FILE" /project/.gitnexusignore

    # Fresh index per target — gitnexus writes to /project/.gitnexus/
    rm -rf /project/.gitnexus
    echo "  Starting gitnexus analyze for $T (this may take a while)..."

    NODE_OPTIONS="--max-old-space-size=${HEAP_SIZE}" \
    GITNEXUS_WORKER_SUB_BATCH_MAX_BYTES="$SUB_BATCH_BYTES" \
    gitnexus analyze $ANALYZE_ARGS 2>&1

    # XML augmentation — parse Magento's di.xml / events / layout / webapi /
    # routes and inject the corresponding edges into the lbug. Best-effort:
    # any failure logs a warning and does NOT block the rebuild. The base
    # PHP graph from `gitnexus analyze` is the load-bearing artifact;
    # XML augmentation is additive value on top.
    # Skip with `-e AUGMENT=0` or for targets where there's no Magento XML
    # to find (deps = pure framework libs, no Magento configs).
    if [ "${AUGMENT:-1}" = "1" ] && [ "$T" != "deps" ] && [ -f /project/vendor/composer/autoload_psr4.php ]; then
      echo "  Augmenting with XML-derived edges..."
      node /augmenter/dist/cli.js augment /project 2>&1 | tail -20 || \
        echo "  [augment] warning: augmentation failed (non-fatal)"
    elif [ "$T" = "deps" ]; then
      echo "  Skipping XML augmentation (TARGET=deps has no Magento configs)."
    elif [ "${AUGMENT:-1}" != "1" ]; then
      echo "  Skipping XML augmentation (AUGMENT=$AUGMENT)."
    fi

    if [ -d "/output" ]; then
      mkdir -p "/output/$T"
      cp /project/.gitnexus/lbug "/output/$T/lbug"
      cp /project/.gitnexus/meta.json "/output/$T/meta.json"
      echo "  Index copied to /output/$T/"
      echo "  Size: $(du -sh /output/$T/lbug | cut -f1)"
    fi
  done

  echo ""
  echo "[mage-os-gitnexus] Rebuild complete for: $TARGETS"

  if [ "$1" = "mcp" ]; then
    echo "  To serve: remove REBUILD=1 and restart."
    exit 0
  fi

  # Restore stdout for the actual gitnexus command
  exec 1>&3 3>&-
  exec gitnexus "$@"
  exit 0
fi

# ── Serve mode (default) ──────────────────────────────────────────────────

# PROJECT_ROOT lets consumers point gitnexus at the path where their Mage-OS
# code actually lives (DDEV: /var/www/html, Docker: /workspace, etc.). The
# index stores relative paths, so this only affects fs.readFile() calls from
# MCP tools — graph queries work regardless.
PROJECT_ROOT="${PROJECT_ROOT:-/workspace}"
if [ "$PROJECT_ROOT" != "/workspace" ]; then
  node -e "
    const fs = require('fs');
    const reg = JSON.parse(fs.readFileSync('/root/.gitnexus/registry.json', 'utf-8'));
    for (const e of reg) e.path = '${PROJECT_ROOT}';
    fs.writeFileSync('/root/.gitnexus/registry.json', JSON.stringify(reg));
  "
  echo "[mage-os-gitnexus] Registry path: $PROJECT_ROOT (applied to all entries)"
fi

HAS_MOUNTS=false
MEMBER_COUNT=0

# Group all pre-built indexes (mage-os core + Hyvä themes + runtime deps).
# Any combination may be present depending on Dockerfile build args.
gitnexus group create "$GROUP_NAME" --force 2>/dev/null || true
for IDX in mageos hyva deps; do
  if [ -f "/indexes/$IDX/.gitnexus/lbug" ]; then
    gitnexus group add "$GROUP_NAME" "core/$IDX" "$IDX" 2>/dev/null || true
    MEMBER_COUNT=$((MEMBER_COUNT + 1))
  fi
done

# Process each mounted directory
if [ -d "$MOUNTS_DIR" ]; then
  for MOUNT_PATH in "$MOUNTS_DIR"/*/; do
    [ -d "$MOUNT_PATH" ] || continue

    MOUNT_NAME=$(basename "$MOUNT_PATH")
    # gitnexus `index` auto-assigns the registry alias from the basename of
    # the path (`/mounts/pps` → `pps`). Match that here so the `group add`
    # below references an alias that actually exists.
    INDEX_NAME="${MOUNT_NAME}"

    echo "[mage-os-gitnexus] Found mount: $MOUNT_NAME"
    HAS_MOUNTS=true

    # Allow git to operate on host-owned directories (UID mismatch).
    # Strip trailing slash — MOUNT_PATH comes from /mounts/*/ glob which
    # preserves it, but git's safe.directory matcher rejects the slashed form.
    # MUST run regardless of indexing-vs-reusing — the register step below
    # also calls git, and without this it reports "not a git repository".
    git config --global --add safe.directory "${MOUNT_PATH%/}"

    # Check for existing index
    if [ -f "${MOUNT_PATH}.gitnexus/lbug" ]; then
      echo "  Reusing existing index."
    else
      echo "  Indexing ${MOUNT_NAME}..."
      cd "$MOUNT_PATH"

      # Create a minimal git repo if needed (gitnexus requires one).
      # If the mount is read-only (e.g. vendor mounted :ro to protect from
      # accidental writes), git init will fail. Detect that and skip — the
      # `--allow-non-git` flag passed to `gitnexus index` below covers the
      # non-git case, but the analyze step also needs to write .gitnexus/
      # cache. If the mount is read-only we cannot index it in-place at all
      # and we surface a clear error so the operator switches to a writable
      # mount (drop the :ro in docker-compose) — vendor dirs are typically
      # gitignored so the .git/.gitnexus artifacts are throwaway.
      if [ ! -d ".git" ]; then
        if ! git init -q 2>/dev/null; then
          echo "  ERROR: mount ${MOUNT_NAME} is read-only — cannot init git scratchspace."
          echo "  Fix: drop ':ro' from the volume in docker-compose.gitnexus.yaml so gitnexus"
          echo "       can write .git/ and .gitnexus/ inside the mount. Vendor dirs are"
          echo "       typically gitignored so these artifacts are harmless."
          echo "  Skipping ${MOUNT_NAME}."
          cd /workspace
          continue
        fi
        git add -A 2>/dev/null || true
        git commit -q -m "index" --allow-empty 2>/dev/null || true
      fi

      # VERBOSE=1 enables per-file logging (`-v`) and removes the output
      # truncation. Use when diagnosing tree-sitter / parser crashes — the
      # last logged filename before a Napi::Error is your culprit.
      # Also force sequential parsing (workers=0) so log ordering matches
      # file processing order; interleaved parallel logs are hard to read.
      if [ "${VERBOSE:-0}" = "1" ]; then
        NODE_OPTIONS='--max-old-space-size=4096' gitnexus analyze \
          --skip-agents-md --skip-skills --index-only -v --workers 0 2>&1
      else
        NODE_OPTIONS='--max-old-space-size=4096' gitnexus analyze \
          --skip-agents-md --skip-skills --index-only 2>&1 | tail -3
      fi

      # XML augmentation for mounts that look like a full Magento project
      # (have their own vendor/composer/autoload_psr4.php). Scoped to this
      # mount's lbug; cross-mount references to the pre-built mageos lbug
      # cannot be linked (ladybugdb's COPY is per-database — that's the
      # split-index trade-off documented in the README).
      # Skip with -e AUGMENT=0.
      if [ "${AUGMENT:-1}" = "1" ] && [ -f "${MOUNT_PATH}vendor/composer/autoload_psr4.php" ]; then
        echo "  Augmenting ${MOUNT_NAME} with XML-derived edges..."
        node /augmenter/dist/cli.js augment "$MOUNT_PATH" 2>&1 | tail -10 || \
          echo "  [augment] warning: augmentation failed for ${MOUNT_NAME} (non-fatal)"
      fi

      cd /workspace
    fi

    # Register in gitnexus's global registry — IDEMPOTENTLY. Every container
    # start re-runs this loop; `gitnexus index` is NOT idempotent — it appends
    # a new registry entry on each call rather than updating in-place. Without
    # the existence check below, the registry grows duplicates across restarts
    # (multiple entries with the same name but different `path` fields, all
    # pointing at the same storage path), which breaks group resolution.
    #
    # --allow-non-git covers host-bind-mount edge cases where `.git` exists
    # but git fails to detect the repo before safe.directory takes effect.
    # `--name` was removed from `gitnexus index` in current versions, so
    # gitnexus auto-assigns the alias:
    #   - for git repos: the git remote name (e.g. "m2_pvcpipesupplies")
    #   - for non-git folders: the path basename (e.g. "pps")
    REGISTRY_FILE=/root/.gitnexus/registry.json
    if [ -f "$REGISTRY_FILE" ] && grep -qF "\"path\": \"${MOUNT_PATH%/}\"" "$REGISTRY_FILE"; then
      echo "  Already registered (skipping re-register to keep registry clean)."
    else
      if ! gitnexus index "$MOUNT_PATH" --allow-non-git 2>&1; then
        echo "  WARNING: gitnexus index failed for ${MOUNT_NAME} — see error above"
      fi
    fi

    # Look up the actual registered alias via `gitnexus list` — the only
    # reliable source. The "Repository registered: NAME" line in `gitnexus
    # index` output LIES on re-registration (reports the basename even
    # when the registry has it under a different name). We need the real
    # alias to pass to `gitnexus group add`, or the group entry references
    # a non-existent repo and queries silently miss it.
    ACTUAL_NAME=$(gitnexus list 2>/dev/null | \
      awk -v p="${MOUNT_PATH%/}" '/^  [^ ]/ {n=$1} $1=="Path:" && $2==p {print n; exit}')
    if [ -z "$ACTUAL_NAME" ]; then
      echo "  WARNING: could not determine registered alias for ${MOUNT_PATH%/} — falling back to ${MOUNT_NAME}"
      ACTUAL_NAME="${MOUNT_NAME}"
    fi

    # Add to group with the ACTUAL registered alias (not the mount basename)
    gitnexus group add "$GROUP_NAME" "custom/${MOUNT_NAME}" "$ACTUAL_NAME" 2>&1 || \
      echo "  WARNING: gitnexus group add failed for custom/${MOUNT_NAME} -> ${ACTUAL_NAME}"
    MEMBER_COUNT=$((MEMBER_COUNT + 1))

    if [ "$ACTUAL_NAME" = "$MOUNT_NAME" ]; then
      echo "  Registered as: custom/${MOUNT_NAME} (alias: ${ACTUAL_NAME})"
    else
      # Surfaces the case where the git remote name differs from the mount
      # basename — users querying with `repo:` need the actual alias.
      echo "  Registered as: custom/${MOUNT_NAME} (alias: ${ACTUAL_NAME} — derived from git remote, not mount basename)"
    fi
  done
fi

# Note: `gitnexus group sync` is NOT run at startup. It builds a contract
# bridge db that mostly bridges HTTP routes — for our PHP monolith use case
# it doesn't help with shared-library call resolution (see README's "What
# groups give you" section), and it adds 30-60s of startup latency on the
# three combined indexes. If you want it, attach with:
#
#   docker exec -it <container> gitnexus group sync mageos-project --skip-embeddings --allow-stale

if [ "$HAS_MOUNTS" = true ]; then
  echo ""
  echo "[mage-os-gitnexus] Ready. Group '$GROUP_NAME' has $MEMBER_COUNT members."
else
  echo "[mage-os-gitnexus] Serving pre-built indexes only ($MEMBER_COUNT members)."
  echo "  Mount code at /mounts/<name> to add custom indexes."
fi

echo ""

# Pre-build / one-shot mode. Used by scripts/build-mount.sh to produce the
# per-mount .gitnexus/lbug on the host without starting a long-running MCP
# server. Once the lbug exists in the mount, subsequent containers (e.g.
# per-project DDEV gitnexus services) see it on startup and skip indexing.
if [ "${INDEX_ONLY:-0}" = "1" ]; then
  echo "[mage-os-gitnexus] INDEX_ONLY=1 — exiting after build (skipping serve)."
  exit 0
fi

# Restore stdout (fd 3 holds the original) so gitnexus mcp can speak
# JSON-RPC cleanly without our setup chatter polluting the protocol.
exec 1>&3 3>&-

# Run the requested command (default: gitnexus mcp)
exec gitnexus "$@"
