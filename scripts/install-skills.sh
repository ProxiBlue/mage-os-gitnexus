#!/bin/bash
# Install GitNexus Claude Code skills into your project.
# Run from your Magento project root:
#   bash /path/to/mage-os-gitnexus/scripts/install-skills.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_SRC="$(dirname "$SCRIPT_DIR")/skills"
SKILLS_DST=".claude/skills/gitnexus"

if [ ! -d "$SKILLS_SRC" ]; then
  echo "Error: skills directory not found at $SKILLS_SRC"
  exit 1
fi

mkdir -p "$SKILLS_DST"
cp -r "$SKILLS_SRC"/* "$SKILLS_DST/"

echo "Installed GitNexus skills to $SKILLS_DST/"
echo ""
echo "Skills available:"
for skill in "$SKILLS_DST"/*/; do
  name=$(basename "$skill")
  echo "  - $name"
done
