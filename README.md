# mage-os-gitnexus

Pre-built [GitNexus](https://github.com/abhigyanpatwari/GitNexus) knowledge graph for [Mage-OS](https://github.com/mage-os) (Magento 2 community fork). Ready-to-query MCP server via Docker — no 90-minute indexing required. No gitnexus installation needed on your machine.

> ⚠️ **Commercial use requires a paid GitNexus license.** GitNexus is [PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0) — running it locally does **not** exempt commercial Magento work (agency, client, billable). See [License](#license) for details. Free for personal/education/research/open-source use.

## What's included

Three pre-built indexes, served together as a [GitNexus group](https://github.com/abhigyanpatwari/GitNexus) for cross-index queries:

| Index | Scope |
|---|---|
| `core/mageos` | `vendor/mage-os/` (Magento 2 core, 388 packages) |
| `core/hyva` | `vendor/hyva-themes/` (10 default-theme packages) — optional |
| `core/deps` | Magento's PHP runtime dependencies — `laminas/*`, `symfony/*`, `monolog/*`, `guzzlehttp/*`, `psr/*`, `league/flysystem*`, `colinmollenhour/*`, `ramsey/*`, `pelago/*`, `ezyang/*`, `elasticsearch/*`, `opensearch-project/*`, `duosecurity/*`, `creatuity/*`, `aligent/*` — optional |

- Class/interface/method graph with inheritance, calls, imports
- PHP scope-resolution with cross-file reference tracking
- Splitting by vendor isolates crashes during rebuild and lets users skip pieces they don't need
- The `deps` index closes the blind spot where Magento code calls into framework libraries (`Symfony\Console`, `Laminas\Di`, `Monolog\Logger`, etc.) — pair it with the matching Mage-OS version

See [Available versions](#available-versions) for stats per release.

### What groups give you (and what they don't)

The three indexes are registered together as a [GitNexus group](https://github.com/abhigyanpatwari/GitNexus) named `mageos-project`. This is **not** the same thing as merging them into one graph. To avoid surprises:

**What works** — federated search across all three indexes via MCP. Set `repo` to `@mageos-project` in any gitnexus MCP tool (`query`, `context`, `find_symbol`, `impact`, …) and results are merged from mageos, hyva, and deps with reciprocal-rank-fusion ranking. The container also runs `gitnexus group sync` at startup to extract HTTP-route contracts (e.g. Magento `webapi.xml` routes ↔ frontend `fetch()` calls) into a bridge database used by cross-impact queries.

**What does NOT work** — direct PHP class/method call edges across index boundaries. When `vendor/mage-os/.../SomeController.php` calls `Symfony\Console\Application::run()`:

- That call lives in the **mageos** lbug as an *unresolved* reference (target class isn't in the same graph)
- The `Symfony\Console\Application` definition lives in the **deps** lbug as a normal class node
- No edge exists between them — `gitnexus group sync` only bridges service-style contracts (HTTP/gRPC/Thrift/Topic/manifest), not shared-library class references. The `shared_libs: true` flag in gitnexus's group config is a placeholder; no PHP-aware cross-index symbol resolver is implemented upstream.

**Practical impact** — queries like "find all callers of `Laminas\Di\Injector::resolve`" return callers from *within* deps only, not from mage-os or hyva. Same for impact analysis traversing between mageos and deps. For most code-intelligence questions ("how does Quote::collectTotals work", "what plugins are on Cart") this isn't relevant — you're traversing within one index. But it's worth knowing.

**Workarounds** if cross-index symbol resolution matters for your work:

- Query each index by name explicitly (`repo: mageos` then `repo: deps`) and reconcile in your head
- Build a combined index locally (`TARGET=all` rebuild), then bypass the split-distribution flow with a single `gitnexus index` registration over the combined output. Costs ~13h rebuild, no crash isolation, ~800MB single archive — but full cross-call resolution. Not currently shipped as a default release; see [Building indexes for your version](#building-indexes-for-your-version) and adapt the `.gitnexusignore` to whitelist all three vendor trees in one pass.
- Disable the startup sync if you don't need HTTP-route bridging — set `-e GROUP_SYNC=0` on the container.

## Quick start

```bash
git clone https://github.com/ProxiBlue/mage-os-gitnexus.git
cd mage-os-gitnexus

# Default versions (latest tested), all three indexes bundled
docker build -t mage-os-gitnexus:latest .

# Or pick specific index versions
docker build \
  --build-arg MAGEOS_VERSION=2.3.0 \
  --build-arg HYVA_VERSION=1.4.6 \
  -t mage-os-gitnexus:my-tag .

# Mage-OS only (skip the Hyvä + deps downloads → smaller image)
docker build \
  --build-arg HYVA_VERSION=none \
  --build-arg INCLUDE_DEPS=0 \
  -t mage-os-gitnexus:mageos-only .
```

The image is decoupled from index content — the same image can bundle any combination of available Mage-OS, Hyvä, and runtime-deps index versions. The deps index is automatically paired with the Mage-OS version (release tag `deps-<MAGEOS_VERSION>`) since composer-pinned dep versions differ between Mage-OS releases. See [Available versions](#available-versions) for the list.

Add to `.mcp.json` (Claude Code, Cursor, or any MCP client):

```json
{
  "mcpServers": {
    "gitnexus-mageos": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "mage-os-gitnexus:latest"]
    }
  }
}
```

## File reads — matching your environment

The index stores **relative** paths (`app/code/Foo.php`, not `/var/www/html/app/code/Foo.php`), so it's portable across environments. The MCP server only needs to know where to look when it reads file *contents* via tools like `read_file`. Set `PROJECT_ROOT` to wherever your Mage-OS code lives inside the container:

```json
{
  "mcpServers": {
    "gitnexus-mageos": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "PROJECT_ROOT=/var/www/html",
        "-v", "/path/to/your/mageos:/var/www/html",
        "mage-os-gitnexus:latest"
      ]
    }
  }
}
```

Common paths:
- **DDEV / typical Magento Docker**: `/var/www/html`
- **Plain Docker / Lando**: `/workspace` (default — no env var needed)

If you don't mount source code, graph queries still work — only file-content tools fail.

## Web UI

GitNexus has a web UI hosted at [gitnexus.vercel.app](https://gitnexus.vercel.app) that connects to a local HTTP backend over CORS. The frontend is the upstream's hosted page; your code and graph stay on your machine — only the JavaScript runs in your browser.

Start the backend with the bundled `docker-compose.yml`:

```bash
cd ~/workspace/proxiblue/mage-os-gitnexus

# Point at your Mage-OS project (in your shell or in a .env file next to docker-compose.yml)
export MAGEOS_PROJECT_PATH=/home/you/workspace/your-mageos-project

docker compose up gitnexus-ui
```

Then open **https://gitnexus.vercel.app** in your browser. The page auto-detects `localhost:4747` and connects.

Or as a one-off `docker run`:

```bash
docker run --rm -p 4747:4747 \
  -e PROJECT_ROOT=/var/www/html \
  -v ~/workspace/your-mageos-project:/var/www/html:ro \
  mage-os-gitnexus:latest \
  serve --host 0.0.0.0
```

Key flags:
- **`-p 4747:4747`** — exposes the API port. The hosted UI can't reach it otherwise.
- **`--host 0.0.0.0`** — required inside Docker; the default `localhost` only binds the container's loopback.
- **`:ro`** — read-only mount is fine; the server only needs to read files for the `read_file`-style tools.

**Privacy / compliance**: the UI page (HTML + JS) is loaded from `gitnexus.vercel.app`, so the page's JavaScript can in principle log usage. The *server* in the container makes no outbound calls during normal operation (audited — only `gitnexus publish` ever talks to GitHub, and only when explicitly invoked). If the hosted UI is a concern for client-confidential work, stick to the [MCP integration](#adding-your-own-code) — graph queries through Claude Code never touch a hosted page.

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
        "mage-os-gitnexus:latest"
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
        "mage-os-gitnexus:latest"
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
docker run --rm -i mage-os-gitnexus:latest impact ProductRepository --direction upstream

# Code exploration
docker run --rm -i mage-os-gitnexus:latest query "checkout payment processing"

# Symbol context
docker run --rm -i mage-os-gitnexus:latest context Product
```

## Download indexes directly (no Docker)

If you already have gitnexus installed and want the pre-built databases. Each archive contains both `lbug` and `meta.json` — drop them into a `.gitnexus/` directory and register with gitnexus.

```bash
MAGEOS=2.3.0
HYVA=1.4.6
# deps version is always the Mage-OS version
RELEASES=https://github.com/ProxiBlue/mage-os-gitnexus/releases/download

# Mage-OS core
mkdir -p indexes/mageos/.gitnexus
curl -fSL $RELEASES/mageos-$MAGEOS/gitnexus-index.tar.gz | tar xz -C indexes/mageos/.gitnexus/
gitnexus index indexes/mageos --name mageos

# Hyvä themes (skip if you don't use Hyvä)
mkdir -p indexes/hyva/.gitnexus
curl -fSL $RELEASES/hyva-$HYVA/gitnexus-index.tar.gz | tar xz -C indexes/hyva/.gitnexus/
gitnexus index indexes/hyva --name hyva

# Magento runtime PHP deps (laminas, symfony, monolog, …) — paired with the Mage-OS version
mkdir -p indexes/deps/.gitnexus
curl -fSL $RELEASES/deps-$MAGEOS/gitnexus-index.tar.gz | tar xz -C indexes/deps/.gitnexus/
gitnexus index indexes/deps --name deps

# Group them for unified MCP queries
gitnexus group create mageos-project --force
gitnexus group add mageos-project core/mageos mageos
gitnexus group add mageos-project core/hyva hyva
gitnexus group add mageos-project core/deps deps
```

## Available versions

Each index version is published as its own GitHub release. The release tag follows `<target>-<version>` and the asset is always `gitnexus-index.tar.gz` (contains `lbug` + `meta.json`).

### Mage-OS indexes

| Release tag | Mage-OS version | Files | Nodes | Edges |
|---|---|---:|---:|---:|
| [`mageos-2.3.0`](https://github.com/ProxiBlue/mage-os-gitnexus/releases/tag/mageos-2.3.0) | 2.3.0 | 21,741 | 178,399 | 436,573 |

### Hyvä indexes

| Release tag | Hyvä default-theme version | Files | Nodes | Edges |
|---|---|---:|---:|---:|
| [`hyva-1.4.6`](https://github.com/ProxiBlue/mage-os-gitnexus/releases/tag/hyva-1.4.6) | 1.4.6 | 3,451 | 10,776 | 21,889 |

### Runtime-deps indexes

> **Versions are pinned to the Mage-OS release** they were built against. A Mage-OS 2.3.0 install has different `laminas/*` / `symfony/*` versions than 2.4.0, so `deps-X.Y.Z` only matches `mageos-X.Y.Z`. The Dockerfile pairs them automatically — there is no separate version arg.

| Release tag | Paired with | Files | Nodes | Edges |
|---|---|---:|---:|---:|
| [`deps-2.3.0`](https://github.com/ProxiBlue/mage-os-gitnexus/releases/tag/deps-2.3.0) | `mageos-2.3.0` | 4,562 | 44,099 | 135,519 |

Packages indexed: `laminas/*`, `symfony/*`, `monolog/*`, `guzzlehttp/*`, `psr/*`, `league/flysystem*`, `colinmollenhour/*`, `ramsey/*`, `pelago/*`, `ezyang/*`, `elasticsearch/*`, `opensearch-project/*`, `duosecurity/*`, `creatuity/*`, `aligent/*`, `composer/semver`, `composer/ca-bundle`. ICU locale data, polyfill stubs, and test/fixture dirs are excluded.

Pick versions via Docker build args:

```bash
docker build \
  --build-arg MAGEOS_VERSION=2.3.0 \
  --build-arg HYVA_VERSION=1.4.6 \
  --build-arg INCLUDE_DEPS=1 \
  -t mage-os-gitnexus:my-tag .
```

Toggles:
- `HYVA_VERSION=none` — skip Hyvä (build a Mage-OS-only image)
- `INCLUDE_DEPS=0` — skip runtime-deps (smaller image, but loses cross-references into framework libraries)

The Docker image tag is *your* choice — no longer tied to the Mage-OS version.

## Building indexes for your version

> **Doesn't see your version in the [Available versions](#available-versions) table?**
> The same Docker image can build an index against any Mage-OS / Hyvä installation. Run the build once locally (~60–90 min for Mage-OS, ~5–10 min for Hyvä), then either keep the index for personal use or [contribute it back](#contributing-your-index-back) so others on your version benefit too.

### Requirements

- A working Mage-OS project on disk with `vendor/mage-os/` (and optionally `vendor/hyva-themes/`) installed via composer
- The `mage-os-gitnexus:latest` Docker image (built once from this repo)
- Roughly 8 GB of free RAM for the Node heap during indexing
- Time: ~60–90 min for Mage-OS, ~5–10 min for Hyvä

### Run the build

`TARGET` picks which subtree to index — defaults to `mageos`, accepts `hyva`, `deps`, or `all`. Each target uses its own `.gitnexusignore.<target>` (shipped in the image) so vendor scopes never cross over.

```bash
# Mage-OS only (default, ~60–90 min)
docker run --rm -it \
  -e REBUILD=1 \
  -v /path/to/your/mageos/project:/project \
  -v mageos-index:/output \
  mage-os-gitnexus:latest

# Hyvä only (~5–10 min)
docker run --rm -it -e REBUILD=1 -e TARGET=hyva \
  -v /path/to/your/mageos/project:/project \
  -v mageos-index:/output \
  mage-os-gitnexus:latest

# Runtime PHP deps (laminas, symfony, monolog, etc.) — must match the Mage-OS version
# that's installed in /project. Roughly 8–10k PHP files, ~10–20 min.
docker run --rm -it -e REBUILD=1 -e TARGET=deps \
  -v /path/to/your/mageos/project:/project \
  -v mageos-index:/output \
  mage-os-gitnexus:latest

# All three, sequentially
docker run --rm -it -e REBUILD=1 -e TARGET=all \
  -v /path/to/your/mageos/project:/project \
  -v mageos-index:/output \
  mage-os-gitnexus:latest
```

What happens inside the container:

1. Mounts your project at `/project`
2. Copies `.gitnexusignore.<target>` over your project's ignore file (per target)
3. Runs `gitnexus analyze --force` against `/project`
4. Writes the resulting `lbug` + `meta.json` to `/output/<target>/`

The `mageos-index` Docker volume persists the output between runs so a crashed/aborted build doesn't lose earlier successes.

### Tuning the build

If the build OOMs, runs out of file descriptors, or trips a tree-sitter native crash, these knobs help:

| Variable | Default | What it does |
|----------|---------|--------------|
| `TARGET` | `mageos` | Which subtree to index: `mageos`, `hyva`, `deps`, or `all` |
| `GITNEXUS_WORKERS` | auto (all cores) | Parser worker pool size. **`0` disables workers entirely** (sequential, helps isolate native crashes) |
| `GITNEXUS_HEAP_SIZE` | `32768` | Node.js `--max-old-space-size` in MB |
| `GITNEXUS_WORKER_TIMEOUT` | `60` | Worker idle timeout (seconds) before retry |
| `GITNEXUS_MAX_FILE_SIZE` | `512` | Skip files larger than this (KB). Lower it to dodge problematic minified blobs |
| `GITNEXUS_SUB_BATCH_BYTES` | `16777216` | Worker sub-batch byte budget (16 MB default) |
| `GITNEXUS_VERBOSE` | `0` | Set to `1` for `--verbose` output (prints the file being parsed — useful for pinpointing crashes) |

Example — defensive run when a crash is suspected:

```bash
docker run --rm -it \
  -e REBUILD=1 \
  -e TARGET=hyva \
  -e GITNEXUS_WORKERS=0 \
  -e GITNEXUS_VERBOSE=1 \
  -e GITNEXUS_MAX_FILE_SIZE=256 \
  -v /path/to/project:/project \
  -v mageos-index:/output \
  mage-os-gitnexus:latest
```

### Package the result

When the build finishes, the index lives in the Docker volume. Package it for use or distribution:

```bash
MAGEOS=2.3.0   # the Mage-OS version you indexed against
HYVA=1.4.6     # the Hyvä default-theme version (composer show hyva-themes/magento2-default-theme)
# deps is always pinned to the Mage-OS version it was built against

# All three files (lbug + meta.json) go at the archive root
docker run --rm -v mageos-index:/in -v $(pwd):/out alpine sh -c "
  cd /in/mageos && tar czf /out/gitnexus-index-mageos-$MAGEOS.tar.gz lbug meta.json
  cd /in/hyva   && tar czf /out/gitnexus-index-hyva-$HYVA.tar.gz     lbug meta.json
  cd /in/deps   && tar czf /out/gitnexus-index-deps-$MAGEOS.tar.gz   lbug meta.json
"
```

The result is up to three tarballs in your current directory — one per target you built. The `deps` archive's version always matches the Mage-OS version, since composer-pinned dependency versions differ between Mage-OS releases.

### Contributing your index back

If you've built an index for a Mage-OS or Hyvä version that isn't already in [Available versions](#available-versions), **please contribute it** — many developers run the same vendor versions and rebuilding takes hours. Even a single donated index helps the next person to land on this repo.

The smoothest way is to bundle code changes and the artifacts together as a PR:

1. **Fork** [ProxiBlue/mage-os-gitnexus](https://github.com/ProxiBlue/mage-os-gitnexus) and create a branch.
2. **Publish your tarballs on a GitHub release in your fork** (since the artifacts are too large for the repo itself):
   ```bash
   gh release create mageos-$MAGEOS gitnexus-index-mageos-$MAGEOS.tar.gz#gitnexus-index.tar.gz \
     --title "Mage-OS $MAGEOS index" \
     --notes "Pre-built GitNexus index for Mage-OS $MAGEOS. Built by <you> on <date>."
   gh release create hyva-$HYVA gitnexus-index-hyva-$HYVA.tar.gz#gitnexus-index.tar.gz \
     --title "Hyvä $HYVA index" \
     --notes "Pre-built GitNexus index for Hyvä default-theme $HYVA. Built by <you> on <date>."
   gh release create deps-$MAGEOS gitnexus-index-deps-$MAGEOS.tar.gz#gitnexus-index.tar.gz \
     --title "Mage-OS $MAGEOS runtime deps index" \
     --notes "Pre-built GitNexus index for the PHP runtime deps shipped with Mage-OS $MAGEOS. Built by <you> on <date>."
   ```
   The `#gitnexus-index.tar.gz` suffix renames the asset on upload so the Dockerfile's stable URL pattern (`.../releases/download/<tag>/gitnexus-index.tar.gz`) keeps working. Skip whichever targets you didn't rebuild.
3. **Update the [Available versions](#available-versions) tables in this README** to add your row(s) — include files / nodes / edges from your `meta.json`'s `stats` object. Link the release tag to the release on your fork for now.
4. **Open a pull request** describing what you indexed (Mage-OS version, Hyvä version, which targets you built, any non-default `.gitnexusignore` tweaks, build time, host specs). Mention the upstream `gitnexus@<version>` your image used. **Always pair `deps-X.Y.Z` with `mageos-X.Y.Z`** — never publish a `deps-` release built against a different Mage-OS version than the tag suggests.
5. We'll review, then either re-publish the release on this repo and update the README links, or merge as-is if pointing at your fork is the cleanest path.

**Don't have a GitHub release / can't host the artifacts?** Open an [issue](https://github.com/ProxiBlue/mage-os-gitnexus/issues) titled "Index contribution: Mage-OS X.Y.Z" with the tarballs attached (GitHub allows up to 25 MB per attachment — Hyvä typically fits, Mage-OS + deps may need a transfer.sh, Dropbox, or S3 link). We'll cut the release on your behalf.

By contributing an index you're publishing generated data only — your project's source files are *not* in the archive. Inspect with `tar tzf gitnexus-index-*.tar.gz` before sharing to confirm only `lbug` + `meta.json` are inside.

### Upstream fixes

The image uses `gitnexus@1.6.6-rc.55+` which includes fixes for large PHP vendor trees previously shipped as patches:
- [PR #1800](https://github.com/abhigyanpatwari/GitNexus/pull/1800) — OOM in deferred-calls
- [PR #1801](https://github.com/abhigyanpatwari/GitNexus/pull/1801) — phtml scope extraction
- [PR #1808](https://github.com/abhigyanpatwari/GitNexus/pull/1808) — OOM in namespace-siblings

## License

### Commercial use — paid license required

> ⚠️ **GitNexus is licensed under [PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0).** Running it locally does **not** exempt you — the restriction is on the *purpose of use*, not the location.
>
> If you use this image (or GitNexus directly) on **paid Magento work** — agency client projects, billable freelance, internal commercial development — **you need a commercial GitNexus license**, regardless of how you run it.
>
> - Commercial pricing: **~$29 USD per user / month** (SaaS or self-hosted). Enterprise tier adds multi-repo indexing and cross-repo impact analysis.
> - License contact: **founders@akonlabs.com** or [GitNexus Discord](https://discord.gg/AAsRVT6fGb)
> - Confirmed by the GitNexus author in [issue #1812](https://github.com/abhigyanpatwari/GitNexus/issues/1812).

**Free use** under PolyForm Noncommercial covers: personal projects, education, research, evaluation, and free/open-source community work.

### This repository

The Dockerfile, scripts, `.gitnexusignore` files, and documentation in **this** repository are MIT licensed.

The pre-built index data (`.gitnexus/lbug`, `meta.json`) is generated output — not subject to GitNexus's source license.

The Docker image installs [GitNexus](https://github.com/abhigyanpatwari/GitNexus) under the terms above. By using the Docker image you agree to GitNexus's PolyForm Noncommercial license **and** to obtain a commercial license if your use case is commercial.

> Required Notice: Copyright Abhigyan Patwari (https://github.com/abhigyanpatwari/GitNexus)
