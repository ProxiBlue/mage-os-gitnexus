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

# Create directories
RUN mkdir -p /workspace/.gitnexus /root/.gitnexus /root/.gitnexus/groups/mageos-project /mounts

# Default .gitnexusignore for rebuild mode
COPY index/.gitnexusignore /workspace/.gitnexusignore

# Download pre-built Mage-OS index
ARG VERSION=2.3.0
ARG INDEX_URL=https://github.com/ProxiBlue/mage-os-gitnexus/releases/download/v${VERSION}/gitnexus-index.tar.gz
RUN curl -fSL "${INDEX_URL}" -o /tmp/index.tar.gz \
 && tar xzf /tmp/index.tar.gz -C /workspace/.gitnexus/ \
 && rm /tmp/index.tar.gz

# Register the pre-built index
COPY index/meta.json /workspace/.gitnexus/meta.json
RUN node -e " \
  const fs = require('fs'); \
  const meta = JSON.parse(fs.readFileSync('/workspace/.gitnexus/meta.json', 'utf-8')); \
  const registry = [{ \
    name: 'mageos', \
    path: '/workspace', \
    storagePath: '/workspace/.gitnexus', \
    indexedAt: meta.indexedAt, \
    lastCommit: meta.lastCommit, \
    stats: meta.stats \
  }]; \
  fs.writeFileSync('/root/.gitnexus/registry.json', JSON.stringify(registry)); \
"

COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /workspace

ENTRYPOINT ["/entrypoint.sh"]
CMD ["mcp"]
