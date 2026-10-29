# Quotation and Contract Specification

## Purpose
管理「报价管理」（按项目的多版本报价、成本/利润/红线校验、Excel 附件）与「合同管理」（合同台账、七维筛选、附件上传、独立合同），并把报价口径与项目主档金额、合同额对齐校验。

## Requirements

### Requirement: 合同台账构建
系统 SHALL 自动把 `stage = 已中标` 的项目纳入合同清单，并纳入手工登记在 `store.contracts[pid]` 中的记录；无对应项目的记录标记为「独立合同」。

#### Scenario: 中标项目自动进入清单
- **WHEN** 某项目阶段变为「已中标」
- **THEN** 合同台账出现该行，项目名称取项目名，合同总额回退取 `amountsOf(p).won`，软件额回退取 `amountsOf(p).sw`

#### Scenario: 独立合同
- **WHEN** 用户通过 `openContractNew()` 选择「独立合同（手动填写项目名称）」并保存
- **THEN** 台账新增一行带「独立」标签，且操作列额外提供「删除」按钮

### Requirement: 合同字段
系统 SHALL 为每条合同保存 contractNo、industry、region、partyA、signDate、projectName、total、software、coreBiz、coreBizProduct、status、notes、attachments。

#### Scenario: 关联项目时自动带出甲方与金额
- **WHEN** 用户在合同弹窗选择某具体项目（非独立合同）
- **THEN** 仅当字段为空时回填：甲方 ← 项目客户，合同总额 ← 项目中标额，软件合同额 ← 项目软件额，项目名称输入框隐藏

### Requirement: 合同七维筛选
系统 SHALL 支持按 合同编号/甲方/项目名称/行业/区域/核心业务/核心业务产品 组合筛选，并提供重置。

#### Scenario: 筛选无结果
- **WHEN** 筛选条件组合后无匹配行
- **THEN** 展示空态「没有符合筛选条件的合同」并提供「重置筛选」按钮

### Requirement: 合同附件管理
系统 SHALL 支持为合同上传多个附件（记录 fileId/name/size/date）并提供下载链接与删除。

#### Scenario: 上传并删除附件
- **WHEN** 用户上传一个 PDF 并随后点击该附件旁的 ✕
- **THEN** 附件先追加进 `store.contracts[pid].attachments`，删除后从该数组移除并 persist

### Requirement: 多版本报价记录
系统 SHALL 按项目保存多版报价 `store.quotations[pid]`，每版含 name、date、status（`QT_STATUS`：草稿/内部评审/已提交/中标价/作废）与明细 items（name/cost/quote/qty/remark）。

#### Scenario: 展开报价明细行
- **WHEN** 用户点击某报价版本的名称箭头
- **THEN** 该版本下展开 items 明细行，展示单项金额、单项利润与单项利润率

### Requirement: 报价汇总与利润率
系统 SHALL 计算每版报价的成本合计、对外报价、利润与利润率，并按 ≥30% 绿 / ≥15% 橙 / <15% 红 着色。

#### Scenario: 计算利润率
- **WHEN** 某版报价成本 60 万、对外报价 100 万
- **THEN** 利润 40 万，利润率 40%，以绿色展示

### Requirement: 版本对比
系统 SHALL 对每版报价计算与上一版（按日期倒序的相邻版本）的报价差额与利润率变化（pt）。

#### Scenario: 报价下降导致利润率下滑
- **WHEN** 最新版报价比上一版低 10 万且利润率低 5pt
- **THEN** 「与上一版对比」列显示红色「报价 -10 · 利润率 -5pt」

### Requirement: 与项目主档的红线校验
系统 SHALL 将最新报价与项目主档金额比对，并输出红线提示：成本超预算、报价高于预估合同额、中标额与最新报价不一致。

#### Scenario: 报价成本超项目成本预算
- **WHEN** 最新报价成本合计 > 项目成本预算
- **THEN** 红色提示「报价成本合计 X 万 已超项目成本预算 Y 万，需复核成本或走变更」

#### Scenario: 中标额与最新报价不一致
- **WHEN** 项目中标合同额与最新对外报价差值 ≥ 0.01 万
- **THEN** 橙色提示「中标合同额 X 万 与最新报价 Y 万不一致，请核对是否议价后未更新」

### Requirement: 报价 Excel 附件
系统 SHALL 支持为每版报价上传/替换 .xlsx/.xls 文件并提供下载。

#### Scenario: 上传报价 Excel
- **WHEN** 用户为某版报价选择 Excel 文件
- **THEN** 该行操作区由「上传Excel」变为「下载Excel」链接，指向 `/api/files/download/{fileId}`
