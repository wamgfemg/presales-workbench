# prompt-checkup Specification

## Purpose
在「个人」菜单下以 iframe 封装一个独立的提示词体检器页面：粘贴提示词后按 10 个维度体检打分，给出命中项、缺失项、扣分原因与补齐建议，并可一键生成改写版、复制/导出 Markdown 报告、查看本地历史。页面纯浏览器本地运行，不调用后端接口、不落库、不上传数据。

## Requirements

### Requirement: 提示词体检器菜单入口
系统 SHALL 在左侧导航「个人」组提供「提示词体检器」菜单项，点击后切换到该页面。

#### Scenario: 从个人组进入体检器
- **WHEN** 用户展开左侧「个人」组并点击「提示词体检器」
- **THEN** 路由切换到 `promptcheck` 页，该导航项高亮为选中态

### Requirement: 体检器页面懒挂载
系统 SHALL 仅在首次进入该页面时才为 iframe 设置真实 src，避免工作台首屏额外加载该页面。

#### Scenario: 首次进入才加载
- **WHEN** 用户首次点击「提示词体检器」菜单
- **THEN** `pcMount()` 将 `data-src`（./tools/prompt-checkup.html?theme=light）赋给 iframe 的 src 并加载

#### Scenario: 二次进入不重复加载
- **WHEN** 用户切走后再切回该页面
- **THEN** iframe 已带 src，不再重新赋值，也不重新加载页面

### Requirement: 浅色主题嵌入
系统 SHALL 以 URL 参数 `theme=light` 加载体检器，使其默认呈现浅色主题，与工作台视觉一致。

#### Scenario: 嵌入态主题为浅色
- **WHEN** iframe 以 `?theme=light` 加载且用户此前未手动切换过主题
- **THEN** 体检器以浅色主题渲染

### Requirement: 重新加载与独立打开
系统 SHALL 在页头提供「↻ 重新加载」与「⧉ 独立窗口打开」两个操作。

#### Scenario: 重新加载
- **WHEN** 用户点击「↻ 重新加载」
- **THEN** iframe 的 src 被重新赋值以刷新页面，并提示「已重新加载」

#### Scenario: 独立窗口打开
- **WHEN** 用户点击「⧉ 独立窗口打开」
- **THEN** 在新标签页打开 ./tools/prompt-checkup.html

### Requirement: 体检器能力保持完整
系统 SHALL 以 iframe 原样承载体检器的全部能力：粘贴提示词、10 维度体检打分、命中/缺失/扣分说明、一键生成改写版、报告复制与 Markdown 导出、本地历史记录、主题切换。

#### Scenario: 页面自身功能可用
- **WHEN** 用户在 iframe 内粘贴提示词并执行体检
- **THEN** 展示评分与逐维度分析，并可生成改写版与导出报告，全部在浏览器本地完成、不请求后端
