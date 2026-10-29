## ADDED Requirements

### Requirement: 投标评分竞争分析五段结构
系统 SHALL 在选中项目下的竞争情报页提供「投标评分竞争分析」模块，含五段：评分标准总览、全厂商得分矩阵（自动汇总客观分小计/合计并附 POC 折算）、核心分差逐项分析、梯队格局判定、分厂商投标策略。

#### Scenario: 录入厂商得分自动汇总
- **WHEN** 用户在得分矩阵录入各厂商各维度分值
- **THEN** 客观分小计与合计行实时重算(ciB_recalc)，无需手动求和

#### Scenario: 分析内容挂自由KV落库
- **WHEN** 用户在任意分析段落编辑文本或分值并失焦
- **THEN** 内容写入 store.ui.ciBattle[pid] 并经 persist() 落库，无需后端 schema 变更
