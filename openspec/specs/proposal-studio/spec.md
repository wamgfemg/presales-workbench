# Proposal Studio Specification

## Purpose
提供对话式方案制作中心：按文档类型(type)创建任务(task)，在右侧面板以对话(chat)或编辑(edit)模式产出初稿，并支持导出提示词至千问办公智能体。

## Requirements

### Requirement: 任务类型与创建
系统 SHALL 以方案类型卡片（type）引导创建制作任务，任务含 type、标题、状态(status)、草稿(draft)、初稿内容。

#### Scenario: 创建方案任务
- **WHEN** 用户选择某文档类型并创建任务
- **THEN** 生成 task 对象并进入任务列表，状态初始为 draft

### Requirement: 对话与编辑双模式
系统 SHALL 为任务提供 chat（对话生成）与 edit（编辑初稿）两种视图，draft 态默认 edit，已生成后默认 chat。

#### Scenario: 切换编辑初稿
- **WHEN** 用户在任务面板点击"编辑初稿"
- **THEN** 进入 edit 模式展示可编辑草稿区

### Requirement: 自动标题
系统 SHALL 在用户首次输入时基于内容自动生成任务标题（autoTitle），截断至 24 字符。

#### Scenario: 首输自动命名
- **WHEN** 用户在空白任务首次输入内容并提交
- **THEN** 任务标题自动取内容前 24 字符并标记 autoTitle

### Requirement: 千问办公集成
系统 SHALL 通过 openTaskQw() 将任务提示词复制为千问办公任务，由外部专家智能体生成成品。

#### Scenario: 导出提示词
- **WHEN** 用户点击复制提示词
- **THEN** 提示词写入剪贴板并标记 copied=true，提示"新建千问办公任务并粘贴"
