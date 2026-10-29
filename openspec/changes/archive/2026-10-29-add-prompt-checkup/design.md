# Design: 个人 · 提示词体检器

## 决策一：iframe 封装而非重写
体检器是一个自包含的单页（HTML + 内联 CSS + 内联 JS，约 38KB），自带 10 维度评分引擎、
改写生成器、报告导出与本地历史。工作台前端是 vanilla JS、无构建步骤。
重写为工作台原生组件成本高、且会与上游页面产生两份逻辑需要长期同步。
iframe 同源嵌入可零改造复用全部能力，后续上游页面升级只需替换一个文件。

## 决策二：URL 参数控制主题，而非改默认值
体检器默认深色，工作台为浅色，直接嵌入会视觉割裂。
方案是在页面副本的主题初始化处增加 URL 参数优先级：`?theme=light` > localStorage > prefers-color-scheme。
这样既不破坏独立打开时的原有行为，又能让嵌入态跟随工作台主题，用户仍可在页内手动切换。

## 决策三：懒挂载 iframe
页面段先以 `src="about:blank"` 占位，真实地址写在 `data-src` 上；
只有 `show('promptcheck')` 触发 `pcMount()` 时才赋值 src。
避免工作台首屏额外加载一个 38KB 页面及其脚本。

## 决策四：静态资源路径
Node BFF 以 FRONT_DIR 为根提供静态文件，实测子目录（/tools/…）返回 200，
因此体检器页面放在 `frontend/tools/prompt-checkup.html`，与 `frontend/src/` 互不干扰。

## 风险与缓解
- 若 iframe 内脚本抛错，不影响宿主页面（iframe 隔离）。
- 体检器历史存于自身 localStorage 键 `pc-history`（与工作台按账号分桶的键不同名），无冲突。
- 若后续需嵌入更多外部工具，沿用 `frontend/tools/` + iframe + 懒挂载这一模式即可。
