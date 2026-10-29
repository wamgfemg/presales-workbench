# Data Model Specification

## Purpose
定义工作台前端单一状态对象 `store` 的结构、按账号分桶的持久化机制、全局年度口径，以及自由 KV 扩展位，作为所有业务模块的数据真相源。

## Requirements

### Requirement: 单一状态对象与初始结构
系统 SHALL 维护一个全局 `store` 对象，包含项目(projects)、向量知识库(kb, kbTree)、方案任务(docs, tasks)、项目文档(pdocs)、检查清单(checklists)、干系人/决策链(stakeholders)、合同(contracts)、报价(quotations)、竞争情报(compintel)、需求(requirements)、客户情报(custintel)、组织资产(orgassets)、跟进(followups)、自由KV(ui) 与工时(timesheets)。缺失字段 SHALL 在 load() 时以默认值补齐。

#### Scenario: 首次加载补齐缺省字段
- **WHEN** 浏览器 localStorage 中无数据或缺少某字段
- **THEN** load() 注入缺省空结构（如 compintel:[]、ui:{}），避免后续访问 undefined 报错

### Requirement: 按账号命名空间分桶
系统 SHALL 以 `presales_workbench_v5_<userId>` 为 localStorage key，使同一浏览器多账号数据互不串扰；当前用户 `ME` 由 auth.js 注入并在 bootApp 时赋值。

#### Scenario: 多账号数据隔离
- **WHEN** 用户 A 与用户 B 在同一浏览器先后登录
- **THEN** 各自读取对应 userId 命名空间的 store，互不可见对方项目与情报

### Requirement: 持久化与同步
任何写操作 SHALL 调用 persist()，persist() 先将 store 序列化写入 localStorage，再调用 schedulePush() 异步同步到服务端。

#### Scenario: 编辑后落库与同步
- **WHEN** 用户在任意模块新增/修改数据并触发 persist()
- **THEN** 本地立即更新，且后台将变更推送至服务端 SQLite

### Requirement: 全局年度口径
系统 SHALL 提供 `fyYear` 全局过滤（默认 "all"），通过 projYearOf() 从实际签约月/预计签约月/关键日期/创建日期推导年份，projectsInView() 据此过滤；setFyYear() 变更后 SHALL 重渲染所有受影响的页面以保持口径一致。

#### Scenario: 切换年度联动多页面
- **WHEN** 用户在任意页面将年度从 "all" 切换为 "2026"
- **THEN** 项目、竞争情报、报价、合同、决策链等页面同步按 2026 年过滤重渲染

### Requirement: 自由 KV 扩展位
系统 SHALL 保留 `store.ui` 作为自由键值扩展位，供页面级配置与未纳入白名单的结构化数据（如竞争情报投标评分矩阵 ciBattle）挂接，无需改动后端。

#### Scenario: 非白名单数据随同步链路落库
- **WHEN** 竞争情报页将投标评分矩阵写入 store.ui.ciBattle[pid]
- **THEN** 该数据随 persist() 进入 localStorage 并经 schedulePush() 落库，无需后端 schema 变更

### Requirement: 基础工具函数
系统 SHALL 提供 uid()(时间戳+随机生成 id)、esc()(HTML 转义防 XSS)、toast()(轻提示)、fmtDate()/today()(日期格式化) 等全局工具。

#### Scenario: 渲染用户输入防注入
- **WHEN** 任意模块渲染用户可控文本
- **THEN** 经 esc() 转义后输出，避免 <script> 等注入
