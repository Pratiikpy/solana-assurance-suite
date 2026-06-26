#!/bin/bash
# solana-testing-skill - Standard Installer
# Installs the skill into ~/.claude/skills and ensures the core solana-dev skill is present.
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/skill"
SKILLS_DIR="$HOME/.claude/skills"
SKILL_PATH="$SKILLS_DIR/solana-testing"
CORE_SKILL_PATH="$SKILLS_DIR/solana-dev"

print_banner() {
  echo -e "${CYAN}"
  echo "  solana-testing-skill"
  echo "  Prove your Solana program is safe before mainnet."
  echo -e "${NC}"
}

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

print_banner
echo "This installs:"
echo "  • solana-testing  → $SKILL_PATH"
echo "  • solana-dev      → $CORE_SKILL_PATH (core dependency, cloned if missing)"
echo

if [ "$SKIP_CONFIRM" = false ]; then
  read -p "Continue? [Y/n] " reply
  case "$reply" in [nN]*) echo "Aborted."; exit 0;; esac
fi

mkdir -p "$SKILLS_DIR" "$HOME/.claude"

# [1/2] Core skill (solana-dev) — install only if absent so we don't clobber a customized copy.
echo -e "${CYAN}[1/2]${NC} Ensuring core solana-dev skill..."
if [ -d "$CORE_SKILL_PATH" ]; then
  echo -e "  ${GREEN}✓${NC} Already present at $CORE_SKILL_PATH (left untouched)"
else
  temp_dir=$(mktemp -d)
  if git clone --depth 1 --quiet https://github.com/solana-foundation/solana-dev-skill.git "$temp_dir" 2>/dev/null; then
    cp -r "$temp_dir/skill" "$CORE_SKILL_PATH"
    rm -rf "$temp_dir"
    echo -e "  ${GREEN}✓${NC} Installed to $CORE_SKILL_PATH"
  else
    rm -rf "$temp_dir"
    echo -e "  ${YELLOW}→${NC} Could not clone core skill. Install manually:"
    echo -e "      github.com/solana-foundation/solana-dev-skill"
  fi
fi

# [2/2] This skill.
echo -e "${CYAN}[2/2]${NC} Installing solana-testing skill..."
[ -d "$SKILL_PATH" ] && rm -rf "$SKILL_PATH"
mkdir -p "$SKILL_PATH"
cp -r "$SOURCE_DIR"/. "$SKILL_PATH/"
echo -e "  ${GREEN}✓${NC} Installed to $SKILL_PATH"

echo
echo -e "${GREEN}Installation complete.${NC}"
echo "Try asking Claude:"
echo "  • \"scaffold tests for my Anchor program\""
echo "  • \"fuzz this program for invariant violations\""
echo "  • \"what should I test so this withdraw can't be drained?\""
echo
echo "Agents, commands, and rules for the full kit live in this repo under"
echo "agents/ commands/ rules/ — copy into your project's .claude/ as needed."
