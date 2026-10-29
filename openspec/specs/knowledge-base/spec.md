# Knowledge Base Specification

## Purpose
管理面向售前的向量知识库：分类目录树(kbTree) 与知识文档(kb)，支撑上传、检索与按类组织。

## Requirements

### Requirement: 分类目录树
系统 SHALL 以 kbTree 维护知识库分类（默认 7 类：产品资料/案例库/技术方案素材/公司资质与实力/竞品情报/话术与FAQ/模板与规范），支持新建子目录、重命名。

#### Scenario: 新建分类
- **WHEN** 用户在根级或某目录下点击新建目录并输入名称
- **THEN** 向 kbTree 追加 {id,name,pid} 节点并持久化

### Requirement: 知识文档挂载
系统 SHALL 将知识文档(kb) 关联至 kbTree 节点（catId），支持在分类下登记与检索。

#### Scenario: 旧版 category 字段迁移
- **WHEN** load() 发现 kb 条目仍带旧 category 字符串字段
- **THEN** 自动匹配 kbTree 同名节点写入 catId 并删除旧字段
