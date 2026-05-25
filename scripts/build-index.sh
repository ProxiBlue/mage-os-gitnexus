#!/bin/bash
# Build the Mage-OS GitNexus index from a running Mage-OS project.
# Run this inside the project's DDEV container or anywhere with gitnexus installed.
#
# Usage: ./scripts/build-index.sh /path/to/mageos/project
#
# Requirements:
#   - gitnexus installed globally
#   - Mage-OS project with vendor/mage-os/ present
#   - .gitnexusignore configured (see README)
#
# Output: copies lbug + meta.json to ./index/

set -euo pipefail

PROJECT_PATH="${1:-.}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

echo "Building GitNexus index for: $PROJECT_PATH"
echo "This takes ~90 minutes for a full Mage-OS vendor tree."

NODE_OPTIONS='--max-old-space-size=16384' gitnexus analyze --force

echo "Copying index to $REPO_DIR/index/"
cp "$PROJECT_PATH/.gitnexus/lbug" "$REPO_DIR/index/lbug"
cp "$PROJECT_PATH/.gitnexus/meta.json" "$REPO_DIR/index/meta.json"

echo "Done. Index size: $(du -sh "$REPO_DIR/index/lbug" | cut -f1)"
echo ""
echo "Next steps:"
echo "  1. Commit the index: git add index/ && git commit -m 'update index for Mage-OS X.Y.Z'"
echo "  2. Build the Docker image: docker build -t proxiblue/mage-os-gitnexus:X.Y.Z ."
echo "  3. Push: docker push proxiblue/mage-os-gitnexus:X.Y.Z"
