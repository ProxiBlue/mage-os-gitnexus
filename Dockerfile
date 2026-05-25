FROM node:22-slim

# GitNexus version — override at build time:
#   docker build --build-arg GITNEXUS_VERSION=1.6.6-rc.55 .
ARG GITNEXUS_VERSION=1.6.6-rc.55

# Install gitnexus + build tools for tree-sitter native bindings
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates git build-essential python3 \
 && npm install -g --ignore-scripts gitnexus@${GITNEXUS_VERSION} \
 && node /usr/local/lib/node_modules/gitnexus/node_modules/@ladybugdb/core/install.js \
 && cd /usr/local/lib/node_modules/gitnexus/node_modules/tree-sitter-kotlin \
 && npx --yes node-gyp rebuild 2>/dev/null || true \
 && cd /usr/local/lib/node_modules/gitnexus/node_modules/tree-sitter \
 && npx --yes node-gyp rebuild 2>/dev/null || true \
 && apt-get purge -y build-essential python3 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

# Layout:
#   /workspace/                       — user code mount (default; override with PROJECT_ROOT)
#   /indexes/mageos/.gitnexus/lbug   — pre-built Mage-OS index
#   /indexes/hyva/.gitnexus/lbug     — pre-built Hyvä index (optional)
#   /mounts/                          — per-folder custom code indexes (serve mode)
RUN mkdir -p /workspace \
             /indexes/mageos/.gitnexus \
             /indexes/hyva/.gitnexus \
             /indexes/deps/.gitnexus \
             /root/.gitnexus /root/.gitnexus/groups/mageos-project \
             /mounts

# .gitnexusignore variants for rebuild mode (TARGET=mageos|hyva|deps|all)
COPY index/.gitnexusignore /workspace/.gitnexusignore
COPY index/.gitnexusignore.mageos /workspace/.gitnexusignore.mageos
COPY index/.gitnexusignore.hyva /workspace/.gitnexusignore.hyva
COPY index/.gitnexusignore.deps /workspace/.gitnexusignore.deps

# ── Index versions ────────────────────────────────────────────────────────
# Image is decoupled from content. Pick which Mage-OS, Hyvä, and Magento
# runtime-deps indexes to bundle:
#   docker build \
#     --build-arg MAGEOS_VERSION=2.3.0 \
#     --build-arg HYVA_VERSION=1.4.6 \
#     --build-arg INCLUDE_DEPS=1 \
#     -t mage-os-gitnexus:my-tag .
#
# Set HYVA_VERSION=none to skip the Hyvä index.
# Set INCLUDE_DEPS=0 to skip the Magento runtime-deps index.
#
# Runtime-deps versions are pinned to the Mage-OS version they were built
# against (since composer.lock pins different laminas/symfony/etc per Mage-OS
# release). We always pair deps-${MAGEOS_VERSION} — no separate version arg.
#
# Each archive is published under a GitHub release tagged `<target>-<version>`
# (e.g. `mageos-2.3.0`, `hyva-1.4.6`, `deps-2.3.0`) and contains lbug + meta.json
# at the root.
ARG MAGEOS_VERSION=2.3.0
ARG HYVA_VERSION=1.4.6
ARG INCLUDE_DEPS=1
ARG INDEX_URL_MAGEOS=https://github.com/ProxiBlue/mage-os-gitnexus/releases/download/mageos-${MAGEOS_VERSION}/gitnexus-index.tar.gz
ARG INDEX_URL_HYVA=https://github.com/ProxiBlue/mage-os-gitnexus/releases/download/hyva-${HYVA_VERSION}/gitnexus-index.tar.gz
ARG INDEX_URL_DEPS=https://github.com/ProxiBlue/mage-os-gitnexus/releases/download/deps-${MAGEOS_VERSION}/gitnexus-index.tar.gz

RUN curl -fSL "${INDEX_URL_MAGEOS}" -o /tmp/mageos.tar.gz \
 && tar xzf /tmp/mageos.tar.gz -C /indexes/mageos/.gitnexus/ \
 && rm /tmp/mageos.tar.gz

RUN if [ "${HYVA_VERSION}" = "none" ]; then \
      echo "[mage-os-gitnexus] HYVA_VERSION=none — skipping Hyvä index"; \
      rm -rf /indexes/hyva; \
    else \
      curl -fSL "${INDEX_URL_HYVA}" -o /tmp/hyva.tar.gz \
      && tar xzf /tmp/hyva.tar.gz -C /indexes/hyva/.gitnexus/ \
      && rm /tmp/hyva.tar.gz; \
    fi

RUN if [ "${INCLUDE_DEPS}" != "1" ]; then \
      echo "[mage-os-gitnexus] INCLUDE_DEPS=${INCLUDE_DEPS} — skipping runtime-deps index"; \
      rm -rf /indexes/deps; \
    else \
      curl -fSL "${INDEX_URL_DEPS}" -o /tmp/deps.tar.gz \
      && tar xzf /tmp/deps.tar.gz -C /indexes/deps/.gitnexus/ \
      && rm /tmp/deps.tar.gz; \
    fi

# Register present indexes. All point at the same repo root (PROJECT_ROOT,
# overridable at runtime). Paths in each graph are stored relative.
RUN node -e " \
  const fs = require('fs'); \
  const entry = name => { \
    const meta = JSON.parse(fs.readFileSync('/indexes/' + name + '/.gitnexus/meta.json', 'utf-8')); \
    return { \
      name, \
      path: '/workspace', \
      storagePath: '/indexes/' + name + '/.gitnexus', \
      indexedAt: meta.indexedAt, \
      lastCommit: meta.lastCommit, \
      stats: meta.stats \
    }; \
  }; \
  const reg = []; \
  for (const name of ['mageos', 'hyva', 'deps']) { \
    if (fs.existsSync('/indexes/' + name + '/.gitnexus/meta.json')) reg.push(entry(name)); \
  } \
  fs.writeFileSync('/root/.gitnexus/registry.json', JSON.stringify(reg)); \
"

COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /workspace

ENTRYPOINT ["/entrypoint.sh"]
CMD ["mcp"]
