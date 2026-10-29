# Proposal: 投标评分竞争分析（竞争情报改造）

## Why
现有竞争情报页仅维护「对手画像」列表，缺少对投标评分与竞争格局的结构化分析能力。
售前参与招投标时，需要按《投标评分及竞争格局分析报告》的范式，对同一项目的多家厂商
在评分维度上做横向对比、识别核心分差、判定竞争梯队并制定投标策略。
参照 DCIM 项目报告，将竞争情报升级为「对手画像 + 投标评分竞争分析」双模块。

## What Changes
- 在竞争情报页（选中项目视角）下新增「投标评分竞争分析」模块（renderCiBattle）。
- 模块映射报告五段结构：评分标准总览 / 全厂商得分矩阵(自动汇总) / 核心分差逐项分析 / 梯队格局判定 / 分厂商投标策略。
- 单元格与文本块行内可编辑（contenteditable），失焦即存 store.ui.ciBattle[pid]。
- 得分矩阵客观分小计/合计由 ciB_recalc() 实时重算。

## Impact
- 仅前端改动：src/main.js（renderCompintel 挂载 renderCiBattle，新增 ciBattleOf/renderCiBattle/ciB_recalc/ciB_save 等函数）、src/styles.css（.cib-* 样式）。
- 数据挂 store.ui.ciBattle（自由 KV），无需后端 schema 变更或迁移。
- 路由入口：show('compintel') → renderCompintel() → renderCiBattle(pid)。
- 不影响既有对手画像列表逻辑。

## Out of Scope
- 不接入真实评分数据源或 OCR 解析报告；数据由用户手动录入。
- 不改动后端鉴权、同步链路与 SQLite schema。
