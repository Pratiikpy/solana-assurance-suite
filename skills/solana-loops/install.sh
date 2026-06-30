#!/bin/bash
# solana-loops - Standard Installer
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/skill"
SKILLS_DIR="$HOME/.claude/skills"
SKILL_PATH="$SKILLS_DIR/solana-loops"

SKIP_CONFIRM=false
while [[ $# -gt 0 ]]; do
  case $1 in
    -y|--yes) SKIP_CONFIRM=true; shift;;
    -h|--help) echo "Usage: ./install.sh [-y|--yes]"; exit 0;;
    *) echo "Unknown option: $1"; exit 1;;
  esac
done

echo -e "${CYAN}solana-loops${NC} — hand off a goal, come back to verified progress."
echo "Installs: solana-loops → $SKILL_PATH (engine + prd-to-product / audit / ship-it loops + Stop-gate)"
echo
if [ "$SKIP_CONFIRM" = false ]; then
  read -p "Continue? [Y/n] " reply
  case "$reply" in [nN]*) echo "Aborted."; exit 0;; esac
fi

mkdir -p "$SKILLS_DIR" "$HOME/.claude"

echo -e "${CYAN}[1/1]${NC} Installing solana-loops skill..."
[ -d "$SKILL_PATH" ] && rm -rf "$SKILL_PATH"
mkdir -p "$SKILL_PATH"
cp -r "$SOURCE_DIR"/. "$SKILL_PATH/"
# ship the runner + proof alongside skill/ so the documented tools/ paths resolve after install
[ -d "$SCRIPT_DIR/tools" ] && cp -r "$SCRIPT_DIR/tools" "$SKILL_PATH/"
[ -d "$SCRIPT_DIR/examples" ] && cp -r "$SCRIPT_DIR/examples" "$SKILL_PATH/"
echo -e "  ${GREEN}✓${NC} Installed to $SKILL_PATH (skill/ + tools/ + examples/)"

echo
echo -e "${GREEN}Installation complete.${NC}"
echo "Try asking Claude:"
echo "  • \"loop this PRD to a shipped, verified product\""
echo "  • \"run an audit loop on this program until the findings are bulletproof\""
echo "  • \"drive this build to mainnet-ready — loop the assurance gates until green\""
echo
echo "Driver: tools/loop-runner/run.sh  ·  Stop-gate: tools/loop-runner/stop-gate.mjs  ·  Proof: examples/loop-proof/ (6/6)"
