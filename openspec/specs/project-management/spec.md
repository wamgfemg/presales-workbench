# Project Management Specification

## Purpose
管理售前商机项目全生命周期：列表/筛选/排序、详情（信息/任务/时间线/C139/文档）、阶段推进、C139 赢单率模型、推进评分。

## Requirements

### Requirement: 项目 CRUD 与列表
系统 SHALL 支持项目的新增、删除、按阶段(stage)/商机级别(oppLevel)/金额/赢单率/年份等维度排序与筛选。

#### Scenario: 按推进评分排序项目
- **WHEN** 用户在项目列表点击"推进评分"列排序
- **THEN** 列表按 goScore(p).score 升/降序重排

### Requirement: 项目详情多视图
系统 SHALL 为单项目提供详情视图，含信息(info)、任务(task)、时间线(timeline)、C139、文档(doc) 五个标签，数据来自当前项目对象。

#### Scenario: 查看项目时间线
- **WHEN** 用户打开某项目并切换到时间线标签
- **THEN** 展示该项目的历史阶段变更与手动记录条目

### Requirement: 阶段推进与记录
系统 SHALL 允许变更项目阶段(stage)，并在变更时向时间线追加记录；流失阶段(LOST_STAGES)支持填写流失原因。

#### Scenario: 阶段变更留痕
- **WHEN** 用户将项目阶段从"跟进中"改为"已赢单"
- **THEN** 时间线新增"阶段变更为「已赢单」"记录并持久化

### Requirement: C139 赢单率模型
系统 SHALL 实现 C139 模型：基于 1Win(is1W)、教练(coach)、三项共识(consensus)、九要素(factors) 计算赢单率 rate 与区间(win/mid/lose)，规则与 defaultC139()/c139Stats() 一致。

#### Scenario: 教练确认且无 1Win
- **WHEN** 项目标记 coach=true 且 is1W=false 且 consensus 仅 1 项满足
- **THEN** 赢单率落于 lose 区间（rate=3），提示"无1Win时即使教练确认仍处劣势"

#### Scenario: 1Win 且九要素达到制胜拐点
- **WHEN** 项目 is1W=true 且 factors 满足数 >=6
- **THEN** 赢单率进入 win 区间（rate>=85）

### Requirement: 项目任务管理
系统 SHALL 在项目详情任务视图支持任务的增删与完成勾选，勾选即持久化。

#### Scenario: 勾选任务完成
- **WHEN** 用户勾选某任务复选框
- **THEN** 该项 done=true 并 persist()，列表实时反映完成态

### Requirement: 推进评分
系统 SHALL 提供 goScore(p) 推进评分，综合阶段/级别/C139/金额权重给出排序分值。

#### Scenario: 计算推进评分
- **WHEN** 系统渲染任一项目的推进评分
- **THEN** 返回基于 c139 赢单率与金额权重的综合分值
