#!/bin/bash
# solana-bridge-skill - Standard Installer
# Installs the skill into ~/.claude/skills and ensures the core solana-dev skill is present.
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/skill"
SKILLS_DIR="$HOME/.claude/skills"
SKILL_PATH="$SKILLS_DIR/solana-bridge"
CORE_SKILL_PATH="$SKILLS_DIR/solana-dev"

print_help() {
  echo "Usage: ./install.sh [options]"
  echo "  -y, --yes    Skip confirmation prompt"
  echo "  -h, --help   Show this help"
}

SKIP_CONFIRM=false
while [[ $# -gt 0 ]]; do
  case $1 in
    -y|--yes) SKIP_CONFIRM=true; shift;;
    -h|--help) print_help; exit 0;;
    *) echo "Unknown option: $1"; print_help; exit 1;;
  esac
done

echo -e "${CYAN}solana-bridge-skill${NC} — cross-chain bridging for Solana, safely."
echo "Installs:"
echo "  • solana-bridge → $SKILL_PATH"
echo "  • solana-dev    → $CORE_SKILL_PATH (core dependency, cloned if missing)"
echo "Pairs with the solana-testing skill for testing bridge integrations."
echo

if [ "$SKIP_CONFIRM" = false ]; then
  read -p "Continue? [Y/n] " reply
  case "$reply" in [nN]*) echo "Aborted."; exit 0;; esac
fi

mkdir -p "$SKILLS_DIR" "$HOME/.claude"

echo -e "${CYAN}[1/2]${NC} Ensuring core solana-dev skill..."
if [ -d "$CORE_SKILL_PATH" ]; then
  echo -e "  ${GREEN}✓${NC} Already present (left untouched)"
else
  temp_dir=$(mktemp -d)
  if git clone --depth 1 --quiet https://github.com/solana-foundation/solana-dev-skill.git "$temp_dir" 2>/dev/null; then
    cp -r "$temp_dir/skill" "$CORE_SKILL_PATH"; rm -rf "$temp_dir"
    echo -e "  ${GREEN}✓${NC} Installed to $CORE_SKILL_PATH"
  else
    rm -rf "$temp_dir"
    echo -e "  ${YELLOW}→${NC} Install core manually: github.com/solana-foundation/solana-dev-skill"
  fi
fi

echo -e "${CYAN}[2/2]${NC} Installing solana-bridge skill..."
[ -d "$SKILL_PATH" ] && rm -rf "$SKILL_PATH"
mkdir -p "$SKILL_PATH"
cp -r "$SOURCE_DIR"/. "$SKILL_PATH/"
echo -e "  ${GREEN}✓${NC} Installed to $SKILL_PATH"

echo
echo -e "${GREEN}Installation complete.${NC}"
echo "Try asking Claude:"
echo "  • \"bridge USDC from Solana to Base\""
echo "  • \"make my SPL token multichain with Wormhole NTT\""
echo "  • \"is my bridge integration safe to ship?\""
echo
echo "Agents/commands/rules live in this repo under agents/ commands/ rules/."
