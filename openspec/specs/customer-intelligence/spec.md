# Customer Intelligence Specification

## Purpose
沉淀客户外部情报（工商/舆情/招投标/自媒体/财报/联系人履历），并与内部数据（项目、干系人、报价、决策链）融合，形成按客户聚合、可对话的客户画像。

## Requirements

### Requirement: 情报条目字段
系统 SHALL 以 `store.custintel` 数组保存情报，每条含 id、customer、dim、title、summary、insight（对售前的启示）、source、date；维度取自 `CUST_DIMS`（工商信息/舆情动态/招投标/公众号·自媒体/财报·经营/联系人履历/其他），默认「工商信息」。

#### Scenario: 录入一条招投标情报
- **WHEN** 用户为「某客户」录入维度=招投标、含摘要与启示的情报并保存
- **THEN** 该条目按日期倒序出现在该客户分组下，展示维度标签、标题、摘要与「对售前的启示」高亮块

### Requirement: 按客户聚合与总览
系统 SHALL 按客户名（`custKey`）分组展示情报，并在顶部展示已覆盖客户数、情报条数、维度覆盖数（x/7）、在管项目数。

#### Scenario: 维度覆盖统计
- **WHEN** 全部情报仅涉及「工商信息」与「舆情动态」
- **THEN** 总览「维度覆盖」显示 `2/7`

### Requirement: 内外部数据融合
系统 SHALL 将每个客户的在管项目数、预估合同额合计、已识别关键人数（来自 `store.stakeholders`）融合展示在客户分组头部。

#### Scenario: 客户分组头部标签
- **WHEN** 某客户有 2 个在管项目、预估合计 300 万、3 个关键人
- **THEN** 分组头部显示标签「在管项目 2」「预估合计 300 万」「关键人 3」

### Requirement: 关键词检索
系统 SHALL 支持按客户、标题、摘要、维度做不区分大小写的模糊检索。

#### Scenario: 检索命中
- **WHEN** 用户在搜索框输入某客户名关键字
- **THEN** 仅保留命中情报并重新按客户分组渲染

### Requirement: 客户画像入口
系统 SHALL 为每个客户分组提供「◎ 客户画像」与「＋ 补情报」两个入口。

#### Scenario: 预置客户补情报
- **WHEN** 用户在某客户分组点击「＋ 补情报」
- **THEN** 打开录入弹窗且客户字段预置为该客户名

### Requirement: 空态引导
系统 SHALL 在无情报时展示引导文案而非空白。

#### Scenario: 首次进入
- **WHEN** `store.custintel` 为空
- **THEN** 展示「暂无客户情报，点击右上角「＋ 录入情报」开始沉淀」
