#!/bin/bash
# solana-testing-skill - Interactive Installer
# Lets you choose install location, whether to install the core skill, and whether
# to copy agents/commands/rules into a project's .claude/ directory.
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/skill"

echo -e "${CYAN}solana-testing-skill — interactive install${NC}"
echo

# 1) Location
echo "Where should the skill be installed?"
echo "  1) Personal  (~/.claude/skills/solana-testing)   [default]"
echo "  2) Project   (./.claude/skills/solana-testing)"
echo "  3) Custom path"
read -p "Choice [1]: " loc_choice
case "${loc_choice:-1}" in
  2) SKILLS_DIR="$(pwd)/.claude/skills";;
  3) read -p "Enter skills dir: " custom; SKILLS_DIR="$custom";;
  *) SKILLS_DIR="$HOME/.claude/skills";;
esac
SKILL_PATH="$SKILLS_DIR/solana-testing"
CORE_SKILL_PATH="$SKILLS_DIR/solana-dev"
mkdir -p "$SKILLS_DIR"

# 2) Core skill
if [ -d "$CORE_SKILL_PATH" ]; then
  echo -e "${GREEN}✓${NC} Core solana-dev skill already present."
else
  read -p "Install core solana-dev skill too? [Y/n] " core_reply
  case "$core_reply" in
    [nN]*) echo -e "${YELLOW}→${NC} Skipping core. Cross-skill links will 404 until you install it.";;
    *)
      temp_dir=$(mktemp -d)
      if git clone --depth 1 --quiet https://github.com/solana-foundation/solana-dev-skill.git "$temp_dir" 2>/dev/null; then
        cp -r "$temp_dir/skill" "$CORE_SKILL_PATH"; rm -rf "$temp_dir"
        echo -e "  ${GREEN}✓${NC} Core installed to $CORE_SKILL_PATH"
      else
        rm -rf "$temp_dir"; echo -e "  ${YELLOW}→${NC} Clone failed; install manually from github.com/solana-foundation/solana-dev-skill"
      fi;;
  esac
fi

# 3) Skill
[ -d "$SKILL_PATH" ] && rm -rf "$SKILL_PATH"
mkdir -p "$SKILL_PATH"
cp -r "$SOURCE_DIR"/. "$SKILL_PATH/"
echo -e "${GREEN}✓${NC} Skill installed to $SKILL_PATH"

# 4) Agents / commands / rules
read -p "Copy agents/, commands/, rules/ into ./.claude/ for this project? [y/N] " kit_reply
case "$kit_reply" in
  [yY]*)
    for d in agents commands rules; do
      mkdir -p "./.claude/$d"
      cp -r "$SCRIPT_DIR/$d/." "./.claude/$d/" 2>/dev/null || true
    done
    echo -e "  ${GREEN}✓${NC} Copied into ./.claude/"
    ;;
  *) echo -e "  ${YELLOW}→${NC} Skipped agents/commands/rules.";;
esac

echo
echo -e "${GREEN}Done.${NC}"
