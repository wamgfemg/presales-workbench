# Competitive Intelligence Specification

## Purpose
支撑售前竞争情报管理：对手画像(compintel 列表) 与项目级结构化分析能力（详见归档变更 add-bid-score-competition-analysis）。

## Requirements

### Requirement: 对手画像列表
系统 SHALL 维护竞争情报列表(compintel)，支持按项目筛选、新增与查看对手画像。

#### Scenario: 筛选竞争情报
- **WHEN** 用户在竞争情报页选择某项目
- **THEN** 列表仅展示该项目匹配的情报条目

### Requirement: 投标评分竞争分析五段结构
系统 SHALL 在选中项目下的竞争情报页提供「投标评分竞争分析」模块，含五段：评分标准总览、全厂商得分矩阵（自动汇总客观分小计/合计并附 POC 折算）、核心分差逐项分析、梯队格局判定、分厂商投标策略。

#### Scenario: 录入厂商得分自动汇总
- **WHEN** 用户在得分矩阵录入各厂商各维度分值
- **THEN** 客观分小计与合计行实时重算(ciB_recalc)，无需手动求和

#### Scenario: 分析内容挂自由KV落库
- **WHEN** 用户在任意分析段落编辑文本或分值并失焦
- **THEN** 内容写入 store.ui.ciBattle[pid] 并经 persist() 落库，无需后端 schema 变更
