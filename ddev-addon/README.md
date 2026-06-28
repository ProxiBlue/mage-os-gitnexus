# gitnexus — DDEV add-on

Installs a per-project [`mage-os-gitnexus`](..) service. Each DDEV project gets its own gitnexus container, indexing only that project's code alongside the bundled Mage-OS / Hyva / deps indexes shipped in the parent image. (`mage-os-gitnexus` wraps [upstream gitnexus](https://github.com/abhigyanpatwari/GitNexus) with the Mage-OS / Hyva / deps pre-built indexes and the XML augmenter.)

Strict isolation between projects (no cross-project leakage), no host-port clashes across multiple Magento projects, and pre-buildable indexes so `ddev start` stays fast.

## Prerequisites

- `mage-os-gitnexus:latest` image must exist on the local docker daemon. Build once per machine from the parent repo:

  ```bash
  cd /path/to/mage-os-gitnexus
  docker compose build
  ```

  The image isn't published to Docker Hub (it bundles the full mageos/hyva/deps lbug indexes — ~hundreds of MB), so local build is required.

- A `.gitnexusignore` at your project root controlling what gets indexed. See [`../docs/custom-indices.md`](../docs/custom-indices.md) for a working starter and pattern guide.

## Install

From your DDEV project directory:

```bash
ddev add-on get /path/to/mage-os-gitnexus/ddev-addon
```

That copies `docker-compose.gitnexus.yaml` into `.ddev/` and runs the pre-/post-install actions.

Alternatively, if a release tarball is published:

```bash
ddev add-on get https://github.com/<owner>/mage-os-gitnexus/releases/download/<version>/ddev-addon.tar.gz
```

## Post-install — three steps to working

1. **Drop a `.gitnexusignore` at your project root.** See [`../docs/custom-indices.md`](../docs/custom-indices.md) — copy the starter, adjust to your project.

2. **Pre-build the index** (recommended — keeps `ddev start` fast):

   ```bash
   /path/to/mage-os-gitnexus/scripts/build-mount.sh $DDEV_APPROOT $DDEV_SITENAME
   ```

   This runs the indexer one-shot with the project mounted, writes `<project>/.gitnexus/lbug`, exits. On crash (tree-sitter `Napi::Error`), the script auto-detects the culprit file and prints the `.gitnexusignore` line + retry one-liner.

3. **Start the service:**

   ```bash
   ddev restart
   ```

   The gitnexus service starts, detects the existing lbug, skips indexing, serves immediately. `ddev describe` shows `gitnexus` as a running service.

## Verify

From inside the web container:

```bash
ddev ssh
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' -m 3 http://gitnexus:4747/
# expect: HTTP 200
```

From the host:

```bash
docker exec ddev-${DDEV_SITENAME}-gitnexus gitnexus list
# expect: 4 entries — mageos, hyva, deps, and your project
```

From any MCP client (e.g. Claude Code) connected to the project: `mcp__gitnexus-mageos__list_repos` should return all 4.

> **If the Name column shows the git remote name instead of your mount alias** (e.g. `m2_pvcpipesupplies` instead of `pps`), that's expected for git repos — see [docs/custom-indices.md § Understanding what's unified and what isn't](../docs/custom-indices.md#understanding-whats-unified-and-what-isnt-read-once) for why, and why it doesn't matter for federated queries.

## Customise

### Shorter mount alias

By default the mount registers as `${DDEV_SITENAME}` (e.g. `pvcpipesupplies`). For a shorter alias:

```yaml
# .ddev/docker-compose.gitnexus.yaml
volumes:
  - "${DDEV_APPROOT}:/mounts/pps"
```

Edit after install; remember to also re-run `build-mount.sh` with the new short name as the second arg so the cached lbug matches.

### Disable XML augmenter

By default, the augmenter runs after first-time indexing (adds DI / observer / layout XML edges to the graph). To disable:

```yaml
# .ddev/docker-compose.gitnexus.yaml
environment:
  PROJECT_ROOT: /var/www/html
  AUGMENT: "0"
```

## Re-index after major code changes

```bash
rm -rf $DDEV_APPROOT/.gitnexus
/path/to/mage-os-gitnexus/scripts/build-mount.sh $DDEV_APPROOT $DDEV_SITENAME
docker restart ddev-${DDEV_SITENAME}-gitnexus
```

## Uninstall

```bash
ddev add-on remove gitnexus
```

Removes `.ddev/docker-compose.gitnexus.yaml` and the gitnexus container. The cached `.gitnexus/lbug` on disk persists — delete manually if you want to reclaim disk space:

```bash
rm -rf $DDEV_APPROOT/.gitnexus
```

## Reference

- Parent project: [`mage-os-gitnexus`](..)
- Custom indices guide: [`../docs/custom-indices.md`](../docs/custom-indices.md)
- Pre-build helper: [`../scripts/build-mount.sh`](../scripts/build-mount.sh)
- Sample `.gitnexusignore` filters: [`../index/.gitnexusignore.mageos`](../index/.gitnexusignore.mageos)
