# Tasks: 个人 · 提示词体检器

## 1. 静态页面引入
- [x] 1.1 将外部提示词体检器页面引入为 frontend/tools/prompt-checkup.html
- [x] 1.2 为主题初始化增加 ?theme= URL 参数优先级（高于 localStorage 与系统偏好）
- [x] 1.3 确认 Node BFF 能服务静态子目录（/tools/ 返回 200）

## 2. 导航与页面骨架
- [x] 2.1 左侧「个人」组新增「提示词体检器」按钮（data-p="promptcheck"）
- [x] 2.2 新增 <section class="page" id="p-promptcheck"> 页面段与 iframe 容器
- [x] 2.3 页头提供「重新加载」「独立窗口打开」操作

## 3. 挂载与样式
- [x] 3.1 pcMount() 懒挂载（data-src → src），show() 增加 promptcheck 钩子
- [x] 3.2 pcReload() / pcOpenStandalone()
- [x] 3.3 styles.css 新增 .pc-frame（高度自适应 + 圆角边框）

## 4. 验证与交付
- [x] 4.1 main.js 语法检查通过
- [x] 4.2 部署至 /opt/presales-workbench/frontend，md5 与本地一致（index.html/main.js/styles.css/tools 四项全 PASS）
- [x] 4.3 curl 验证 /tools/prompt-checkup.html 与首页均 200，线上命中新菜单
- [x] 4.4 openspec/ 与前端改动推送 GitHub（5ce99fa..c7968d9 → main）
