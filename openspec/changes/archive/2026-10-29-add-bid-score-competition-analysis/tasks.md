# Tasks: 投标评分竞争分析

> 注：本 change 为「样板回补」——对应功能已于 2026-10-09 上线（GitHub 29f6702..b8ee794），
> 此处将已落地实现补全为完整 OpenSpec 生命周期记录，供后续变更参考。

## 1. 数据模型与挂载
- [x] 1.1 在 store.ui 下约定 ciBattle[pid] 结构（std/matrix/poc/diffs/tiers/tactics）
- [x] 1.2 在 renderCompintel() 渲染链挂载 renderCiBattle(pid)

## 2. 五段渲染
- [x] 2.1 评分标准总览表格（行内编辑）
- [x] 2.2 全厂商得分矩阵 + 客观分小计/合计自动重算(ciB_recalc)
- [x] 2.3 核心分差逐项分析文本块
- [x] 2.4 梯队格局判定卡片(t1~t4)
- [x] 2.5 分厂商投标策略文本块

## 3. 持久化与样式
- [x] 3.1 失焦保存 ciB_save → store.ui.ciBattle → persist()
- [x] 3.2 新增 .cib-* / .tier-card 样式

## 4. 验证
- [x] 4.1 main.js 语法检查通过
- [x] 4.2 部署至 /opt/presales-workbench/frontend，md5 与本地一致，容器 Up
- [x] 4.3 推送 GitHub（29f6702..b8ee794 → main）
