# mage-os-gitnexus

Pre-built [GitNexus](https://github.com/abhigyanpatwari/GitNexus) knowledge graph for [Mage-OS](https://github.com/mage-os) (Magento 2 community fork). Ready-to-query MCP server via Docker — no 90-minute indexing required.

## What's included

- **189,396 nodes** | **489,068 edges** | **6,144 clusters** | **300 execution flows**
- Full `vendor/mage-os/` (388 packages) + `vendor/hyva-themes/` (10 packages)
- Class/interface/method graph with inheritance, calls, imports
- PHP scope-resolution with cross-file reference tracking

## Quick start

### Option 1: Docker (recommended)

Build the image locally:

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
      "args": ["run", "--rm", "-i", "mage-os-gitnexus:2.3.0", "gitnexus", "mcp"]
    }
  }
}
```

### Option 2: Download index directly

If you already have gitnexus installed and just want the pre-built database:

```bash
# Download the index (121MB compressed, 754MB extracted)
curl -fSL https://github.com/ProxiBlue/mage-os-gitnexus/releases/download/v2.3.0/gitnexus-index.tar.gz -o gitnexus-index.tar.gz

# Extract into your project's .gitnexus directory
mkdir -p .gitnexus
tar xzf gitnexus-index.tar.gz -C .gitnexus/

# Copy meta.json (grab from this repo or the release)
curl -fSL https://raw.githubusercontent.com/ProxiBlue/mage-os-gitnexus/main/index/meta.json -o .gitnexus/meta.json

# Register the index with gitnexus
gitnexus index .
```

Then query immediately:

```bash
gitnexus context Product
gitnexus impact ProductRepository --direction upstream
gitnexus query "checkout payment"
```

## What you can do

### Impact analysis

```
gitnexus_impact({target: "ProductRepository", direction: "upstream"})
```

Find everything that depends on a class before you change it.

### Code exploration

```
gitnexus_query({query: "checkout payment processing"})
```

Find execution flows related to a concept.

### Symbol context

```
gitnexus_context({name: "Product"})
```

See callers, callees, and execution flows for any symbol.

## Available versions

| Tag | Mage-OS version | Nodes | Edges |
|-----|-----------------|-------|-------|
| `2.3.0` | Mage-OS 2.3.0 | 189,396 | 489,068 |

## Building the index yourself

If you want to rebuild for a different Mage-OS version or with custom modules, see `scripts/build-index.sh`.

GitNexus currently requires patches for large PHP vendor trees:
- [PR #1800](https://github.com/abhigyanpatwari/GitNexus/pull/1800) — OOM in deferred-calls
- [PR #1801](https://github.com/abhigyanpatwari/GitNexus/pull/1801) — phtml scope extraction
- [PR #1808](https://github.com/abhigyanpatwari/GitNexus/pull/1808) — OOM in namespace-siblings

## License

MIT
