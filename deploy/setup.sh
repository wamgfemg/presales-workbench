#!/usr/bin/env bash
# =============================================================================
# 服务器首次部署脚本（幂等，可重复执行）
#
# 用法（在服务器上以 root 执行）：
#   HERMES_PASS='xxxx' bash deploy/setup.sh
#
# 前提：服务器已装 Docker。无需 node / npm / nginx，全部零构建。
# =============================================================================
set -euo pipefail

APP_DIR=/opt/presales-workbench
IMAGE=node:22-alpine
PORT="${PORT:-8088}"
HERMES_URL="${HERMES_URL:-http://127.0.0.1:9119}"
HERMES_USER="${HERMES_USER:-admin}"
HERMES_PROFILE="${HERMES_PROFILE:-wordpresales}"
WEKNORA_URL="${WEKNORA_URL:-http://127.0.0.1:8080}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> 应用目录 $APP_DIR"
mkdir -p "$APP_DIR/data"

echo "==> 同步应用文件"
cp -r "$SRC_DIR/frontend" "$APP_DIR/"
cp -r "$SRC_DIR/server" "$APP_DIR/"

echo "==> 写入 .env（权限 600，不进仓库）"
if [ -z "${HERMES_PASS:-}" ] && [ -f "$APP_DIR/.env" ]; then
  echo "    已存在 .env 且未传入 HERMES_PASS，保留原有凭证"
else
  : "${HERMES_PASS:?必须提供 HERMES_PASS（Hermes 控制台密码）}"
  # 保留已有 WeKnora 配置，避免重复 setup 时覆盖
  if [ -f "$APP_DIR/.env" ]; then
    WEKNORA_API_KEY="${WEKNORA_API_KEY:-$(grep '^WEKNORA_API_KEY=' "$APP_DIR/.env" | cut -d= -f2-)}"
    WEKNORA_KB_ID="${WEKNORA_KB_ID:-$(grep '^WEKNORA_KB_ID=' "$APP_DIR/.env" | cut -d= -f2-)}"
  fi
  cat > "$APP_DIR/.env" <<EOF
PORT=$PORT
BIND_HOST=0.0.0.0
FRONT_DIR=/app/frontend
DATA_DIR=/app/data
HERMES_URL=$HERMES_URL
HERMES_USER=$HERMES_USER
HERMES_PASS=$HERMES_PASS
HERMES_PROFILE=$HERMES_PROFILE
HERMES_MAX_SESSIONS=8
HERMES_SESSION_TTL_MS=2700000
WEKNORA_URL=$WEKNORA_URL
WEKNORA_API_KEY=${WEKNORA_API_KEY:-}
WEKNORA_KB_ID=${WEKNORA_KB_ID:-}
NODE_OPTIONS=--max-old-space-size=192
EOF
  chmod 600 "$APP_DIR/.env"
fi

echo "==> 确认镜像 $IMAGE"
docker image inspect "$IMAGE" >/dev/null 2>&1 || docker pull "$IMAGE"

echo "==> 安装 systemd 服务"
cp "$SRC_DIR/deploy/presales-workbench.service" /etc/systemd/system/presales-workbench.service
systemctl daemon-reload
systemctl enable presales-workbench
systemctl restart presales-workbench

echo "==> 等待启动"
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "    健康检查通过"
    break
  fi
  sleep 1
done

echo
echo "===== 状态 ====="
systemctl --no-pager -l status presales-workbench | head -15 || true
echo
curl -sS "http://127.0.0.1:$PORT/api/health" || echo "健康检查失败，请看 journalctl -u presales-workbench -n 50"
echo
echo "完成。请确认云厂商安全组已放行 TCP $PORT"
