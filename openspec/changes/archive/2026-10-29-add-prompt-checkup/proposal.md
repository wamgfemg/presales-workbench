# Proposal: 个人 · 提示词体检器

## Why
售前日常大量使用提示词驱动 Hermes / 各类 Agent 产出标书与方案，但提示词质量全凭经验，
缺少可复用的自检手段：不知道命中了哪些要素、缺什么、为什么扣分、该怎么补。
现有一个独立的「提示词体检器」页面（10 维度打分 + 一键改写 + 报告导出，纯本地运行），
但散落在工作台之外，需要单独打开，无法融入日常动线。
将其以 iframe 封装进工作台「个人」菜单，使提示词自检成为随手可用的能力。

## What Changes
- 左侧导航「个人」组新增「提示词体检器」菜单项（data-p="promptcheck"）。
- 新增页面段 `<section class="page" id="p-promptcheck">`，以 iframe 嵌入体检器页面。
- 体检器页面落盘为 `frontend/tools/prompt-checkup.html`（由外部独立页面原样引入，仅增强主题参数支持）。
- 路由 show('promptcheck') → pcMount()：首次进入才设置 iframe src，避免首屏额外加载。
- 页头提供「↻ 重新加载」与「⧉ 独立窗口打开」两个操作。
- iframe 通过 URL 参数 `?theme=light` 指定浅色主题，与工作台视觉保持一致。

## Impact
- 仅前端改动：index.html（导航项 + 页面段）、src/main.js（pcMount/pcReload/pcOpenStandalone + show 钩子）、src/styles.css（.pc-frame）、新增 tools/prompt-checkup.html。
- 体检器为纯静态、纯前端、纯本地运行页面，不调用任何后端接口，不落库、不上传，对既有数据与鉴权零影响。
- 静态子路径（/tools/…）已实测由 Node BFF 正常服务（HTTP 200）。

## Out of Scope
- 不重写体检器内部逻辑（10 维度评分规则、改写生成、历史记录均保持原样）。
- 不把体检结果纳入工作台持久化体系（仍使用体检器自身的 localStorage 历史）。
- 不改动后端鉴权、同步链路与 SQLite schema。
