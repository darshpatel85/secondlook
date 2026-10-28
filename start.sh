#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

job="gui/$(id -u)/com.ai-review.dev"
log="$HOME/Library/Logs/ai-review.log"

if [ -z "${AI_REVIEW_LAUNCHD:-}" ] && launchctl print "$job" >/dev/null 2>&1; then
  echo "Restarting the startup job (logs: $log)"
  launchctl kickstart -k "$job"
  echo "API: http://localhost:4100"
  echo "Web: http://localhost:5173"
  exec tail -n 0 -f "$log"
fi

for port in 4100 5173; do
  pids=$(lsof -ti tcp:"$port" -sTCP:LISTEN || true)
  if [ -n "$pids" ]; then
    echo "Stopping process on port $port"
    kill $pids
  fi
done

if [ ! -d node_modules ]; then
  pnpm install
fi

echo "API: http://localhost:4100"
echo "Web: http://localhost:5173"
exec pnpm dev
