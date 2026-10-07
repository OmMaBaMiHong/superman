#!/usr/bin/env bash
# ============================================================
# SAU 发布执行器（vendor/douyin-publish-service）启动脚本
#
# 作用：把扫码 cookie 授权的浏览器执行器跑起来（:5409），
#       并配置向 Superman 插件回推登录结果的回调。
#
# 密钥单一来源：~/.dsh/.env 的 SAU_TOKEN（与 DSH 插件进程共用同一把，
#               插件侧由 DSH home env 注入；改密钥后两边都要重启）。
#
# 用法：scripts/sau-executor.sh {start|stop|status|logs}
# ============================================================
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXECUTOR_DIR="$PROJECT_ROOT/vendor/douyin-publish-service"
PID_FILE="$EXECUTOR_DIR/.executor.pid"
LOG_FILE="$EXECUTOR_DIR/logs/executor.log"

# DSH 桌面端 webserver 端口（插件 /s/api 所在）；换端口时用环境变量覆盖
SAU_CALLBACK_URL="${SAU_CALLBACK_URL:-http://127.0.0.1:19387/s/api/platform-accounts/sau/callback}"

load_token() {
  if [ -f "$HOME/.dsh/.env" ]; then
    # shellcheck disable=SC1090
    SAU_TOKEN="$(grep -E '^SAU_TOKEN=' "$HOME/.dsh/.env" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
  fi
  if [ -z "${SAU_TOKEN:-}" ]; then
    echo "✗ 未找到 SAU_TOKEN：请在 ~/.dsh/.env 里配置（与 DSH 插件进程同一把密钥）" >&2
    exit 1
  fi
}

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

case "${1:-status}" in
  start)
    if is_running; then
      echo "✓ 执行器已在运行（pid $(cat "$PID_FILE")，:5409）"
      exit 0
    fi
    load_token
    mkdir -p "$EXECUTOR_DIR/logs"
    echo "启动 SAU 执行器（:5409，回调 → ${SAU_CALLBACK_URL}）…"
    (cd "$EXECUTOR_DIR" && \
      SAU_TOKEN="$SAU_TOKEN" SAU_CALLBACK_URL="$SAU_CALLBACK_URL" \
      nohup .venv/bin/python sau_backend.py >> "$LOG_FILE" 2>&1 & echo $! > "$PID_FILE")
    sleep 2
    if is_running && curl -sf -o /dev/null http://127.0.0.1:5409/ 2>/dev/null || curl -sf -o /dev/null http://127.0.0.1:5409/getValidAccounts 2>/dev/null; then
      echo "✓ 执行器已就绪：http://127.0.0.1:5409"
    else
      echo "△ 进程已起（pid $(cat "$PID_FILE")）；健康检查未即时通过，看日志：scripts/sau-executor.sh logs"
    fi
    ;;
  stop)
    if is_running; then
      kill "$(cat "$PID_FILE")" && rm -f "$PID_FILE"
      echo "✓ 已停止"
    else
      echo "△ 未在运行"
      rm -f "$PID_FILE"
    fi
    ;;
  status)
    if is_running; then
      echo "✓ 运行中（pid $(cat "$PID_FILE")）"
    else
      echo "✗ 未运行"
      exit 1
    fi
    ;;
  logs)
    tail -n 40 "$LOG_FILE"
    ;;
  *)
    echo "用法：$0 {start|stop|status|logs}" >&2
    exit 1
    ;;
esac
