# Custom Indices — Step-by-Step Guide

This guide walks through indexing your own code (custom Magento modules, vendor namespaces, your project tree) and serving it alongside the bundled mageos / hyva / deps indexes through one MCP endpoint.

There are two ways to do it. Pick one:

1. **[Per-project DDEV service (recommended)](#path-1--per-project-ddev-service)** — one gitnexus container per DDEV project. Strict isolation (each project sees only its own custom code), no host-port clashes between projects, indexes are pre-built so `ddev start` stays fast. Best for working on multiple projects on the same machine.

2. **[Standalone container (multi-mount)](#path-2--standalone-container)** — one host-level gitnexus container mounts code from one or more projects. Simpler if you only have one project, or if you want all projects' code in one searchable graph (federated queries find symbols across projects — but cross-mount call edges don't link).

Both paths use the same image (`mage-os-gitnexus:latest`) and the same `.gitnexusignore` syntax to control what gets indexed.

---

## Prerequisites

- Docker (or Docker Desktop) running
- This repo cloned locally
- A target project to index (a Magento or any code tree)

Build the image once per machine:

```bash
cd /path/to/mage-os-gitnexus
docker compose build
```

That produces `mage-os-gitnexus:latest` on your local docker daemon. All custom-indexing flows below reuse this image.

---

## Path 1 — Per-project DDEV service

### Easiest install — DDEV add-on

A bundled DDEV add-on at [`ddev-addon/`](../ddev-addon/) installs the compose file + runs sanity checks for you:

```bash
cd /path/to/your/ddev/project
ddev add-on get /path/to/mage-os-gitnexus/ddev-addon
```

Then jump to [Step 2 — pre-build the index](#step-2--pre-build-the-index). The manual file-drop steps below are for when you want to understand or customise what the add-on installs.

### Step 1 — drop two files into your DDEV project (manual alternative)

**`.ddev/docker-compose.gitnexus.yaml`** (commit to your project repo):

```yaml
services:
  gitnexus:
    container_name: ddev-${DDEV_SITENAME}-gitnexus
    image: mage-os-gitnexus:latest
    command: serve --host 0.0.0.0
    environment:
      PROJECT_ROOT: /var/www/html
    volumes:
      - "${DDEV_APPROOT}:/mounts/myproject"
    labels:
      com.ddev.site-name: ${DDEV_SITENAME}
      com.ddev.approot: ${DDEV_APPROOT}
```

Replace `myproject` with a short, unique alias for this project (e.g. `pps`, `lcd`, `acme`). That alias becomes the index name in gitnexus.

**`<project-root>/.gitnexusignore`** (commit to your project repo):

A working starter for a Magento project that indexes app/code + custom vendor namespaces, excludes the rest. Edit to suit your project — see [Writing a .gitnexusignore](#writing-a-gitnexusignore) below.

```
# Override gitnexus's hardcoded vendor exclude (we want vendor indexed)
!vendor/

# Already in the bundled indexes — don't duplicate
vendor/mage-os/
vendor/hyva-themes/

# Composer internals (noise, no graph value)
vendor/composer/
!vendor/composer/autoload_psr4.php
vendor/bin/
vendor/autoload.php

# Tree-sitter crash defence
**/*.min.js
**/*-min.js
**/*.bundle.js
**/codemirror*
**/codemirror*/**
**/ckeditor*/**
**/swagger-ui*/**
**/jquery-ui*.js
**/knockoutjs/**
**/moment.js
**/moment-*.js
**/lodash*.js
**/chart*.js
**/chartjs/**
**/prototype.js
**/prototype/**
**/fotorama*/**
**/hugerte/**
**/tinymce/**
**/requirejs/**
**/view/*/web/js/lib/
**/lib/web/jquery*
**/lib/web/prototype*

# Boilerplate
**/Test/
**/Tests/
**/test/
**/tests/
**/registration.php
**/composer.json
**/LICENSE*
**/COPYING*
**/CHANGELOG*
**/*.md
.env*

# Non-source dirs
ai/
db_dumps/
dev/
generated/
log/
node_modules/
patches/
phpserver/
profiler/
pub/
setup/
tmp/
var/
wiki/

# Local artefacts
.gitnexus/
.git/
.ddev/.claude/
```

### Step 2 — pre-build the index

```bash
/path/to/mage-os-gitnexus/scripts/build-mount.sh /path/to/myproject myproject
```

This runs the indexer one-shot (verbose mode, sequential workers — slow but log-readable). When it finishes, `<project>/.gitnexus/lbug` exists on the host.

**If you see a `Napi::Error` / `terminate called`:** tree-sitter crashed on a specific file. The script automatically detects the culprit and prints:

- The exact file path
- The line to add to your `.gitnexusignore`
- A one-liner to apply the fix and retry

Common patterns that need adding (project-specific):

- A specific minified-but-not-named-`.min.js` library shipped by a third-party module
- An obfuscated PHP file or one with unusual syntax
- A huge data file mistakenly placed under `app/code/`

Copy-paste the one-liner the script prints; re-run; iterate until clean.

### Step 3 — start DDEV

```bash
cd /path/to/myproject
ddev restart
```

DDEV starts your normal services plus the `gitnexus` service. The gitnexus container sees the existing `.gitnexus/lbug` and skips indexing — startup is seconds, not minutes.

`ddev describe` should show `gitnexus` as a running service.

### Step 4 — verify

From inside the web container:

```bash
ddev ssh
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' -m 3 http://gitnexus:4747/
# expect: HTTP 200

curl -sS http://gitnexus:4747/api/mcp -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 500
# expect JSON listing mcp tools
```

Or from the host:

```bash
docker exec ddev-${DDEV_SITENAME}-gitnexus gitnexus list
# expect: mageos, hyva, deps, myproject (4 entries)
```

From any MCP client connected to the project's claude-code session, the `mcp__gitnexus-mageos__list_repos` tool should now return 4 members.

### Step 5 — re-index after major code changes

The index is a snapshot. After significant refactors, regenerate:

```bash
rm -rf /path/to/myproject/.gitnexus
/path/to/mage-os-gitnexus/scripts/build-mount.sh /path/to/myproject myproject
docker restart ddev-${DDEV_SITENAME}-gitnexus
```

Restart is fast — lbug is already on disk; the container just reloads.

---

## Path 2 — Standalone container

For non-DDEV use or when you want all projects in one shared graph.

### Step 1 — local config

```bash
cd /path/to/mage-os-gitnexus
cp .env.example .env
cp docker-compose.override.yml.example docker-compose.override.yml
```

Edit `.env` to point `MAGEOS_PROJECT_PATH` at your primary Mage-OS install.

Edit `docker-compose.override.yml` to add custom mounts. Both files are gitignored — your local paths stay local.

### Step 2 — drop a `.gitnexusignore` into each mount

Same pattern as Path 1 — see [Writing a .gitnexusignore](#writing-a-gitnexusignore).

### Step 3 — pre-build each index (recommended) or let startup index on-demand

Pre-build:

```bash
./scripts/build-mount.sh /path/to/projectA mountA
./scripts/build-mount.sh /path/to/projectB mountB
```

Then bring the container up — it reuses the cached lbugs and starts fast:

```bash
docker compose up -d gitnexus-ui
```

Or skip pre-build entirely and let the container index everything on first start (slow first boot, fast thereafter — same lbug-cache mechanism).

### Step 4 — verify

```bash
docker compose logs gitnexus-ui --tail=30
# expect: [mage-os-gitnexus] Ready. Group 'mageos-project' has N members.

curl -sS -o /dev/null -w 'HTTP %{http_code}\n' http://localhost:4747/
# expect: HTTP 200
```

MCP endpoint is at `http://localhost:4747/api/mcp` from the host. From inside other docker containers, use `host.docker.internal:4747` (Docker Desktop) or set up a docker network bridge.

---

## Writing a `.gitnexusignore`

`gitignore`-style syntax. Lives at the **root of the mount** (project root, not the gitnexus repo).

### Two pattern styles

**Blacklist (recommended for "index almost everything"):**

Lets gitnexus default-include most things; you list what to exclude. Used by the starter above. Best when you want comprehensive coverage of your project (custom modules + third-party modules + your own vendor namespaces) and only want to skip known-noisy dirs.

```
# No leading `*` — default is include-everything except gitnexus's hardcoded ignores

# Override the hardcoded vendor exclude (custom vendor needs indexing)
!vendor/

# Then exclude what we don't want
vendor/mage-os/
vendor/hyva-themes/
**/*.min.js
pub/
var/
```

**Whitelist (strict, only specific paths):**

Excludes everything, then re-includes specific subtrees. Best when you only care about your own custom code.

```
# Exclude everything by default
*

# Re-include only specific paths (parent dirs must be re-included first)
!app/
!app/code/
!app/code/MyVendor/
!app/code/MyVendor/**

!vendor/
!vendor/myvendor/
!vendor/myvendor/**

# Required for XML augmenter detection
!vendor/composer/
!vendor/composer/autoload_psr4.php
```

### Key rules

- **Parent dirs must be re-included before children.** `!app/code/Foo/**` is useless if `app/` is still excluded. Add `!app/`, `!app/code/`, then `!app/code/Foo/**`.
- **`vendor/` is hardcoded-excluded by gitnexus.** Always start vendor sections with `!vendor/` to override.
- **The XML augmenter requires `vendor/composer/autoload_psr4.php`.** If it's behind an exclude, augmentation skips and you lose DI/observer/layout edges. Whitelist that one file specifically.
- **Tree-sitter crashes on certain JS patterns.** Always include the minified-JS guards (`**/*.min.js`, `**/*.bundle.js`) and known library bombs (codemirror, ckeditor, jquery-ui, prototype, knockoutjs, etc.) — see the starter above. New crash patterns can be added iteratively when `build-mount.sh` reports them.

### Reference

See [`index/.gitnexusignore.mageos`](../index/.gitnexusignore.mageos), `index/.gitnexusignore.hyva`, `index/.gitnexusignore.deps` for the actual filters used when building the bundled indexes. Same syntax.

---

## Troubleshooting

### `gitnexus list` shows only 3 entries (no custom index)

The custom index didn't register. Check container logs:

```bash
docker logs ddev-${PROJECT}-gitnexus 2>&1 | tail -30
```

Look for `WARNING: gitnexus index failed` or `Not a git repository`. If it says "Not a git repository" despite `.git/` existing in the mount, the entrypoint's safe.directory step didn't run before the register step — make sure you're on the current image:

```bash
cd /path/to/mage-os-gitnexus
docker compose build
docker restart ddev-${PROJECT}-gitnexus
```

### `Napi::Error` during indexing

Tree-sitter crashed on a specific file. `build-mount.sh` runs in verbose mode and prints the culprit + the `.gitnexusignore` line to add + a one-liner to retry. Copy-paste the one-liner.

If `build-mount.sh` can't auto-detect the file (regex didn't match), look at the last few `Indexing` / `Parsing` lines in the container log — the last filename before the crash is your suspect. Add to `.gitnexusignore`, delete `.gitnexus/lbug`, re-run.

### `curl http://gitnexus:4747/` returns "could not resolve host"

You're not inside the DDEV web container, or the `gitnexus` service isn't running in this project. From the host, the URL is the project's published port (see `ddev describe`). From the web container, the service name `gitnexus` only resolves if the `.ddev/docker-compose.gitnexus.yaml` is in place and DDEV has been restarted since adding it.

### Index built but `mcp__gitnexus-mageos__list_repos` returns empty

The MCP server loaded its registry at container startup. If you registered a new index without restarting the container, it's invisible. Restart:

```bash
docker restart ddev-${PROJECT}-gitnexus
# lbug is on disk; restart is ~5s, no re-indexing
```

### Re-indexing wedged (lbug never appears)

Clear any partial state and retry verbosely:

```bash
rm -rf /path/to/project/.gitnexus
/path/to/mage-os-gitnexus/scripts/build-mount.sh /path/to/project myproject
# verbose mode is the default for build-mount.sh
```

---

## Understanding what's unified and what isn't (read once)

After install, `gitnexus list` typically shows something like (real output from a Mage-OS project with the `m2_pvcpipesupplies` git repo mounted as `/mounts/pps`):

```
┌────────────────────┬───────────────┬────────────┬────────┬─────────┬─────────┐
│        Name        │     Path      │  Indexed   │ Files  │  Nodes  │  Edges  │
├────────────────────┼───────────────┼────────────┼────────┼─────────┼─────────┤
│ mageos             │ /var/www/html │ 2026-05-26 │ 21,741 │ 175,937 │ 400,672 │
│ hyva               │ /var/www/html │ 2026-05-26 │  3,451 │  10,641 │  21,073 │
│ deps               │ /var/www/html │ 2026-05-26 │  4,562 │  43,909 │ 116,068 │
│ m2_pvcpipesupplies │ /mounts/pps   │ 2026-05-28 │    897 │   6,145 │  12,045 │
└────────────────────┴───────────────┴────────────┴────────┴─────────┴─────────┘
```

Four things people get confused by here, in order of importance:

### 1. The `Name` column doesn't match the mount basename when the mount is a git repo

Above, the mount is at `/mounts/pps` (we picked `pps` as a short mount alias) but the registered Name is `m2_pvcpipesupplies` (the upstream git remote name — `uptactics/m2_pvcpipesupplies` for this project). That's how gitnexus auto-names indexes: **git remote name if the mount is a git repo, otherwise the path basename.**

What this means for queries: when targeting a specific index in MCP calls (`repo: <name>`), use the **Name** as it appears in `gitnexus list`, not the mount alias. So `repo: m2_pvcpipesupplies`, not `repo: pps`.

Same applies to `gitnexus group add` — the third argument must match the registered Name, not the mount alias. The bundled entrypoint uses the mount basename, which works for non-git mounts but mismatches for git ones. If you see "Registered as: custom/pps (alias: pps)" in the startup logs but `gitnexus list` shows the index under a different Name, the group-add silently registered the wrong alias. Workaround until upstream fix: manually `docker exec ddev-${PROJECT}-gitnexus gitnexus group add mageos-project custom/<mount-name> <actual-registered-name>`.

### 2. The `Path` column is cosmetic — different paths do NOT keep graphs apart

The bundled `mageos` / `hyva` / `deps` indexes show `Path: /var/www/html` because that's where the source lived **at image-build time** — the lbugs were generated against that path, and the path is embedded in their metadata. At runtime, `/var/www/html` doesn't even exist inside the gitnexus container (`docker exec ddev-${PROJECT}-gitnexus ls /var/www/html` returns "No such file or directory"). The path is purely a hint for tools that want to read source contents (`read_file`, `context`); the graph itself is self-contained inside each lbug.

Your custom mount shows `Path: /mounts/pps` because that's where the entrypoint binds it at runtime (the mount alias you chose). **Changing it to `/var/www/html` would be a lie** — the actual files are at `/mounts/pps` inside the container, and aligning the path column wouldn't merge any graphs. Don't bother.

### 3. Each lbug is a separate graph — `impact` / `find_symbol` don't traverse mounts

`find_symbol`, `impact`, `query` operate on a single lbug at a time. The `mageos-project` group serves all four lbugs via the same MCP endpoint, but a query on a symbol in `m2_pvcpipesupplies` will not return callers / dependents in `mageos`, and vice versa. This is a fundamental constraint of the underlying graph DB (ladybugdb's COPY is per-database; no cross-database edges).

What this means in practice:
- `impact(Magento\Quote\Model\Quote::collectTotals)` returns callers within `mageos` only. Your custom plugin in `m2_pvcpipesupplies` that wraps that method is **invisible** to this query, even though both indexes are in the same group.
- `impact(MyVendor\MyModule\Model\Foo::bar)` returns callers within `m2_pvcpipesupplies` only. A core Mage-OS hook that ends up calling `Foo::bar` is **invisible**.

Workaround when you need cross-graph traversal: query each lbug explicitly (`repo: mageos`, then `repo: m2_pvcpipesupplies`) and reconcile manually. Slow but works.

### 4. Federated search (`repo: @mageos-project`) DOES merge results — but it's symbol lookup, not edge traversal

The group adds value for "find this symbol across everything I have indexed":
- `find_symbol("ProductRepository")` with `repo: @mageos-project` returns hits from `mageos` AND `m2_pvcpipesupplies` in one reciprocal-rank-fusion-ranked list.
- Same for `query` and `context` over the group.

What grouping does **not** do: graph-edge traversal across lbug boundaries. Symbols match; edges don't bridge. That's the constraint.

### Want true cross-graph (one big lbug)?

Build a unified index against your whole project (much larger, ~13h rebuild) — see the [main README's REBUILD=1 section](../README.md#building-indexes-for-your-version). Costs a one-time rebuild, ~800MB lbug, no separate distribution. After that, `impact` and `find_symbol` traverse the entire codebase in one query.

Not the default for good reason (rebuild cost + size + no per-index update). Worth doing if cross-codebase impact analysis is a frequent friction.

---

## What runs when

**On `docker compose build`:**
- Builds the `mage-os-gitnexus:latest` image with the entrypoint.sh + scripts/ baked in.

**On `./scripts/build-mount.sh <project> <name>`:**
- Runs the image one-shot with `INDEX_ONLY=1` and `VERBOSE=1`.
- Indexes whatever's in the mount, respecting `.gitnexusignore`.
- Augments with XML edges if the mount looks like a full Magento project.
- Writes `<project>/.gitnexus/lbug` and exits.

**On `ddev restart` (or `docker restart ddev-<project>-gitnexus`):**
- gitnexus container starts.
- Entrypoint scans `/mounts/` for mounted dirs.
- For each mount with an existing `.gitnexus/lbug` → reuse (fast).
- For each mount without one → index now (slow on first run).
- Registers each mount in the gitnexus registry.
- Adds each as a member of the `mageos-project` group.
- Starts the HTTP server with MCP endpoint at `/api/mcp`.

**On MCP query (`list_repos`, `find_symbol`, etc.):**
- Server consults its in-memory registry (loaded at startup).
- New registrations done after startup require container restart to be visible.
