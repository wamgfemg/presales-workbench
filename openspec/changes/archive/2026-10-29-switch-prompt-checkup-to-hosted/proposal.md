# Proposal: 提示词体检器改为封装线上托管版

## Why
此前体检器以本地副本 `frontend/tools/prompt-checkup.html` 封装。现在该工具已有线上托管版本
（https://vafrcvxs.qwenwork.host/ ，内容与本地版一致：同为「提示词体检器 · 王工版」，10 维度打分、
一键改写、报告导出、本地历史，纯浏览器运行）。
改为封装线上版，可以做到本地零副本：上游页面更新后工作台自动跟随，不必再手工同步文件。

## 阻塞点与解法（关键）
上游响应头带 CSP：
```
Content-Security-Policy: frame-ancestors https://qwenwork.cn https://alidocs.dingtalk.com https://*.sfcrmapps.cn https://*.sfcrmproducts.cn;
```
`49.233.179.30` 不在白名单，**直接把 src 换成该地址会被浏览器拒绝渲染**（Refused to frame）。
已核查上游页面为完全自包含（无外链脚本、无 fetch/XHR、无防嵌套 JS），因此采用反向代理绕过：
- nginx 新增 `location /pc/` 反代到 `https://vafrcvxs.qwenwork.host/`，并在代理层
  `proxy_hide_header Content-Security-Policy` 与 `X-Frame-Options`；
- iframe src 改为同源的 `/pc/`，嵌套限制随之消失。

## What Changes
- nginx：新增 `/pc/` 反代 location（含 SNI、Referer、proxy_redirect 与超时设置），配置已备份并 reload 生效。
- iframe：`data-src` 由 `./tools/prompt-checkup.html?theme=light` 改为 `/pc/`。
- 主题：托管版不支持 `?theme=` 参数（仅读 localStorage `pc-theme`）；因反代后同源，
  改为挂载前写入 `localStorage.pc-theme=light`（仅当用户未手动设置过），嵌入态仍为浅色。
- 「独立窗口打开」改为打开线上地址 `https://vafrcvxs.qwenwork.host/`。
- `frontend/tools/prompt-checkup.html` 保留但不再被引用，作为上游不可用时的回退副本。

## Impact
- 前端改动：index.html（iframe data-src）、src/main.js（pcMount/pcOpenStandalone）。
- 基础设施改动：/opt/nginx-conf/workbench.conf 新增 /pc/ location（已备份为 .bak-20261029104908）。
- 工作台首页与其它路由不受影响（/ 仍由 Node BFF 8088 提供，已验证 200）。
- 新增外部依赖：若上游不可达，该页 iframe 将空白；本地副本保留可作为应急回退。

## Out of Scope
- 不改动体检器自身评分逻辑（10 维度规则、改写、历史均沿用上游实现）。
- 不改为服务端渲染或接口集成；体检器仍为纯浏览器本地运行。
