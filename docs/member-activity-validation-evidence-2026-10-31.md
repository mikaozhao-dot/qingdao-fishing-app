# 会员活动切片验证证据补充（2026-10-31）

本文件补充固定代码提交的可复核命令、退出结果、覆盖范围和边界，不替代 Muse / Dot 的评审结论。

## 匹配配置切片 `9dad7ea`

固定提交：`9dad7ea9dce4826a719e01753ca343865ec79ab1`。

### 本地定点复核

在该提交的独立 worktree 中运行：

```text
cd server
node --test test/activity-matching-settings.test.js
```

结果：`tests 8`、`pass 8`、`fail 0`、`exit 0`。覆盖已知且不重复的码头/鱼种选择、显式空选择、格式/未知码/重复值拒绝、代码到平台名称序列化、船长范围 GET、PUT 整体替换、无效码不写入、未审核船长拒绝读写。

同一提交另运行：

```text
cd server
node --check src/activity-matching-settings.js
```

结果：`exit 0`。

```text
cd app
dart analyze lib/api_client.dart lib/step2_flow.dart
```

结果：`No issues found!`，`exit 0`。这两个 Dart 文件是该切片改动的客户端文件。

### 固定 SHA 的 GitHub Actions

下列工作流均由 `push` 触发，`head_sha` 精确为 `9dad7ea9dce4826a719e01753ca343865ec79ab1`，状态均为 `completed / success`：

- [Step 0 dual-platform builds，run 41074160977](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/41074160977)：
  - analyze job `124125761318`：Flutter regression tests 成功；全 app 分析日志显示 `No issues found! (ran in 12.3s)`。
  - android job `124125761515`：`Build Android debug APK` 成功。
  - ios job `124125761634`：`Build iOS simulator app` 成功。
- 完整原始 job 日志可在上述 Actions 页面查看，或用 `gh run view 41074160977 --repo mikaozhao-dot/qingdao-fishing-app --job <job-id> --log` 读取。

该工作流验证了 Android/iOS 构建、Flutter regression suite 与全 app analyze；日志中没有单独标识匹配配置页面的 Flutter 测试。因此不把通用回归套件描述为该功能的专属交互验收。

## 需求单生命周期切片 `203ddca`

固定提交：`203ddcab4f804cc0ea2837154e1835d7298a98e6`。

在该提交的独立 worktree 中运行：

```text
cd server
node --test test/member-activity.test.js
```

结果：`tests 9`、`pass 9`、`fail 0`、`exit 0`。覆盖上海时区规范化与跨午夜时段、非法目录/预算/时段/人数拒绝、手机号和微信号拦截、响应字段隐私、实名门禁、有效数量与每日数量限制、编辑/关闭事实、到期下架事实。

同一提交运行 `node --check src/member-activity-service.js`、`node --check src/member-activity-routes.js`、`node --check src/app.js`，结果均为 `exit 0`。

## 验证边界与评审状态

- 两组服务端定点测试使用 fakePool 与直接 handler 调用；不证明真实 PostgreSQL 事务回滚/并发、真实认证中间件或动态双用户隔离。
- 本地定点结果不是 GitHub Actions 结果；上文链接的 Flutter CI 也未单独执行服务端匹配配置测试。
- 尚无匹配配置页面的截图/交互验收证据。
- `9dad7ea` 的 Muse 限沙盒评审仍有效；Dot 已完成有界代码复核，但未授予独立技术验收。现补齐固定 SHA 的本地定点日志、Flutter Actions run/job 原始日志入口及实际覆盖说明，等待 Dot 复核。
- `203ddca` 已获 Muse 对需求单生命周期切片的限沙盒通过；Dot 复核仍待完成。两者均不构成会员活动整体验收或生产放行。
