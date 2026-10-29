# Tasks: 提示词体检器改为封装线上托管版

## 1. 可行性核查
- [x] 1.1 确认托管版内容与本地版一致（标题/描述/10 维度/改写版）
- [x] 1.2 确认无外链脚本、无 fetch/XHR、无防嵌套 JS（可安全反代）
- [x] 1.3 定位阻塞点：上游 CSP frame-ancestors 白名单不含 49.233.179.30

## 2. 反向代理
- [x] 2.1 备份 /opt/nginx-conf/workbench.conf
- [x] 2.2 新增 /pc/ location 反代并摘除 CSP / X-Frame-Options 响应头
- [x] 2.3 nginx -t 通过并 reload
- [x] 2.4 curl 验证 /pc/ 200、无 CSP 头、标题正确、首页 / 仍 200

## 3. 前端改造
- [x] 3.1 iframe data-src 改为同源 /pc/
- [x] 3.2 pcMount 挂载前写 localStorage pc-theme=light（仅未手动设置时）
- [x] 3.3 pcOpenStandalone 改为打开 https://vafrcvxs.qwenwork.host/
- [x] 3.4 main.js 语法检查通过

## 4. 部署与交付
- [x] 4.1 部署 index.html / main.js 到服务器，md5 与本地一致（四项全 PASS）
- [x] 4.2 线上验证 /pc/ 与首页可达、命中新 src、/pc/ 无 CSP 头、本地路径引用已清零
- [ ] 4.3 openspec 变更推送 GitHub 并归档
