# mage-os-gitnexus

Pre-built [GitNexus](https://github.com/abhigyanpatwari/GitNexus) knowledge graph for [Mage-OS](https://github.com/mage-os) (Magento 2 community fork). Ready-to-query MCP server via Docker — no 90-minute indexing required. No gitnexus installation needed on your machine.

## What's included

- **189,396 nodes** | **489,068 edges** | **6,144 clusters** | **300 execution flows**
- Full `vendor/mage-os/` (388 packages) + `vendor/hyva-themes/` (10 packages)
- Class/interface/method graph with inheritance, calls, imports
- PHP scope-resolution with cross-file reference tracking

## Quick start — Mage-OS only

```bash
git clone https://github.com/ProxiBlue/mage-os-gitnexus.git
cd mage-os-gitnexus
docker build -t mage-os-gitnexus:2.3.0 .
```

Add to `.mcp.json` (Claude Code, Cursor, or any MCP client):

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

## Adding your own code

Mount any number of code folders at `/mounts/<name>`. Each becomes a separate index, automatically linked with the Mage-OS graph for cross-index queries. **No gitnexus needed on your host** — the container handles all indexing.

### Examples

**Single custom module:**

```json
{
  "mcpServers": {
    "gitnexus-mageos": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-v", "/path/to/app/code/MyVendor:/mounts/myvendor",
        "mage-os-gitnexus:2.3.0"
      ]
    }
  }
}
```

**Multiple mounts — custom modules + third-party packages + theme:**

```json
{
  "mcpServers": {
    "gitnexus-mageos": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-v", "/path/to/app/code/MyVendor:/mounts/myvendor",
        "-v", "/path/to/vendor/paypal/module-braintree:/mounts/braintree",
        "-v", "/path/to/vendor/stripe/module-payments:/mounts/stripe",
        "-v", "/path/to/app/design/frontend/MyTheme:/mounts/mytheme",
        "mage-os-gitnexus:2.3.0"
      ]
    }
  }
}
```

### How it works

On startup, the container:

1. Scans `/mounts/` for mounted directories
2. Indexes each one independently (first run only — cached in `<mount>/.gitnexus/`)
3. Creates a GitNexus **group** linking all indexes together
4. Starts the MCP server with everything queryable

```
┌──────────────────────────────────────────────┐
│  Docker container                            │
│                                              │
│  /workspace/.gitnexus/lbug (pre-built)       │
│    └─ Mage-OS core: 189K nodes              │
│                                              │
│  /mounts/myvendor/.gitnexus/lbug (indexed)   │
│    └─ Your custom modules                    │
│                                              │
│  /mounts/braintree/.gitnexus/lbug (indexed)  │
│    └─ PayPal Braintree                       │
│                                              │
│  /mounts/mytheme/.gitnexus/lbug (indexed)    │
│    └─ Your theme                             │
│                                              │
│  Group: mageos-project                       │
│    ├─ core/mageos    → /workspace            │
│    ├─ custom/myvendor → /mounts/myvendor     │
│    ├─ custom/braintree → /mounts/braintree   │
│    └─ custom/mytheme  → /mounts/mytheme      │
│                                              │
│  gitnexus mcp (serves all via MCP)           │
└──────────────────────────────────────────────┘
```

### Persistent indexes

Indexes are written inside each mount at `<mount>/.gitnexus/`. Since the mount points to your host filesystem, the index persists between container restarts. Re-indexing only happens on the first run.

Add `.gitnexus/` to your `.gitignore` if you don't want to commit the index files.

## What you can do

Ask your AI assistant natural language questions:

> "Show me all relations for braintree payments"
> "What depends on ProductRepository?"
> "How does checkout payment processing work?"
> "What breaks if I change the Quote model?"
> "Show me all plugins on the Cart model"

The AI translates these to GitNexus MCP tool calls automatically.

### Claude Code skills (optional)

GitNexus ships skill files that teach Claude Code how to use the tools more effectively (exploring, impact analysis, debugging, refactoring). To install them in your project:

```bash
# Requires gitnexus installed locally
gitnexus analyze --skills
```

This generates `.claude/skills/gitnexus/` with the latest skill files from the GitNexus project. Skills evolve with each GitNexus release — always fetch fresh rather than copying static files.

Without skills, the MCP tools still work — Claude Code discovers them via the MCP protocol. Skills just provide richer prompting guidance.

### CLI queries

```bash
# Impact analysis
docker run --rm -i mage-os-gitnexus:2.3.0 impact ProductRepository --direction upstream

# Code exploration
docker run --rm -i mage-os-gitnexus:2.3.0 query "checkout payment processing"

# Symbol context
docker run --rm -i mage-os-gitnexus:2.3.0 context Product
```

## Download index directly (no Docker)

If you already have gitnexus installed and just want the pre-built database:

```bash
curl -fSL https://github.com/ProxiBlue/mage-os-gitnexus/releases/download/v2.3.0/gitnexus-index.tar.gz \
  -o gitnexus-index.tar.gz

mkdir -p .gitnexus
tar xzf gitnexus-index.tar.gz -C .gitnexus/
curl -fSL https://raw.githubusercontent.com/ProxiBlue/mage-os-gitnexus/main/index/meta.json \
  -o .gitnexus/meta.json

gitnexus index .
```

## Available versions

| Tag | Mage-OS version | Nodes | Edges |
|-----|-----------------|-------|-------|
| `2.3.0` | Mage-OS 2.3.0 | 189,396 | 489,068 |

## Building the index yourself

See `scripts/build-index.sh`. GitNexus currently requires patches for large PHP vendor trees:
- [PR #1800](https://github.com/abhigyanpatwari/GitNexus/pull/1800) — OOM in deferred-calls
- [PR #1801](https://github.com/abhigyanpatwari/GitNexus/pull/1801) — phtml scope extraction
- [PR #1808](https://github.com/abhigyanpatwari/GitNexus/pull/1808) — OOM in namespace-siblings

These patches are applied automatically in the Docker image.

## License

MIT
