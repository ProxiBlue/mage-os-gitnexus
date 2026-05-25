# mage-os-gitnexus

Pre-built [GitNexus](https://github.com/abhigyanpatwari/GitNexus) knowledge graph for [Mage-OS](https://github.com/mage-os) (Magento 2 community fork). Ready-to-query MCP server via Docker — no 90-minute indexing required.

## What's included

- **189,396 nodes** | **489,068 edges** | **6,144 clusters** | **300 execution flows**
- Full `vendor/mage-os/` (388 packages) + `vendor/hyva-themes/` (10 packages)
- Class/interface/method graph with inheritance, calls, imports
- PHP scope-resolution with cross-file reference tracking

## Quick start

Add to your `.mcp.json` (Claude Code, Cursor, or any MCP client):

```json
{
  "mcpServers": {
    "gitnexus-mageos": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "proxiblue/mage-os-gitnexus:2.3.0", "gitnexus", "mcp"]
    }
  }
}
```

Docker pulls the image once (~150MB compressed), then queries are instant.

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

If you want to rebuild (e.g., for a different Mage-OS version or with custom modules):

```bash
# In your Mage-OS project directory
NODE_OPTIONS='--max-old-space-size=16384' gitnexus analyze --force

# Copy the index
cp .gitnexus/lbug /path/to/mage-os-gitnexus/index/
cp .gitnexus/meta.json /path/to/mage-os-gitnexus/index/

# Build and push
docker build -t proxiblue/mage-os-gitnexus:X.Y.Z .
docker push proxiblue/mage-os-gitnexus:X.Y.Z
```

### Prerequisites for building

GitNexus requires patches for large PHP vendor trees. See:
- [PR #1800](https://github.com/abhigyanpatwari/GitNexus/pull/1800) — OOM in deferred-calls
- [PR #1801](https://github.com/abhigyanpatwari/GitNexus/pull/1801) — phtml scope extraction
- [PR #1808](https://github.com/abhigyanpatwari/GitNexus/pull/1808) — OOM in namespace-siblings

Use the `.gitnexusignore` from this repo to scope the indexing correctly.

### .gitnexusignore

The index was built with this `.gitnexusignore` to include only Mage-OS core + Hyvä and exclude noise:

```
!vendor/
!vendor/mage-os/
!vendor/hyva-themes/
vendor/*
!vendor/mage-os/
!vendor/hyva-themes/

vendor/mage-os/language-*
vendor/mage-os/sample-data-media
vendor/mage-os/composer*
vendor/mage-os/inventory-composer-installer
vendor/mage-os/magento-allure-phpunit
vendor/mage-os/magento-coding-standard
vendor/mage-os/magento-composer-installer
vendor/mage-os/magento2-functional-testing-framework
vendor/mage-os/php-compatibility-fork
vendor/mage-os/zend-*
vendor/mage-os/magento-zf-db

dev/
setup/
var/
phpserver/
**/Test/
**/Tests/
**/*-sample-data/
```

## Enhancing with Magento XML edges

For additional dependency edges (plugins, preferences, block→template, observers, REST endpoints), use [gitnexus-magento](https://github.com/ProxiBlue/gitnexus-magento):

```bash
node /path/to/gitnexus-magento/dist/cli.js augment /path/to/project
```

## License

MIT
