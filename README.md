# 售前解决方案工作台

售前项目全流程管理 + 方案制作中心，**方案制作中心的对话与内容生成完全由自建 Hermes Agent（profile: `wordpresales`）接管**。

访问地址：<http://49.233.179.30:8088>

---

## 一、设计原则（为什么这么做）

服务器是腾讯云 4 核 4G，上面已经跑着 Hermes Agent、WeKnora 全家桶（含 Postgres/Redis）和 ollama，
可用内存只剩约 1GB。因此本项目的所有技术选择都围绕一个目标：**绝不把服务器挤爆**。

| 决策 | 原因 |
|---|---|
| **零构建**：前端是纯静态文件，不用 Vite/Webpack | 服务器 available 内存约 1GB，`npm build` 峰值 1–4GB 会 OOM 打死 Hermes |
| **零依赖**：BFF 只用 Node 内置模块 + Node 22 全局 `fetch`/`WebSocket` | 不需要 `npm install`，服务器上连 node/npm 都不用装 |
| **Docker 直跑**：`node:22-alpine` 挂载源码运行 | 无需构建镜像，无需装 nginx；主机环境保持干净 |
| **内存硬上限 320MB** | 容器 `--memory 320m`，确保永远不会侵占 Hermes/WeKnora |
| **端口 8088** | 主机 80 已被 `WeKnora-frontend` 占用，8080 被 `WeKnora-app` 占用 |
| **前端不直连 Hermes** | 凭证只存在 BFF 的 `.env`（600 权限），前端零接触 |

## 二、架构

```
浏览器（你 + 2-3 位同事）
   │  http://49.233.179.30:8088
   ▼
┌──────────────────────────────────────────────┐
│ Docker 容器 presales-workbench                │
│ node:22-alpine · --network host · 内存上限320M │
│                                              │
│  server/index.js   静态托管 frontend/         │
│                    POST /api/chat  → SSE 流式 │
│  server/hermes.js  Hermes 无头对话客户端      │
└───────────────┬──────────────────────────────┘
                │ 127.0.0.1:9119（不出公网）
                ▼
        Hermes Agent · profile=wordpresales
        模型 sensenova-6.8-flash-lite（公网 token 推理，本机零负担）

同机共存（本项目不碰）：WeKnora :80/:8080 · ollama :11434 · weknora-mcp-bridge :8082/:8083
```

## 三、目录结构

```
frontend/
  index.html            页面骨架（7 个模块）
  src/styles.css        样式
  src/main.js           原工作台全部业务逻辑（项目/知识库/C139/工具箱，未改动）
  src/hermes-chat.js    ★ 覆盖方案制作中心对话 → 走 BFF 调 Hermes（流式）
server/
  index.js              BFF：静态托管 + /api/chat(SSE) + /api/health + /api/reset
  hermes.js             Hermes 客户端 + 会话池（LRU 淘汰、TTL 回收）
  .env.example          配置样例（真实 .env 不入库）
deploy/
  setup.sh              服务器首次部署（幂等）
  presales-workbench.service   systemd 单元（包一层 docker run）
.github/workflows/deploy.yml   流水线：语法自检 → rsync → 重启 → 健康检查
```

## 四、Hermes 对话协议（实测确认）

```
1. POST /auth/password-login  {username,password,provider:"basic"}   → Set-Cookie
2. POST /api/auth/ws-ticket   （带 cookie，必须 POST，GET 会 404）     → {ticket}  TTL 30s
3. ws://host:9119/api/ws?ticket=xxx      协议为「换行分隔的 JSON-RPC」，每条必须以 \n 结尾
4. session.create {profile:"wordpresales",cols:120,source:...}        → result.session_id
5. prompt.submit  {session_id,text,profile}                          → 流式事件
```

事件流：

| 事件 `params.type` | 含义 | 前端处理 |
|---|---|---|
| `message.start` | 回合开始 | 忽略 |
| `thinking.delta` / `reasoning.delta` | 内部思考 | 只显示「专家正在思考…」，不展示内容 |
| `message.delta` | 正文增量，文本在 `payload.text` | 逐字追加到气泡 |
| `session.usage` | token 用量 | 记录 |
| **`message.complete`** | **回合结束**，`payload.text` 为完整正文 | 落库、结束 SSE |

## 五、部署

### 首次部署

```bash
# 服务器（root）
git clone https://github.com/wamgfemg/presales-workbench.git /root/presales-workbench
cd /root/presales-workbench
HERMES_PASS='你的Hermes控制台密码' bash deploy/setup.sh
```

然后在云控制台**安全组放行 TCP 8088**。

### 后续更新

推代码到 `main` 即自动部署。需要在仓库配置 3 个 Secrets：

| Secret | 值 |
|---|---|
| `SERVER_HOST` | `49.233.179.30` |
| `SERVER_USER` | `root` |
| `SSH_PRIVATE_KEY` | 部署私钥（对应公钥写入服务器 `~/.ssh/authorized_keys`） |

流水线做的事：语法自检 → `rsync` 同步 `frontend/ server/ deploy/` → 重启 systemd → 健康检查 → 打印内存占用。
**全程不在服务器上编译。**

## 六、运维命令

```bash
systemctl status presales-workbench          # 服务状态
journalctl -u presales-workbench -n 100 -f   # 实时日志
docker stats --no-stream presales-workbench  # 内存/CPU 占用
curl -s http://127.0.0.1:8088/api/health     # 健康检查（含 BFF 内存、会话数）
systemctl restart presales-workbench         # 重启
```

## 七、方案交互中心 · 文件上传分析

「方案制作中心」对话输入框的📎回形针按钮，可把本地文件直接发给 Hermes 分析（自动提取文本拼入 prompt）。

- **支持格式**：`txt / md / json / csv / docx / doc`
- **旧版 `.doc`（OLE2/CFB 复合文档，Word 97 格式）**：`server/extract.js` 内置纯 JS 的 CFB 解析器（`class CFB`）+ `extractDoc()`，兼容正文为「`WordDocument` 流中 `fcMin` 起连续 UTF-16LE 块」的老格式（本项目实测中信银行信创升级采购文件即此格式，提取 35000+ 中文字符）。
- **传输方式**：前端改为**原始二进制直传**（`application/octet-stream` + `x-filename` 头），不再 base64，省去 33% 体积膨胀，缓解代理对 POST 体大小的 413 拦截。
- **大小上限**：单文件 8MB（超过返回友好提示，建议压缩 / 转 docx / 直接粘贴文本）。
- **不支持的格式**：返回 415 并提示具体原因。

接口：`POST /api/chat/extract`，浏览器或任意 HTTP 客户端均可调用（兼容旧 JSON `{name, base64}` 入参）。

## 八、已知边界

- 业务数据（项目、知识库、C139）存在**浏览器 localStorage**，换浏览器不同步；侧边栏可导出/导入 JSON 备份。需要多人共享时再加后端存储。
- Hermes 重启会使 WS 会话失效，BFF 会自动重建并重试一次，用户侧只会看到「会话已失效，正在重建…」。
- ollama 目前未加载模型（仅 18MB）。若后续用它做知识库向量化，建议 bge-m3 量化版 + `OLLAMA_KEEP_ALIVE=0`，否则会与本应用争抢内存。
