# Codex 开发任务书 · 第 0 步：工程地基

依据《开发路线图 v1》（docs/dev-roadmap-v1.md）与《产品计划》（docs/mvp-plan-v1.md）。本步只搭地基，不做业务页面。

## 交付物
1. **仓库结构**：`app/`（Flutter 工程）、`server/`（后端工程）、`docs/`、`design/`（已存在，勿动）。根 README 写清本地启动步骤。
2. **Flutter 空壳**：按 B 方案设计系统（以仓内裁定文件与 Codex 已交付的 B 设计稿为准）落 design tokens（色板/字阶/间距）与基础组件占位（底部 Tab 双身份切换骨架：客户端 4 Tab / 船长端 4 Tab 空页）；iOS 与安卓双端可构建运行。
3. **后端单体**：REST 服务 + PostgreSQL + Redis，Docker 化，含健康检查接口 `GET /health` 返回版本与时间；配置走环境变量，**任何密钥不得入仓**。
4. **数据模型 v1**：`docs/data-model-v1.md` 给出核心实体与关系（用户、船长、船档案、班次、钓位库存、订单、乘客实名、保险状态、评价、渔获回填、推广归因、佣金账本），字段口径以产品计划为准（金额一律整数分、时间带时区）。
5. **构建证据**：双端构建命令与一次成功构建日志摘要写入 `docs/step0-build-notes.md`（含 Flutter 与后端版本号、已知问题）。

## 约束
- 技术选型（后端语言/框架）可在 build-notes 中说明理由，但须满足：单体、REST、PostgreSQL、Redis、Docker 部署国内云；不得引入微服务与自研中台。
- 不得修改规格正本（docs/mvp-plan-v1.md、docs/codex-ui-design-brief-v1.md、docs/fish-library-v1.md、docs/p0-flow-v1.md、docs/dev-roadmap-v1.md 与裁定文件）。
- 提交粒度：一类交付物一提交，message 说清内容；不夹带无关改动。

## 验收（Muse 实跑）
按根 README 在评审环境复现构建（或核构建日志真实性）、调用 /health、核数据模型覆盖度与字段口径、核 tokens 与 B 设计稿一致性。结论写入 docs/step0-review-<短SHA>.md。
