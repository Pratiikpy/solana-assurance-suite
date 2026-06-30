#!/usr/bin/env bash
# solana-loops — the shared loop driver. Fresh agent session per iteration; progress lives in
# state files + git, never the context window; the Stop-gate (not the model) decides "done".
# Windows Git Bash compatible (no GNU `timeout`, no `sed -i`). Modeled on the author's own run.sh.
#
#   bash run.sh <loop-dir> [start] [max-sessions]
#
# <loop-dir> contains:
#   PROMPT.md         the loop directive (prd-to-product | audit | ship-it) — the verbatim contract
#   loop.json         the checklist the Stop-gate re-verifies   (items + verify specs)
#   MEMORY.md         long-term notes carried across sessions
#   PROGRESS.md       what each session closed (append-only)
#   COVERAGE.md       coverage-as-a-contract (the run fails if a required cell is unreviewed)
#   skills/*.md       reference skills concatenated into the prompt (claude -p has no filesystem)
#   logs/session-N.log
set -euo pipefail

LOOP_DIR="${1:?usage: bash run.sh <loop-dir> [start] [max-sessions]}"
START="${2:-1}"
MAX_SESSIONS="${3:-50}"          # guardrail: hard cap (a loop with no cap can burn $500/hr)
STUCK_LIMIT="${STUCK_LIMIT:-3}"  # guardrail: same failing set N times -> stop + surface
MAX_TURNS="${MAX_TURNS:-80}"     # per-session turn cap (prevents a single runaway session)
MODEL="${MODEL:-claude-opus-4-8}"
AGENT="${AGENT:-claude}"         # the coding-agent CLI (claude / codex)
GATE="$(cd "$(dirname "$0")" && pwd)/stop-gate.mjs"

mkdir -p "$LOOP_DIR/logs"
green(){ printf '\033[0;32m%s\033[0m\n' "$1"; }; yellow(){ printf '\033[1;33m%s\033[0m\n' "$1"; }; red(){ printf '\033[0;31m%s\033[0m\n' "$1"; }

for (( s=START; s<=START+MAX_SESSIONS-1; s++ )); do
  # 1) DONE? — the gate re-verifies from ground truth and overrides any self-reported "done".
  if node "$GATE" "$LOOP_DIR" --max "$MAX_SESSIONS" --stuck "$STUCK_LIMIT"; then
    green "All items verified. Loop complete."; exit 0
  else
    rc=$?
    if [ "$rc" -eq 2 ]; then red "Guardrail tripped — stopping and surfacing to operator (see output above)."; exit 2; fi
  fi

  yellow "── session $s ──"
  # 2) Build the prompt: directive + concatenated skills + current state (fresh context each time).
  PROMPT="$(cat "$LOOP_DIR/PROMPT.md"; echo; for f in "$LOOP_DIR"/skills/*.md; do [ -f "$f" ] && { echo "=== skill: $(basename "$f") ==="; cat "$f"; }; done; echo; echo "=== MEMORY.md ==="; cat "$LOOP_DIR/MEMORY.md" 2>/dev/null; echo "=== PROGRESS.md (tail) ==="; tail -n 60 "$LOOP_DIR/PROGRESS.md" 2>/dev/null; echo "=== COVERAGE.md ==="; cat "$LOOP_DIR/COVERAGE.md" 2>/dev/null)"

  # 3) One fresh agent session. It must update loop.json / MEMORY / PROGRESS / COVERAGE and commit.
  printf '%s' "$PROMPT" | "$AGENT" -p --model "$MODEL" --max-turns "$MAX_TURNS" \
    > "$LOOP_DIR/logs/session-$s.log" 2>&1 || yellow "session $s exited non-zero (continuing; the gate decides done)"
done

red "Reached MAX_SESSIONS ($MAX_SESSIONS) without all items verified. Surfacing remaining work."
node "$GATE" "$LOOP_DIR" --max "$MAX_SESSIONS" --stuck "$STUCK_LIMIT" || true
exit 2
