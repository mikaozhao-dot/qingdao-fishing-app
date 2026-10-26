# 第 6 步切片 1：Dot 增量复核补证（2026-10-27）

## 本轮对应要求

Dot 在 `docs/dot-step6-slice1-fixback-review-2026-10-26.md` 的 `4d75e579` 增量复核中要求补交 migration 023 升级夹具与回归，并指出历史佣金事件备用回填路径应单独覆盖；R4 复核需检查重复链接/重建不重复归因。此回执只记录补证，不预设 Dot 结论，也不请求创始人产品验收。

## 补充实现

- `server/scripts/step6-promotion-acceptance.mjs` 新增“事件备用路径”升级对照：先完成首单并全额退款，保留正额 `commission_created` 历史事件，再将 `qualified_at` 置空并模拟 022 已运行但资格漏种的状态。执行 023 后核对当前身份摘要被回填。
- 验收脚本删除 migration 023 的版本记录后再次调用真实迁移入口，核对资格表总行数未增加，且事件备用路径仍恰好只有一条身份资格。
- `app/test/main_app_promotion_attribution_test.dart` 新增重复链接及 `AppShell` 重建用例。重复热链接在同一实例不重复发起 claim；模拟重建后相同 token 再送达，服务端幂等响应不新增第二个归因。该用例是 widget 级生命周期模拟，不冒充 Android 原生 Activity 或真实插件测试。

## 本地验证

测试运行在专用临时 PostgreSQL 17 与 Redis 8 实例中，端口分别为 55440、56380；空库由仓库真实迁移入口应用 001–023 后运行验收，无生产数据。

| 验证 | 结果 |
| --- | --- |
| Step 6 推广升级验收 | **251 项断言通过**，含 023 正额/全退归零/仅历史事件/未曾计佣对照、身份更正后复用拒绝、重复 claim 只留一条归因及迁移重跑幂等 |
| `npm run check` | 通过 |
| `npm test` | 10/10 通过 |
| `flutter test` | 27 项通过，含重复链接与 `AppShell` 重建模拟 |
| `dart analyze` | 无问题 |
| `flutter build ios --simulator --no-codesign` | 构建成功 |
| GitHub 数据库验收 | [run 40364146459](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40364146459) 在代码/测试提交 `db9972abf356cd546f64edb403230287813cfea5` 通过；日志确认 Step 6 **251 项断言通过**，同 job 的 Step 4、Step 5 与直播验收也通过 |
| GitHub Flutter 回归与双端构建 | [run 40364147015](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40364147015) 绑定同一 SHA 并通过：27 项 Flutter 测试、Flutter analyze、iOS 模拟器构建、Android debug APK 构建 |

本机 `flutter analyze` 前端两次因 Dart analysis server 收到截断的 LSP 初始化 JSON 而退出；直接运行 `dart analyze` 对同一项目检查通过。此环境现有 iOS 冷/热启动与 claim 截图仍对应原运行时代码 SHA `4d75e579`，见 [`step6-slice1-r1-r4-followup-2026-10-27.md`](step6-slice1-r1-r4-followup-2026-10-27.md)。本轮没有修改 App 运行时代码，只新增回归用例和验收夹具；新增版本的原生 H5 跳转未重新实测。

## 尚未关闭的门槛

- **R1：**上述升级回填、历史事件备用路径及重跑幂等的本地证据已补，等待 Dot 对本轮新夹具/回执定点复核；旧身份已经丢失且无历史摘要的数据仍不可恢复。
- **R4：**现有 iOS H5 冷/热路径证据仍在 `4d75e579` 回执中；本轮 widget 模拟与服务端 claim 幂等测试不是原生 Activity 重建证据。当前主机没有 Android SDK、`adb`、Android emulator 或 AVD，Android 冷/热链路仍待设备实测；不以 Android APK 构建代替。
- 整体仍未获 Dot 对新回执的复核，不关闭切片 1、不进入切片 2；H5 免下载首单和创始人产品验收仍待办。真实资金、保险和生产使用未获授权。

**请求 Dot：**请定点复核本回执的 migration 023 历史事件回填与重跑幂等证据，以及 R4 重复归因回归；明确保留 Android 原生冷/热链路待实测。此请求不预设通过。
