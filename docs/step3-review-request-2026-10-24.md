# 第 3 步交易闭环交 Muse 独立评审（Codex，2026-10-24）

请依据 `docs/codex-dev-step3-brief-v1.md` 独立复核选位、锁位、下单、沙盒支付与保险适配。实现提交为后端 `74b0836`、Flutter `2534160`，证据图为 `8f7e660`。Codex 自检和本请求均不表示 Muse 已验收。

## 评审范围

请只使用隔离临时数据库、Redis 和虚构沙盒账号，不连接生产服务。重点核查：

1. `004_transaction_sandbox.sql` 只追加新结构；锁位 10 分钟、Redis 与数据库双写、惰性及定时过期清理；同一座位并发争抢只能一方成功。
2. 已实名买家、本人有效锁、乘船人一座一人；服务端根据库存快照重算整数分金额；幂等键重复提交不会创建第二单；他人不能读取订单。
3. PII 静态检查密文存储与掩码响应；支付回调签名和事件幂等；成功/失败/超时对应的订单、支付和座位状态一致。
4. 保险入口只对已支付订单开放；外链仅为 `.invalid` 沙盒地址；保费没有计入平台订单。
5. Flutter 活动详情至选位、确认、沙盒支付、订单详情与订单列表流程；船长端不能为自己的班次开钓友选位流程。
6. 复核 `design/step3-review-photos/` 中 5 张图。前 4 张是 390×844 Flutter Web 手机视口预览，第 5 张是第 2 步活动详情 390×2200 整页预览，均小于 1 MB。它们不是 iOS 模拟器截图；本机没有可用的 `Simulator.app`，任务书要求的 3 张 iOS 模拟器截图仍需独立补验。
7. 核对 GitHub Actions [run 8](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40071460766) 的 analyze、Android debug APK 和 iOS Simulator 构建结果（三项目前均显示成功）；不要把本机 iOS 目标构建或 CI 绿灯视为 UI 验收。

## Codex 自检材料

- `docs/step3-build-notes.md`：迁移、30 项本地 API 冒烟、分析/构建和限制说明。
- `docs/data-model-step3-addendum.md`：迁移 `004` 的字段、状态和并发约束说明。
- 后端复测命令：`npm run check`；独立冒烟脚本 `node /tmp/qingdao-step3-smoke.mjs`（仅在本机临时环境）。
- Flutter 自检：`dart analyze --format=machine`、`flutter build ios --simulator --no-codesign --no-pub`。

请列出独立实跑的命令、状态与数据库核验结果，注明发现的问题和未关闭项，并给出明确的通过/有条件通过/未通过结论。不得把 Codex 的本地自检或本请求当成 Muse 的独立结论。
