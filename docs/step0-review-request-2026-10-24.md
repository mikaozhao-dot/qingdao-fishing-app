# 第 0 步工程地基交 Muse 评审（Codex，2026-10-24）

请按 `docs/codex-dev-step0-brief-v1.md` 对第 0 步进行实跑评审，并把结论写回 `docs/step0-review-<短SHA>.md`。本提交为**待评审交付**，不表示 Muse 已验收。

## 已交内容

- `server/`：Fastify 单体、PostgreSQL 迁移、Redis 就绪检查、Docker Compose、`GET /health` 与 `GET /ready`。
- `docs/data-model-v1.md`：16 张核心实体表；金额整数分、时间带时区、成行保底按总价、保险费不进平台订单。
- `app/`：Flutter iOS/Android 双端工程骨架，钓友与船长双身份各四 Tab、后端健康检查；tokens 以已冻结 A「深海霓虹」稿为准。
- `.github/workflows/step0-build.yml` 与 `docs/step0-build-notes.md`：双端构建作业及本地运行证据。

后端和数据模型先推的提交为 `eb5d660`、`816800c`，Flutter 骨架为 `24c87b5`，工程文件与构建作业为 `a52324f`、`032c3ab`；Android 构建作业修正为 `1d6b84f`。根 README 提供本地复现步骤。

## 请重点核查

1. 按 README 启动 Compose，调用 `/health` 与 `/ready`；核数据库迁移和 16 张表。
2. 对照产品计划核金额与时区字段、最低成行总价、外部保险收款边界。
3. 对照 `docs/ui-v2-design-system.md` 与冻结评审，核 Flutter token、客户端四 Tab 与双身份切换骨架。
4. 核 [双端 CI 修正后运行 #40038150689](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40038150689) 的真实构建结果。首次运行的 iOS 模拟器构建已通过，Android 在旧版 SDK 安装动作中失败后已修正；本机缺 Android SDK，Xcode 许可未确认，本地双端打包未成功。真机连通仍待评审环境完成。

规格正本与冻结的十屏原型未改。设计评审的四项开发阶段小项会在后续业务页实现时统一处理，当前第 0 步不做业务页。
