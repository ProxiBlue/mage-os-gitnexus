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

# Create workspace
RUN mkdir -p /workspace/.gitnexus /root/.gitnexus

# Download pre-built index from GitHub Release
# ARG allows overriding at build time: docker build --build-arg VERSION=2.3.0
ARG VERSION=2.3.0
ARG INDEX_URL=https://github.com/ProxiBlue/mage-os-gitnexus/releases/download/v${VERSION}/gitnexus-index.tar.gz
RUN apt-get update && apt-get install -y --no-install-recommends curl \
 && curl -fSL "${INDEX_URL}" -o /tmp/index.tar.gz \
 && tar xzf /tmp/index.tar.gz -C /workspace/.gitnexus/ \
 && rm /tmp/index.tar.gz \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Register the index in gitnexus registry
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
  fs.mkdirSync('/root/.gitnexus', {recursive: true}); \
  fs.writeFileSync('/root/.gitnexus/registry.json', JSON.stringify(registry)); \
"

WORKDIR /workspace

ENTRYPOINT ["gitnexus"]
CMD ["mcp"]
