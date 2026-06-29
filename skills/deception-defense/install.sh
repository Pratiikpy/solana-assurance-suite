#!/bin/bash
# deception-defense - Standard Installer
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/skill"
SKILLS_DIR="$HOME/.claude/skills"
SKILL_PATH="$SKILLS_DIR/deception-defense"

SKIP_CONFIRM=false
while [[ $# -gt 0 ]]; do
  case $1 in
    -y|--yes) SKIP_CONFIRM=true; shift;;
    -h|--help) echo "Usage: ./install.sh [-y|--yes]"; exit 0;;
    *) echo "Unknown option: $1"; exit 1;;
  esac
done

echo -e "${CYAN}deception-defense${NC} — catch the lie before a judge or user does."
echo "Installs: deception-defense → $SKILL_PATH"
echo "Hunts: optimistic-success, fake badges, no-op ceremonies, dead CTAs, fabricated metrics, fake verification, mock-as-real."
echo
if [ "$SKIP_CONFIRM" = false ]; then
  read -p "Continue? [Y/n] " reply
  case "$reply" in [nN]*) echo "Aborted."; exit 0;; esac
fi

mkdir -p "$SKILLS_DIR" "$HOME/.claude"

echo -e "${CYAN}[1/1]${NC} Installing deception-defense skill..."
[ -d "$SKILL_PATH" ] && rm -rf "$SKILL_PATH"
mkdir -p "$SKILL_PATH"
cp -r "$SOURCE_DIR"/. "$SKILL_PATH/"
# ship the scanner + proof alongside skill/ so the documented `tools/...` path resolves after install
[ -d "$SCRIPT_DIR/tools" ] && cp -r "$SCRIPT_DIR/tools" "$SKILL_PATH/"
[ -d "$SCRIPT_DIR/examples" ] && cp -r "$SCRIPT_DIR/examples" "$SKILL_PATH/"
echo -e "  ${GREEN}✓${NC} Installed to $SKILL_PATH (skill/ + tools/ + examples/)"

echo
echo -e "${GREEN}Installation complete.${NC}"
echo "Try asking Claude:"
echo "  • \"scan this app for anything claiming success it can't back up\""
echo "  • \"pre-demo check — is any badge, button, or number faking it\""
echo "  • \"does this deposit flow paint green on a reverted tx\""
echo
echo "Runnable scanner: tools/deception-scan/  ·  Verified proof: examples/planted-deception/ (precision 1.000)"
