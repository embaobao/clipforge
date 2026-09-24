#!/bin/bash
# ClipForge 逐交互视觉走查 + 性能采样入口：要求 dev server 运行在 :7100。
set -euo pipefail
cd "$(dirname "$0")/.."
if ! curl -sf -o /dev/null http://localhost:7100/preview.html; then
  echo "dev server 未运行，请先执行：pnpm dev --port 7100" >&2
  exit 1
fi
mkdir -p /tmp/clipforge-visual/audit
exec ego-browser nodejs < scripts/visual-audit.js
