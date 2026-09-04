#!/usr/bin/env bash
#
# 抖音发布服务 —— 启动脚本
#
# 启动随附的 Python 发布服务（social-auto-upload 的 Web 后端），供 FeedFuse 的
# 抖音发布页面通过 /api/publish/douyin/* 转发调用。服务默认监听 127.0.0.1:5409。
#
# 用法：
#   bash scripts/start-douyin-publish.sh
#
# 首次运行会自动：创建虚拟环境 -> 安装依赖 -> 安装 Playwright Chromium -> 初始化数据库。
set -euo pipefail

SERVICE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../vendor/douyin-publish-service" && pwd)"
VENV_DIR="$SERVICE_DIR/.venv"
PYTHON_BIN="$VENV_DIR/bin/python"
PIP_BIN="$VENV_DIR/bin/pip"

cd "$SERVICE_DIR"

# 1. 虚拟环境
if [ ! -x "$PYTHON_BIN" ]; then
  echo "==> 创建 Python 虚拟环境"
  python3 -m venv "$VENV_DIR"
fi

# 2. 依赖
echo "==> 安装 Python 依赖"
"$PIP_BIN" install -r requirements.txt --quiet

# 3. 浏览器驱动（登录走 playwright，发布走 patchright）
PLAYWRIGHT_BIN="$VENV_DIR/bin/playwright"
PATCHRIGHT_BIN="$VENV_DIR/bin/patchright"
echo "==> 安装 Playwright Chromium（登录）"
"$PLAYWRIGHT_BIN" install chromium
echo "==> 安装 Patchright Chromium（发布）"
"$PATCHRIGHT_BIN" install chromium

# 4. 初始化数据库与运行目录
mkdir -p "$SERVICE_DIR/videoFile" "$SERVICE_DIR/cookiesFile"
if [ ! -f "$SERVICE_DIR/db/database.db" ]; then
  echo "==> 初始化 SQLite 数据库"
  (cd "$SERVICE_DIR/db" && "$PYTHON_BIN" createTable.py)
fi

# 5. 启动服务
echo "==> 启动抖音发布服务 http://127.0.0.1:5409"
exec "$PYTHON_BIN" sau_backend.py
