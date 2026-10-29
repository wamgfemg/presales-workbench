# Design: 提示词体检器改为封装线上托管版

## 背景：直连不可行
上游 `https://vafrcvxs.qwenwork.host/` 响应头含：
```
Content-Security-Policy: frame-ancestors https://qwenwork.cn https://alidocs.dingtalk.com https://*.sfcrmapps.cn https://*.sfcrmproducts.cn;
```
工作台域名不在白名单，浏览器会直接拒绝渲染 iframe（Refused to frame）。这不是能被前端绕过的限制 ——
`frame-ancestors` 由浏览器强制执行，前端无法改写上游响应头。

## 决策一：反向代理而非放弃封装
先核查上游页面形态，确认可安全反代：
- 完全自包含（66KB 单页，内联 CSS/JS），无外链 script/link；
- 无 `fetch` / `XMLHttpRequest` / `/api` 调用；
- 无 `top.location`、`window.top`、`frameElement`、`parent.postMessage` 等防嵌套 JS。

结论：不存在同源策略或跨源接口问题，唯一障碍就是响应头。
因此用 nginx `location /pc/` 反代，并在代理层摘除 `Content-Security-Policy` 与 `X-Frame-Options`，
使 iframe 以同源路径 `/pc/` 加载，嵌套限制自然消失。

## 决策二：主题改为 localStorage 注入
托管版是上游原版，**不支持**本地副本加过的 `?theme=` 参数（已 grep 确认无 `URLSearchParams`），
只读取 localStorage 键 `pc-theme`。
反代后页面与工作台同源，localStorage 共享，因此改为：挂载前若用户未设置过主题就写入 `pc-theme=light`。
既保持嵌入态浅色，又尊重用户后续在页内的手动切换（不覆盖已有值）。

## 决策三：保留本地副本作为回退
`frontend/tools/prompt-checkup.html` 保留但不再被引用。
反代引入了外部依赖（上游不可达则 iframe 空白），
保留本地副本使得回滚只需把 `data-src` 改回一个值，无需重新搬运文件。

## 配置要点
- `proxy_pass` 带尾斜杠，`/pc/` 映射到上游 `/`；
- `proxy_ssl_server_name on`（上游为阿里云 ESA，需 SNI）；
- `proxy_set_header Host` 指向上游域名，避免被当作非法 Host 拒绝；
- `proxy_redirect` 显式回写，避免跳转时暴露上游地址；
- 不设 `resolver`：静态主机名在 nginx 启动时解析，上游 IP 变更时需 reload。

## 风险
- 上游不可用 → 该页空白（缓解：本地副本一键回退）。
- 上游页面若后续引入跨源接口调用，反代形态下可能被同源策略拦截，需届时补充代理路径。
