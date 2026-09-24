#!/bin/bash
# ClipForge 交互/功能回归入口：要求 dev server 运行在 :7100。
# 用法：bash scripts/run-interaction-tests.sh
set -euo pipefail
cd "$(dirname "$0")/.."
if ! curl -sf -o /dev/null http://localhost:7100/preview.html; then
  echo "dev server 未运行，请先执行：pnpm dev --port 7100" >&2
  exit 1
fi
mkdir -p /tmp/clipforge-visual
exec ego-browser nodejs < scripts/interaction-regression.js
