# 第 1 步账号与船档案独立评审（Muse，2026-10-24）

**结论：有条件通过。** 后端 31 项独立实跑全部通过、库级 PII 与模板公式逐项核验无误；但任务书验收第 4 项（`flutter analyze` 全量通过输出、模拟器/真机冒烟）仍未关闭，本评审不为其背书，须在有完整工具链的环境补做。

## 评审范围

- 基线 `b99f1fba9bf0`（2026-10-23 Muse 入仓节流令）→ 头 `84828e0f87c2`，共 4 个新提交：`e0b7afc`（API）、`b040a66`（Flutter）、`adf8919`（构建与冒烟记录）、`84828e0f87c2`（评审请求）。
- 全量递归比对：新增 16 文件、修改 13 文件，详见本轮证据小节。**规格正本零触碰**：`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md`、`docs/codex-dev-step1-brief-v1.md` 五份均未改动——守卫通过。
- 独立实跑环境：临时 PostgreSQL 17 空库 + Redis，`001`+`002` 两条迁移均成功登记；`ENABLE_DEMO_SANDBOX=true`；测试数据全部虚构，未入仓。

## 通过项（逐项实跑证据）

1. 注册/登录：沙盒验证码 `246810` 走通；错码 401；60 秒内重发 429；尝试次数递增、5 次后锁定（`attempts>=5` 失效）；`register` 返回 200 + token。
2. 实名：`990000…999` 沙盒驳回（状态 `rejected`，理由船长端回显）、`001` 重提通过（`verified`）；非法校验位 400；响应只回 `**************`+尾号四位，无明文。
3. PII：库检 `users`/`captain_profiles`/`boats` 全部只有密文字段（AES-256-GCM，解密回环验证真实值）；`user_sessions` 只存 token HMAC；短信验证码只存 HMAC；手机号查重走独立 HMAC 摘要；应用日志不记录请求体。
4. 船档案（13m 样例）：6 设施、4 类照片 + 资质/登记证上传；照片按归属用户隔离（跨用户 400）；模板 `qingdao-12-seat-v1` 自动落库，12 位编号 1–12 左舷→右舷顺时针、6/7 尾角加价 `premium:true`；舒适度 `(1300−200)÷6=183.3cm`→`comfortable`。
5. 边界：12m → ready/166.7cm/compact；14m → ready/200.0cm/spacious；15m → `manual_review`、无模板可套、照常登记——与任务书一致。
6. 审核流：错误管理员口令 401；无理由驳回 400；驳回必填理由、理由在船长端回显；`review_events` 留痕 2 条（rejected、approved）；重提后通过；未提交申请者 `{"application":null}`。
7. 注销：`/auth/logout` 204 后原 token 访问 `/account/me` 401。
8. 无 `seat_inventory` 实例（`count=0`）；生产环境沙盒验证码不返回（`sandboxCode` 仅非生产）。
9. App 端：`step1_flow.dart` 按契约读取 `seatLayout`/`seatCount`/`estimatedSpacingCm`/`comfortLevel`，舒适度标签映射齐全、模板图只读展示、间距标注「平台计算，只读」——无船长可改入口。
10. 沙盒边界注明：`docs/step1-build-notes.md` 已声明测试号段、演示驳回序号与生产禁用，符合任务书「不接真实供应商」约束。

## 建议项（非阻断）

1. `estimatedSpacingCm` 类型不一致：`POST /captain/application` 返回数字 `183.3`，`GET /captain/application` 返回 pg numeric 字符串 `"183.3"`。建议服务端统一转数字后再发，前端已做容错但仍建议修。
2. `design/step1-review-photos/` 6 张截图为 Chrome 移动视口 Web 预览，Codex 已如实声明不能替代设备验收——归档时请勿在后续文档中引用为设备证据。

## 未关闭条件（须另行环境补做）

1. **任务书验收第 4 项前半**：`flutter analyze` 全量通过输出。Codex 本机 Flutter 分析服务崩溃（`FormatException: Unexpected end of input`），`dart analyze` 通过但不能替代；本评审环境无 Flutter SDK，**未能独立验证**。
2. **任务书验收第 4 项后半**：模拟器/真机冒烟。本环境无 Android SDK、无连接设备、本机 Xcode 许可未接受——6 张 Web 截图仅供布局参考。
3. GitHub Actions 双端构建记录：本环境无法查询 workflow runs，**未独立核实**，build-notes 中的自述暂按 Codex 诚实申报处理。

## 下一步指令（给 Codex）

1. 在有完整工具链（Flutter SDK + Android SDK 或可用模拟器/真机）的环境：跑通 `flutter analyze --no-pub` 并把原始输出存档；完成任务书要求的主要页面 ≥3 张设备截图（每张 <1MB 入仓）。
2. 修复建议项 1（`estimatedSpacingCm` 统一数字类型），一类交付物一提交。
3. 上述两项关闭后，第 1 步可视为验收通过，进入第 2 步；第 0 步遗留两条件随第 1 步验收同步关闭（见任务书）。

---
证据：本轮独立实跑脚本与命令记录在 Muse 侧工作区（`/tmp/qa-work/` 复刻目录、`qa-chain.mjs`/`qa-chain2.mjs`/`qa-chain3.mjs` 共 31 项断言），数据库与上传文件均为临时路径，测试结束后即销毁，未入仓。
