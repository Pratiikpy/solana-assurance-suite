#!/bin/bash
# Solana Assurance Suite - aggregate installer.
# Installs all six sub-skills (or a named subset) into ~/.claude/skills, plus the core
# solana-dev skill once. Each sub-skill is also independently installable from its folder.
#
#   ./install.sh                         # install all six
#   ./install.sh testing qa sybil        # install a subset (shortnames below)
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DIR="$HOME/.claude/skills"
CORE_SKILL_PATH="$SKILLS_DIR/solana-dev"

# shortname -> repo folder under skills/
declare -A MAP=(
  [testing]=solana-testing-skill
  [qa]=solana-qa-automation-skill
  [sybil]=solana-sybil-defense
  [attestations]=solana-attestations-skill
  [agent-eval]=solana-agent-eval-skill
  [bridge]=solana-bridge-skill
)

# installed skill name = folder minus a trailing "-skill"
installed_name() { echo "${1%-skill}"; }

# selection: all if no args, else the named subset
if [ $# -eq 0 ]; then
  SELECTED=(testing qa sybil attestations agent-eval bridge)
else
  SELECTED=("$@")
fi

mkdir -p "$SKILLS_DIR" "$HOME/.claude"

echo -e "${CYAN}Solana Assurance Suite${NC} — the verification & ship-safety layer."
echo "Installing: ${SELECTED[*]}"
echo

# Core dependency once
echo -e "${CYAN}[core]${NC} Ensuring solana-dev skill..."
if [ -d "$CORE_SKILL_PATH" ]; then
  echo -e "  ${GREEN}✓${NC} present"
else
  t=$(mktemp -d)
  if git clone --depth 1 --quiet https://github.com/solana-foundation/solana-dev-skill.git "$t" 2>/dev/null; then
    cp -r "$t/skill" "$CORE_SKILL_PATH"; echo -e "  ${GREEN}✓${NC} installed"
  else
    echo -e "  ${YELLOW}→${NC} install manually: github.com/solana-foundation/solana-dev-skill"
  fi
  rm -rf "$t"
fi

for key in "${SELECTED[@]}"; do
  folder="${MAP[$key]}"
  if [ -z "$folder" ]; then echo -e "  ${YELLOW}→${NC} unknown skill '$key' (testing|qa|sybil|attestations|agent-eval|bridge)"; continue; fi
  src="$SCRIPT_DIR/skills/$folder/skill"
  name="$(installed_name "$folder")"
  dest="$SKILLS_DIR/$name"
  [ -d "$src" ] || { echo -e "  ${YELLOW}→${NC} $folder missing"; continue; }
  [ -d "$dest" ] && rm -rf "$dest"
  mkdir -p "$dest"; cp -r "$src"/. "$dest/"
  echo -e "  ${GREEN}✓${NC} $name -> $dest"
done

echo
echo -e "${GREEN}Done.${NC} Open each skill's SKILL.md, or route from the suite hub (SKILL.md)."
echo "Capstone: drive a launch through solana-qa-automation's release gate."
