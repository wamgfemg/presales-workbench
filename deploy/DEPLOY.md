# 部署纪律（Deploy Notes）

## 一句话

**线上 `/opt/presales-workbench` 是「CI 的落地目录」，不是「工作目录」。**
所有改动先提交到本仓库，由 GitHub Actions 部署；不要直接改线上。

## 为什么

线上目录**不是 git 仓库**。`deploy.yml` 用

```
rsync -az --delete frontend server deploy test  →  /opt/presales-workbench/
```

同步，意味着：

- 你在线上**直接改**的文件，会在下一次部署时被仓库里的版本**覆盖**；
- 你在线上**新增**的文件，会在下一次部署时被 `--delete` **删除**。

后果是「功能忽然消失」，而且往往在几天后才被发现 —— 因为没人会想到是部署把它退回的。

> 真实事故：2026-09-14 ~ 09-17 期间线上直改了 4 个新文件（`capacity.js` / `customer360.js` /
> `funnel.js` / `mytodo.js`，即「我的待办」整页），仓库里没有。若在当时直接 push，
> `--delete` 会把它们全部删掉，并把 `main.js` / `kb-weknora.js` 回退到 09-14，
> 连带复活已经修好的日期缺陷。正确做法是**先从线上把内容反推进仓库，再 push**。

## 三道防护

| 防护 | 位置 | 作用 |
|---|---|---|
| 语法自检（全量遍历） | `deploy.yml` | 遍历 `frontend/src/*.js` + `server/*.js`，不再维护硬编码清单 |
| 离线回归断言 | `deploy.yml` | `test/p0-assert.cjs`、`kb-readonly-assert.cjs`、`phase4-assert.cjs`、`p1-assert.cjs` |
| 一致性复核 | `deploy.yml` + `consistency-check.yml` | 部署后用 `rsync -n` 自检；每日另跑一次只读漂移检查 |

漂移检查发现差异时会**报红并输出比对清单**（`>` = 部署将覆盖/新增，`*deleting` = 部署将删除），
不会自动修复 —— 由人判断该保留哪一边。

## 线上不同步的内容

以下**不在** rsync 范围内，改它们不会被 CI 覆盖，但也不受版本管理，请自行备份：

- `data/` —— SQLite 库（`presales.db`）与上传的资料原件
- `.env` —— 环境变量与密钥
- `.bak-*` —— 手工备份目录
- `/opt/presales-workbench/index.js.bak-oai` —— 已移出同步路径的历史备份

## 紧急热修流程

线上正在着火时允许直接改线上，但必须：

1. 先在本地或仓库里改好，并跑通 `node test/*.cjs`；
2. commit + push，让 CI 走完整流程；
3. 若确实来不及等 CI，改完线上后**当天**把同样的改动补回仓库并 push ——
   否则次日的漂移检查会报红，而且你会在下次部署时丢掉它。
