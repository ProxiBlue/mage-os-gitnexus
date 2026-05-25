FROM node:22-slim

# Install gitnexus globally (--ignore-scripts to avoid onnxruntime GPU download)
RUN npm install -g --ignore-scripts gitnexus@1.6.5 \
 && node /usr/local/lib/node_modules/gitnexus/node_modules/@ladybugdb/core/install.js

# Apply phtml scope extraction patches (upstream #1752, PR #1801)
RUN sed -i 's/if (scopeDrafts.length === 0 && matchCount === 0) {/{/' \
    /usr/local/lib/node_modules/gitnexus/dist/core/ingestion/scope-extractor.js \
 && sed -i '/throw new Error.*ScopeExtractor: no Module scope found/d' \
    /usr/local/lib/node_modules/gitnexus/dist/core/ingestion/scope-extractor.js \
 && sed -i '/Provider must emit at least one @scope.module capture per file/d' \
    /usr/local/lib/node_modules/gitnexus/dist/core/ingestion/scope-extractor.js

# Apply OOM fixes for large PHP vendor trees (upstream #1741, PR #1800)
COPY patches/fix-oom.js /tmp/fix-oom.js
RUN node /tmp/fix-oom.js && rm /tmp/fix-oom.js

# Create directories
RUN mkdir -p /workspace/.gitnexus /client /root/.gitnexus /root/.gitnexus/groups/mageos-project

# Default .gitnexusignore for rebuild mode
COPY index/.gitnexusignore /workspace/.gitnexusignore

# Download pre-built Mage-OS index
ARG VERSION=2.3.0
ARG INDEX_URL=https://github.com/ProxiBlue/mage-os-gitnexus/releases/download/v${VERSION}/gitnexus-index.tar.gz
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates git \
 && curl -fSL "${INDEX_URL}" -o /tmp/index.tar.gz \
 && tar xzf /tmp/index.tar.gz -C /workspace/.gitnexus/ \
 && rm /tmp/index.tar.gz \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

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

# Entrypoint script handles optional client code mounting + indexing
COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /workspace

ENTRYPOINT ["/entrypoint.sh"]
CMD ["mcp"]
