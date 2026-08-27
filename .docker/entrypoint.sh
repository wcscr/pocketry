#!/bin/sh
set -e

# ---------------------------------------------------------------------------
# Bootstrap node_modules if empty (first run with a fresh named volume).
# node_modules lives in a Docker named volume (see start_claude), so the
# container keeps its own Linux-native binaries (esbuild, bufferutil) and
# never mixes with a macOS host install.
# ---------------------------------------------------------------------------
if [ ! -f "/workspace/node_modules/.package-lock.json" ]; then
  echo "[entrypoint] Installing dependencies (npm ci) ..."
  npm ci --no-audit --no-fund
else
  echo "[entrypoint] node_modules present — syncing with lockfile ..."
  npm install --prefer-offline --no-audit --no-fund
fi

echo "[entrypoint] Node: $(node --version), npm: $(npm --version)"

# ---------------------------------------------------------------------------
# Ensure Claude Code settings survive the bind-mount that overlays the
# build-time /home/agent/.claude directory.
# ---------------------------------------------------------------------------
mkdir -p "$HOME/.claude"
if [ ! -f "$HOME/.claude/settings.json" ]; then
  cat > "$HOME/.claude/settings.json" <<'SETTINGS'
{"skipDangerousModePermissionPrompt":true,"env":{"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS":"1"},"teammateMode":"tmux"}
SETTINGS
  echo "[entrypoint] Wrote $HOME/.claude/settings.json"
fi

# Verify claude is available before handing off to tmux.
if ! command -v claude >/dev/null 2>&1; then
  echo "[entrypoint] ERROR: 'claude' not found on PATH" >&2
  echo "[entrypoint] PATH=$PATH" >&2
  echo "[entrypoint] Dropping to shell for debugging." >&2
  exec bash
fi
echo "[entrypoint] claude CLI: $(claude --version 2>&1 || true)"

# ---------------------------------------------------------------------------
# Launch Claude inside tmux.
# Wrap in a shell so that if claude exits (error, auth failure, etc.) we
# land in bash instead of losing the tmux session (and with it, the error).
# ---------------------------------------------------------------------------
CLAUDE_CMD='claude --dangerously-skip-permissions'

launch_in_tmux() {
  exec tmux new-session -s claude \
    "echo '[tmux] Starting claude ...'; ${CLAUDE_CMD} $*; echo; echo '[tmux] claude exited (\$?)  —  dropping to bash'; exec bash"
}

if [ "$#" -eq 0 ]; then
  launch_in_tmux
fi

case "$1" in
  bash|sh)
    exec "$@"
    ;;
  *)
    launch_in_tmux "$@"
    ;;
esac
