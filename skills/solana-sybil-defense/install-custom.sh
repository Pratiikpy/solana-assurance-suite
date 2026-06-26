#!/bin/bash
# solana-sybil-defense - Interactive Installer
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/skill"

echo -e "${CYAN}solana-sybil-defense — interactive install${NC}"
echo
echo "Install location?"
echo "  1) Personal  (~/.claude/skills/solana-sybil-defense)   [default]"
echo "  2) Project   (./.claude/skills/solana-sybil-defense)"
echo "  3) Custom path"
read -p "Choice [1]: " loc
case "${loc:-1}" in
  2) SKILLS_DIR="$(pwd)/.claude/skills";;
  3) read -p "Enter skills dir: " c; SKILLS_DIR="$c";;
  *) SKILLS_DIR="$HOME/.claude/skills";;
esac
SKILL_PATH="$SKILLS_DIR/solana-sybil-defense"
CORE_SKILL_PATH="$SKILLS_DIR/solana-dev"
mkdir -p "$SKILLS_DIR"

if [ -d "$CORE_SKILL_PATH" ]; then
  echo -e "${GREEN}✓${NC} Core solana-dev present."
else
  read -p "Install core solana-dev skill? [Y/n] " r
  case "$r" in
    [nN]*) echo -e "${YELLOW}→${NC} Skipped core; cross-skill links 404 until installed.";;
    *) t=$(mktemp -d); git clone --depth 1 --quiet https://github.com/solana-foundation/solana-dev-skill.git "$t" 2>/dev/null \
         && { cp -r "$t/skill" "$CORE_SKILL_PATH"; echo -e "  ${GREEN}✓${NC} Core installed"; } \
         || echo -e "  ${YELLOW}→${NC} Clone failed; install manually."; rm -rf "$t";;
  esac
fi

[ -d "$SKILL_PATH" ] && rm -rf "$SKILL_PATH"
mkdir -p "$SKILL_PATH"; cp -r "$SOURCE_DIR"/. "$SKILL_PATH/"
echo -e "${GREEN}✓${NC} Skill installed to $SKILL_PATH"

read -p "Copy agents/, commands/, rules/ into ./.claude/ for this project? [y/N] " k
case "$k" in
  [yY]*) for d in agents commands rules; do mkdir -p "./.claude/$d"; cp -r "$SCRIPT_DIR/$d/." "./.claude/$d/" 2>/dev/null || true; done
         echo -e "  ${GREEN}✓${NC} Copied into ./.claude/";;
  *) echo -e "  ${YELLOW}→${NC} Skipped.";;
esac
echo; echo -e "${GREEN}Done.${NC}"
