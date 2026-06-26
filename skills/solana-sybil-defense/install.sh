#!/bin/bash
# solana-sybil-defense - Standard Installer
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/skill"
SKILLS_DIR="$HOME/.claude/skills"
SKILL_PATH="$SKILLS_DIR/solana-sybil-defense"
CORE_SKILL_PATH="$SKILLS_DIR/solana-dev"

SKIP_CONFIRM=false
while [[ $# -gt 0 ]]; do
  case $1 in
    -y|--yes) SKIP_CONFIRM=true; shift;;
    -h|--help) echo "Usage: ./install.sh [-y|--yes]"; exit 0;;
    *) echo "Unknown option: $1"; exit 1;;
  esac
done

echo -e "${CYAN}solana-sybil-defense${NC} — fair airdrops, without the farms."
echo "Installs: solana-sybil-defense → $SKILL_PATH (+ solana-dev core if missing)."
echo "Composes with solana-attestations (proof-of-human) and solana-testing."
echo
if [ "$SKIP_CONFIRM" = false ]; then
  read -p "Continue? [Y/n] " reply
  case "$reply" in [nN]*) echo "Aborted."; exit 0;; esac
fi

mkdir -p "$SKILLS_DIR" "$HOME/.claude"

echo -e "${CYAN}[1/2]${NC} Ensuring core solana-dev skill..."
if [ -d "$CORE_SKILL_PATH" ]; then
  echo -e "  ${GREEN}✓${NC} Already present"
else
  temp_dir=$(mktemp -d)
  if git clone --depth 1 --quiet https://github.com/solana-foundation/solana-dev-skill.git "$temp_dir" 2>/dev/null; then
    cp -r "$temp_dir/skill" "$CORE_SKILL_PATH"; rm -rf "$temp_dir"
    echo -e "  ${GREEN}✓${NC} Installed to $CORE_SKILL_PATH"
  else
    rm -rf "$temp_dir"; echo -e "  ${YELLOW}→${NC} Install core manually: github.com/solana-foundation/solana-dev-skill"
  fi
fi

echo -e "${CYAN}[2/2]${NC} Installing solana-sybil-defense skill..."
[ -d "$SKILL_PATH" ] && rm -rf "$SKILL_PATH"
mkdir -p "$SKILL_PATH"
cp -r "$SOURCE_DIR"/. "$SKILL_PATH/"
echo -e "  ${GREEN}✓${NC} Installed to $SKILL_PATH"

echo
echo -e "${GREEN}Installation complete.${NC}"
echo "Try asking Claude:"
echo "  • \"is my airdrop being farmed — scan these participants\""
echo "  • \"build a fair eligibility list and merkle distribution\""
echo "  • \"audit this airdrop allowlist for false positives\""
echo
echo "Runnable engine: tools/sybil-scan/  ·  Verified proof: examples/planted-cluster/"
