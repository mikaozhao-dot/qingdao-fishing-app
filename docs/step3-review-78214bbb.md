# 第 3 步交易闭环独立评审（Muse，2026-10-24）

- 被评 head：`78214bbb1049d2064d40ec67827fafab0e56f208`（含其后 4 个提交，共评审 5 个新提交）
- 基线：`5ec9d0180245190de58f6ae32e6498200a9a61bd`（第 2 步评审通过 + 第 3 步任务书）
- 评审依据：`docs/codex-dev-step3-brief-v1.md`（第 3 步任务书，现行评审标准）
- 结论：**有条件通过**。核心链路经 Muse 独立实跑全部验证；两项未关闭项列于文末，不阻塞进入第 4 步。

## 一、全量比对（基线 → 被评 head，blob SHA 级）

ADDED（新增）：
- `app/lib/step3_flow.dart`（选位/确认订单/沙盒支付/订单详情/订单列表 Flutter 页）
- `server/src/step3-routes.js`、`server/src/step3-adapters.js`（交易路由、沙盒支付/保险适配器）
- `server/migrations/004_transaction_sandbox.sql`（锁位/订单/支付流水表结构）
- `docs/step3-build-notes.md`、`docs/data-model-step3-addendum.md`、`docs/step3-review-request-2026-10-24.md`
- `design/step3-review-photos/` 5 张截图（01 选位 / 02 确认订单 / 03 沙盒支付 / 04 订单详情 / 05 第 2 步活动详情长图）

CHANGED（修改）：
- `app/lib/main.dart`、`app/lib/step2_flow.dart`：仅接线（活动详情接「选择座位」入口；船长端 `allowBooking=false`，船长不能为自有班次开钓友选位流程——与任务书一致）
- `server/src/app.js`、`server/src/config.js`：注册 step3 路由、新增两个沙盒密钥环境变量读取
- `server/package.json`：`npm run check` 覆盖新增的两个 js 文件
- `server/.env.example`：新增两个占位密钥变量（`GENERATE_...` 占位，无真实密钥入仓）
- `README.md`：步骤描述更新（第 3 步沙盒交易；明确截图非模拟器截图）
- `docs/step2-build-notes.md`：仅追加一条说明（发班表单截图与活动截图样例船名不一致的原因），无口径改动

## 二、规格完整性（阻断项检查）

- 规格正本全部未动：`docs/mvp-plan-v1.md`、`docs/codex-ui-design-brief-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md`、`docs/data-model-v1.md`、`docs/codex-dev-step1-brief-v1.md`、`docs/codex-dev-step2-brief-v1.md`、`docs/codex-dev-step3-brief-v1.md`、`design/content-prototype-v1.html`——基线与被评 head 的 md5 逐一比对一致。
- 迁移 `004` 只追加新结构，未改写 `001`–`003`；与 `docs/data-model-step3-addendum.md` 所述一致。
- 无真实密钥入仓；沙盒密钥走环境变量（`secretBuffer` 要求 32 字节 hex，未配置时 503 拒绝）。

## 三、Muse 独立实跑（隔离环境：本地 PG16 + Redis 7，虚构沙盒账号，未连接任何生产服务）

从仓库拉取 `server/` 全量代码（`main` 分支），`npm install`（npmmirror），`001`–`004` 迁移从空库应用成功，服务启动 `/ready` 双依赖 ok。自编冒烟脚本 `qd-smoke.mjs`（26 项断言），**全部通过**：

1. 完整链路：实名用户锁 2 位（含尾角位 #12）→下单金额服务端重算 **110000 分**（500×1+600×1），客户端传 `totalFen: 1` 被忽略；沙盒支付成功→订单 `paid`、座位显示 `sold`（`booked`→`sold` 为接口既定映射）；保险外链为 `https://insurance-sandbox.invalid/...`，状态可回查→`issued`，`premiumCollectedByPlatform: false`。
2. 并发：两账号同抢一座，恰好一个 201、一个 409（`所选座位刚被其他钓友锁定，请刷新座位图`）。
3. 锁位超时（构造过期锁+惰性清理触发）：座位回 `available`，`seat_holds` → `expired`，待支付订单 → `cancelled`（库内逐行核验）。
4. 支付失败：订单 → `cancelled`（未转已支付），座位回 `available`；支付流水状态 `failed`。
5. 未实名用户下单被 403 拦截；他人锁位不可下单（409）；同幂等键重复提交只出一单（200 + `idempotentReplay`）；他人读单 404。
6. PII：库内为密文（`full_name_ciphertext` 非明文），接口返回掩码（`王** / 990***********0017 / 166****0101`）。
7. 支付回调错误签名 → 401（HMAC timing-safe 比对）。
8. 保险外链仅已支付订单可开，未支付订单 409；沙盒密钥缺失时 503。

代码抽查结论：金额整数分、服务端重算；行锁（`FOR UPDATE`）+ Redis Lua 原子锁 + 唯一部分索引三重防超卖；订单级事务锁串行化支付意图/回调/过期清理；与任务书约束一致。

## 四、截图目检（5 张，逐张实读）

- 01 选位：二维选位图（船头在上、左右两列、船尾在下，编号 1–12），尾角位 ★ 标识 ¥600、其余 ¥500；图例含 可选/已锁定/已售/尾角位加价；价格小结注明「金额由服务端按座位价格重新核算」。中文 UI，非 3D，编号未重排——符合冻结设计。
- 02 确认订单：锁位倒计时 `8:56` 显示；2 位乘船人表单；金额 `¥1100.00`；「全额预付；沙盒支付不产生真实资金流」口径。
- 03 沙盒支付：三态入口（成功/失败/超时并释放锁位）；「这是沙盒演示，不会连接微信/支付宝，也不会产生真实扣款」。
- 04 订单详情：已支付；乘船人掩码；金额明细（船位费/优惠/平台服务费/合计）；保险状态「已收到沙盒投保成功回传」，外链为 `.invalid` 沙盒域并明示「不会访问真实保险机构」；「保险费由持牌保险机构独立收取，不计入本订单，平台不代收」。
- 05 第 2 步活动详情长图（补交项）：钓组/成团（最低成行总价、距成行金额）/退改（72h 免费取消阶梯）/保险（「意外险必买、本页不办理投保」）/海况（数据难待接入）/口碑六区全部入镜；底部「选择座位」入口已接通。

## 五、未关闭项（不阻塞第 4 步）

1. **iOS 模拟器截图未补交**：任务书要求模拟器截图 ≥3 张（选位/确认订单/订单详情，<1MB）。Codex 在构建记录中已如实声明本机无 `Simulator.app`、`simctl` 截图为黑图，本次 5 张均为 Flutter Web 手机视口预览——**不得**作为 iOS 模拟器验收证据。请在有可用模拟器的环境补跑并复核（或并入第 4 步验收时一并关闭）。
2. **CI 结果待确认**：本机无 GitHub Actions 运行结果读取通道。工作流 `step0-build.yml`（analyze + Android debug APK + iOS simulator 构建）会在 `app/**` 推送时触发；Codex 自述本地 `dart analyze` 退出码 0、iOS simulator 目标构建通过，但**推送后 CI 三项结果须另行确认**（可在下次 watch 运行时核对，或 Codex 贴出运行页链接）。
3. 挂账项（任务书已定不阻塞）：真机小额真实订单（含保险真实出单），待创始人并行线（支付商户号、保险签约）到位后补验。

## 六、下一步指令（Codex）

1. 本评审通过后，第 3 步评审 head 推进至 `78214bbb`；可按路线图进入**第 4 步**（以届时 Muse 入仓的第 4 步任务书为准）。
2. 第 4 步任务书发出前，不要动 `server/src/step3-*.js` 与 `004` 迁移；截图缺项（未关闭项 1）可在第 4 步验收时一并补交，无需单独提交。
3. CI 结果（未关闭项 2）若发现失败，单独提交修复，不要混入第 4 步实现提交；一类交付物一提交纪律继续有效。
