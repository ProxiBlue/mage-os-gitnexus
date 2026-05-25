# mage-os-gitnexus

Pre-built [GitNexus](https://github.com/abhigyanpatwari/GitNexus) knowledge graph for [Mage-OS](https://github.com/mage-os) (Magento 2 community fork). Ready-to-query MCP server via Docker — no 90-minute indexing required.

## What's included

- **189,396 nodes** | **489,068 edges** | **6,144 clusters** | **300 execution flows**
- Full `vendor/mage-os/` (388 packages) + `vendor/hyva-themes/` (10 packages)
- Class/interface/method graph with inheritance, calls, imports
- PHP scope-resolution with cross-file reference tracking

## Quick start — Mage-OS only

Build the image and query immediately:

```bash
git clone https://github.com/ProxiBlue/mage-os-gitnexus.git
cd mage-os-gitnexus
docker build -t mage-os-gitnexus:2.3.0 .
```

Add to your `.mcp.json` (Claude Code, Cursor, or any MCP client):

```json
{
  "mcpServers": {
    "gitnexus-mageos": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "mage-os-gitnexus:2.3.0"]
    }
  }
}
```

## With your own project code

Mount your project at `/client` to index your custom modules, themes, and third-party packages (Braintree, Stripe, etc.) alongside the pre-built Mage-OS graph:

```json
{
  "mcpServers": {
    "gitnexus-mageos": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-v", "/path/to/your/magento/project:/client",
        "mage-os-gitnexus:2.3.0"
      ]
    }
  }
}
```

On first run, the container:
1. Detects your code at `/client`
2. Indexes it with gitnexus (your custom modules, app/code/, extra vendor packages)
3. Creates a **group** linking both indexes for cross-index queries
4. Starts the MCP server with both indexes available

Subsequent runs reuse the existing index (stored in `/client/.gitnexus/`).

### Persistent index (recommended)

To avoid re-indexing on every container start, ensure `/client/.gitnexus/` persists. If you mount your full project directory, it does automatically — the index is written inside your project's `.gitnexus/` folder.

### What gets indexed from your project

Everything not excluded by `.gitignore` — typically:
- `app/code/` — your custom modules
- `app/design/` — your themes
- Third-party modules in `vendor/` not covered by the pre-built index (Braintree, Stripe, Mollie, etc.)

The pre-built Mage-OS index already covers `vendor/mage-os/` and `vendor/hyva-themes/`, so those won't be re-indexed.

## What you can do

Ask your AI assistant natural language questions. It translates them to GitNexus queries automatically:

> "Show me all relations for braintree payments"
> "What depends on the ProductRepository?"
> "How does checkout payment processing work?"
> "What breaks if I change the Quote model?"

### Or query directly

```bash
# Impact analysis
docker run --rm -i mage-os-gitnexus:2.3.0 impact ProductRepository --direction upstream

# Code exploration
docker run --rm -i mage-os-gitnexus:2.3.0 query "checkout payment processing"

# Symbol context
docker run --rm -i mage-os-gitnexus:2.3.0 context Product

# Cross-index query (when client code is mounted)
docker run --rm -i -v /path/to/project:/client mage-os-gitnexus:2.3.0 group query mageos-project "braintree payment"
```

## How it works

```
┌─────────────────────────────────────────────┐
│  Docker container                           │
│                                             │
│  /workspace/.gitnexus/lbug                  │
│    └─ Pre-built Mage-OS index (189K nodes)  │
│       vendor/mage-os/ + vendor/hyva-themes/ │
│                                             │
│  /client/ (mounted from host)               │
│    └─ .gitnexus/lbug                        │
│       Your app/code/, extra vendor/, themes  │
│                                             │
│  GitNexus Group: mageos-project             │
│    ├─ core/mageos → /workspace              │
│    └─ project/client → /client              │
│                                             │
│  gitnexus mcp (serves both via MCP)         │
└─────────────────────────────────────────────┘
```

The GitNexus `group` feature links both indexes, enabling cross-index impact analysis. When you change a class in your custom module that extends a Mage-OS core class, impact analysis traces through both indexes.

## Download index directly (no Docker)

If you already have gitnexus installed:

```bash
# Download the index (121MB compressed, 754MB extracted)
curl -fSL https://github.com/ProxiBlue/mage-os-gitnexus/releases/download/v2.3.0/gitnexus-index.tar.gz \
  -o gitnexus-index.tar.gz

# Extract into your project
mkdir -p .gitnexus
tar xzf gitnexus-index.tar.gz -C .gitnexus/
curl -fSL https://raw.githubusercontent.com/ProxiBlue/mage-os-gitnexus/main/index/meta.json \
  -o .gitnexus/meta.json

# Register and query
gitnexus index .
gitnexus context Product
```

## Available versions

| Tag | Mage-OS version | Nodes | Edges |
|-----|-----------------|-------|-------|
| `2.3.0` | Mage-OS 2.3.0 | 189,396 | 489,068 |

## Building the index yourself

If you want to rebuild for a different Mage-OS version, see `scripts/build-index.sh`.

GitNexus currently requires patches for large PHP vendor trees:
- [PR #1800](https://github.com/abhigyanpatwari/GitNexus/pull/1800) — OOM in deferred-calls
- [PR #1801](https://github.com/abhigyanpatwari/GitNexus/pull/1801) — phtml scope extraction
- [PR #1808](https://github.com/abhigyanpatwari/GitNexus/pull/1808) — OOM in namespace-siblings

These patches are applied automatically in the Docker image.

## License

MIT
