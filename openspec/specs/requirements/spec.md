# Requirements Specification

## Purpose
按项目收集、分类与分析客户需求：记录标题/类别/优先级/来源/提出方/状态/分析结论，提供统计视图，并支持把需求汇入项目知识库作为输入材料。

## Requirements

### Requirement: 按项目的需求增删
系统 SHALL 以 `store.requirements[pid]` 数组按项目保存需求，支持新增、编辑、删除；标题为必填，缺失时拒绝保存并提示。

#### Scenario: 新增需求缺标题
- **WHEN** 用户在需求弹窗未填标题点击保存
- **THEN** 系统不写入数据并提示「请填写需求标题」

#### Scenario: 删除需求
- **WHEN** 用户在某需求行点击「删除」并确认
- **THEN** 该需求从 `store.requirements[pid]` 移除、persist 并重新渲染

### Requirement: 需求字段
系统 SHALL 为每条需求保存 id、title、category（默认「业务需求」）、priority(high/medium/low，默认 medium)、status(pending/analyzed/approved/rejected，默认 pending)、source、relatedKb、description、analysis、owner、acceptance、updated。

#### Scenario: 编辑需求并补充分析结论
- **WHEN** 用户打开某需求，填写「分析结论」与「验收标准」后保存
- **THEN** 列表行显示该分析结论（最大宽度 260px），updated 记为当天

### Requirement: 优先级与状态徽标
系统 SHALL 以徽标呈现优先级（高=红底、中=默认、低=绿底）与状态（待分析/已分析/已确认/已放弃）。

#### Scenario: 高优先级需求展示
- **WHEN** 某需求 priority = high
- **THEN** 优先级列显示红色「高」徽标

### Requirement: 需求统计
系统 SHALL 统计并展示 高/中/低优先级 与 待分析 的条目数。

#### Scenario: 统计卡片渲染
- **WHEN** 某项目有 3 条高优先级、2 条待分析需求
- **THEN** 统计卡片分别显示「高优先级 3」「待分析 2」

### Requirement: 汇入项目知识库
系统 SHALL 在需求页提供「汇入项目知识库 →」入口，跳转到该项目知识库的输入区。

#### Scenario: 跳转汇入
- **WHEN** 用户点击「汇入项目知识库 →」
- **THEN** 跳转至项目知识库并定位到当前项目的 📥输入 区

### Requirement: 空项目保护
系统 SHALL 在未选中有效项目时展示空态引导，而非报错。

#### Scenario: 无项目时的空态
- **WHEN** 系统中不存在任何项目
- **THEN** 需求页展示「暂无项目，请先在「项目管理」中创建」
