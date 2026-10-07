#!/bin/bash
# 双击即可启动 青匣 · 包装设计智能体
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js，请先安装：https://nodejs.org （需要 20.16+ 或 22.3+）"
  read -n 1 -s -r -p "按任意键退出"
  exit 1
fi
if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major === 20 && minor >= 16 || major === 22 && minor >= 3 || major > 22 ? 0 : 1)'; then
  echo "Node.js 版本不兼容，请升级到 20.16+（20.x）或 22.3+。"
  read -n 1 -s -r -p "按任意键退出"
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "首次运行，正在安装依赖……"
  npm install --silent || { echo "依赖安装失败"; read -n 1 -s -r; exit 1; }
fi
PORT=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2)
PORT=${PORT:-3789}
(sleep 1.5 && open "http://localhost:$PORT") &
node server.js
