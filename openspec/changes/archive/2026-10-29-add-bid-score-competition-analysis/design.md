# Design: 投标评分竞争分析

## 数据流
```
store.ui.ciBattle[pid] = {
  std:    [{dim, weight, type}],                 // 评分标准总览
  matrix: [{vendor, scores:{dim:val}, sub, total}], // 全厂商得分矩阵
  poc:    [...],                                  // POC 折算表
  diffs:  [...],                                  // 核心分差逐项分析
  tiers:  [...],                                  // 梯队格局判定
  tactics:[...]                                   // 分厂商投标策略
}
```

## 渲染结构（renderCiBattle）
1. 评分标准总览：表格（维度 / 权重 / 类型），行内编辑。
2. 全厂商得分矩阵：厂商 × 维度矩阵，末两行固定为「客观分小计」「合计」，
   由 ciB_recalc(pid) 遍历 matrix 行累加 scores 重算。
3. 核心分差逐项分析：文本块列表。
4. 梯队格局判定：卡片（t1/t2/t3/t4 四级，左侧色条区分）。
5. 分厂商投标策略：按厂商文本块。

## 持久化
所有 contenteditable 元素 onblur 调用 ciB_save(pid, path, value) → 写 store.ui.ciBattle → persist()。

## 样式
新增 `.cib-std` / `.cib-mtx` / `.cib-field` / `.tier-card(.t1~.t4)`，
focus 态描边提示可编辑，复用既有 `table.mtx` 矩阵样式。
