# Org Assets Specification

## Purpose
把售前个人经验沉淀为组织可复用资产（可复制的赢单套路），按类型组织、按贡献者归属、带版本与适用场景，避免打法随人员流动而流失。

## Requirements

### Requirement: 资产类型
系统 SHALL 以 `ORG_TYPES` 八类组织资产：方法论、SOP流程、标杆案例、项目复盘、模板话术、检查清单、行业打法、定价策略；未知类型回退为「方法论」。

#### Scenario: 未知类型归并
- **WHEN** 某条资产的 type 不在 ORG_TYPES 内
- **THEN** 渲染时归入「方法论」分组，不产生游离分组

### Requirement: 资产字段
系统 SHALL 为每条资产保存 id、type、title、scenario（适用场景）、tags（逗号分隔）、owner（默认取当前登录用户名）、version（默认 v1.0）、summary、content、date。

#### Scenario: 沉淀新资产
- **WHEN** 用户填写标题并保存
- **THEN** 资产 unshift 到 `store.orgassets` 头部，owner 默认当前账号名，version 默认 v1.0，date 记为当天

### Requirement: 按类型分组与折叠详情
系统 SHALL 按类型分组展示（仅显示有内容的类型），每条资产以卡片呈现标签、版本、贡献者、日期、摘要、适用场景，并以 `<details>` 折叠「展开打法要点」正文。

#### Scenario: 展开打法要点
- **WHEN** 用户点击某资产的「展开打法要点」
- **THEN** 以 `white-space:pre-wrap` 展示 content 全文，保留原始换行

### Requirement: 总览指标
系统 SHALL 展示资产总数、覆盖类型数（x/8）、贡献者数、最近更新日期。

#### Scenario: 覆盖类型统计
- **WHEN** 仅沉淀了「方法论」与「检查清单」两类
- **THEN** 「覆盖类型」显示 `2/8`

### Requirement: 关键词检索
系统 SHALL 支持按标题、摘要、正文、标签、适用场景、贡献者做不区分大小写的模糊检索。

#### Scenario: 检索贡献者
- **WHEN** 用户输入某贡献者姓名
- **THEN** 仅保留该贡献者的资产并重新分组渲染

### Requirement: 编辑与删除
系统 SHALL 支持编辑已有资产（就地合并字段）与删除（带确认）。

#### Scenario: 删除确认
- **WHEN** 用户点击「删除」并在确认框选择取消
- **THEN** 资产保留，列表不变

### Requirement: 空态引导
系统 SHALL 在无资产时展示定位说明与引导文案。

#### Scenario: 首次进入
- **WHEN** `store.orgassets` 为空
- **THEN** 展示「为什么要有「组织资产」」说明卡与「暂无组织资产，点击右上角「＋ 沉淀资产」写下第一条打法」
