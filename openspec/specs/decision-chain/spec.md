# Decision Chain Specification

## Purpose
以 C139「决策结构」口径管理项目决策链与干系人：按角色识别关键人、评估决策结构覆盖度、用影响力×立场矩阵定位经营重点，并支持跨项目台账。数据与「干系人管理」共用同一份 `store.stakeholders[pid]`。

## Requirements

### Requirement: 决策链三视图
系统 SHALL 在决策链页提供三个页签：`flow`（决策链视图）、`matrix`（影响力矩阵）、`ledger`（跨项目台账），页签状态由 `chainTab` 保存于会话内。

#### Scenario: 切换页签
- **WHEN** 用户点击「🎯 影响力矩阵」页签
- **THEN** `chainTab` 置为 `matrix` 并重新渲染该页签内容（决策覆盖度卡片不再显示）

### Requirement: 决策结构覆盖度
系统 SHALL 以 `KEY_ROLES`（决策者/最终审批人/技术负责人/采购负责人）为准计算每个在跟项目的必备角色覆盖数，未覆盖角色以缺失清单呈现。

#### Scenario: 必备角色未覆盖
- **WHEN** 某项目仅识别了「决策者」与「技术负责人」
- **THEN** 覆盖度卡片显示 `2/4` 并标注「缺：最终审批人、采购负责人」，样式为 lack（非 full）

#### Scenario: 必备角色全覆盖
- **WHEN** 某项目四个 KEY_ROLES 均已识别到人
- **THEN** 卡片样式为 full，文案显示「关键角色已覆盖」

### Requirement: 角色阵型与补录
系统 SHALL 按 `CHAIN_ROLES` 分组展示已识别人员卡片，缺人的角色展示虚位卡片并支持「补录此人」；必备角色带「必备」标记。

#### Scenario: 从虚位补录关键人
- **WHEN** 用户在「采购负责人」虚位卡片点击「补录此人」
- **THEN** 打开干系人弹窗且角色字段预置为「采购负责人」

### Requirement: 干系人字段
系统 SHALL 为每个干系人保存 name、role、dept、title、influence(high/medium/low)、attitude(support/neutral/oppose/unknown)、phone、wechat、email、focus（关注点）、strategy（我方策略）。

#### Scenario: 编辑干系人联系方式与策略
- **WHEN** 用户在某关键人卡片点击「编辑」并填写手机与关注点后保存
- **THEN** 该卡片展示 📱 联系方式与「关注点」标签，数据写入 `store.stakeholders[pid]` 并 persist

### Requirement: 影响力 × 立场矩阵
系统 SHALL 渲染 3×4 矩阵（影响力 high/medium/low × 立场 support/neutral/oppose/unknown），单元格计数可点击筛选下方明细，并给出风险提示。

#### Scenario: 点击矩阵单元格筛选
- **WHEN** 用户点击「高影响力 × 反对」单元格（计数 > 0）
- **THEN** `stkCell` 置为 `high|oppose`，明细列表仅显示高影响力且反对的人；再次点击取消筛选

#### Scenario: 无教练/内线风险提示
- **WHEN** 项目干系人中不存在 role =「教练/内线」的人员
- **THEN** 矩阵上方提示「尚无教练/内线 —— 按 C139 口径无教练且无 1Win 时赢单率上限只有 50%」

#### Scenario: 高影响力反对者提示
- **WHEN** 存在 influence=high 且 attitude=oppose 的干系人
- **THEN** 提示「存在高影响力反对者，需优先制定应对」

#### Scenario: 联系方式缺失统计
- **WHEN** 存在 phone、wechat、email 均为空的干系人
- **THEN** 提示「N 人未留联系方式」

### Requirement: 年度与项目范围过滤
系统 SHALL 仅展示未处于 `LOST_STAGES`（已流标/已输标/项目已取消）且落在当前年度视角内的项目，并支持项目下拉切换。

#### Scenario: 当前年度无在跟项目
- **WHEN** 年度筛选下不存在在跟项目
- **THEN** 展示空态「当前年度（YYYY）没有在跟项目，可切换右上角年度」
