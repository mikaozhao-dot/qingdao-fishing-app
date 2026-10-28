# Muse 评审：Step 4 断言计数修复与 REA 路线改定 0daccac2（通过，记录类 + 验收脚本窄修）

- 被评范围：`7a7315a372f10fa90f8791815b481345c713bd5b`（Muse 评审 596c9b19）→ `0daccac237ddeade113036803602c30d2c3ef1e6`，共 6 笔新提交，逐笔确认无遗漏：
  - `bbabf919`：`docs: switch REA APK route to real Android device route (Muse)`——Muse 自身派单，按 §1 不评审；已核实该提交只新增 `docs/muse-to-luna-rea-real-device-apk-order-2026-10-28.md`，无夹带。
  - `e2ef8566`：`test: stabilize Step 4 race assertion count`——本轮实评的代码改动（见下文）。
  - `4b33b43c`：`docs: switch REA APK route to BlueStacks Air first, real-device order on hold (Muse)`——Muse 自身派单，按 §1 不评审；已核实该提交只新增 `docs/muse-to-luna-rea-bluestacks-air-order-2026-10-28.md`，且明文写明真机派单暂缓保留、未撤销。
  - `01999918`：`docs: Dot verify bounded Step 4 assertion count fix`——Dot 独立补记（见下文对账）。
  - `bd985053`：`docs: reconcile G review and Step 4 count status`——G 状态回注与 README 状态行同步。
  - `0daccac2`：`docs: record BlueStacks Air Play login checkpoint`——REA 回执的 BlueStacks 装机与登录停点记录。
- 评审方式：全仓比对 7a7315a3 → 0daccac2（旧 555 文件、新 558 文件），变化 10 项：新增 Dot 补记与 2 份 Muse 派单，修改 README、G 交付回执、G 两份评审请求、Muse 补正复核请求、REA 回执、验收脚本 `server/scripts/step4-acceptance.mjs`；无删除。实读全部文档差量与脚本差量；规格正本、业务代码、迁移文件均不在差量中。
- 规格正本未动：`docs/mvp-plan-v1.md`、`docs/codex-ui-design-brief-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md` 在差量中均无变化；无设计稿、无图片改动，故不涉及 1MB 图片拉取问题；无真实资金、真实保险出单或生产部署改动。

## 结论：通过

本轮通过只覆盖：Step 4 验收脚本的竞态分支断言计数窄修、G 技术复核完成的状态回注、以及 REA 路线改定与 BlueStacks 登录停点的记录。**不等同于创始人产品验收（G 仍待创始人明确决定）、不等于 G 队列关单、不授权队列下一项（包船禁挤人）开工**，也不解除真实首单前的保险方书面确认与对外文案合规复核。

## 实际差量（已实读核对）

### 1. Step 4 验收脚本窄修（e2ef8566，唯一代码改动）

`server/scripts/step4-acceptance.mjs` 仅增 5 行、无删除、无业务代码改动：

- 座位锁胜出分支：原有 `expect(GET /seats)` 计 1 项 HTTP 状态断言，现新增释放后座位状态为 `available` 的断言，合计 2 项；
- 线下配额转移胜出分支：新增 `hold_id` 为 null 与 `sale_channel` 为 offline 两项断言，合计 2 项。

两分支现各计 2 项，原随竞态胜出分支产生的一项计数差已在静态代码层面消除，且没有删减任何原断言。Dot 在 `docs/dot-step4-assertion-count-review-2026-10-28.md` 的独立核实与上述实读一致。

### 2. G 状态回注（bd985053 等文档差量）

README、G 交付回执、G 两份评审请求与 Muse 补正复核请求同步改写为同一口径：补正 SHA `d3e0ab3c` 已获 Dot `1e3a2d5` 限定沙盒技术通过，并由 Muse 于 `a25360cf` 独立复核通过（仅限限定沙盒/API 技术行为）；后续 `e2ef856` 只稳定验收脚本计数，不改产品或 API 行为；创始人产品验收仍待明确决定；验收前不启动队列下一项。回注未把技术通过写成产品验收、队列关单或真实通道授权，无夹带。

### 3. REA 路线改定（bbabf919 → 4b33b43c，两份 Muse 派单）

- 真机派单（bbabf919）：创始人点选定版切真机——创始人找安卓手机从 Play 装好两个应用（FishingBooker for Captains `com.fishingbookercaptains.android`、FishingBooker Charters & Trips `com.fishingbooker.customer.android`），再由 Luna 用 `adb` 提取；范围纪律为只读拉取上述两个包名、不浏览手机其他应用与个人数据、不登录 FishingBooker、不下单、不抓流量、不经手创始人账号与锁屏凭据；同一问题失败两次停手。
- BlueStacks 派单（4b33b43c）：创始人改定先用消费级模拟器 BlueStacks Air 试，真机派单暂缓保留、未撤销；本单失败后是否回真机路线由创始人再定。执行次序为只走 BlueStacks 官网安装、启动后确认 Play 可打开并停在登录页、登录停点不变（创始人本人登录，Luna 不代填、不代存口令与验证码）、登录成功后从 Play 安装上述两个应用并导出 APK、逐个计算 SHA-256 与读出版本锁定样本；红线为登录仍失败则把报错原文入仓停手，不试第三种模拟器、不同时启用真机派单；APK 本体只留本机、不入仓，回执只记元数据与哈希。

两份派单的路线沿革一致：镜像站全灭 → 官方模拟器代理修通、登录页可达，但创始人本人登录仍被拦截（2026-10-28 18:22 创始人确认），官方模拟器路线关闭。派单未改约钓者规格，未插队 G 队列。

### 4. BlueStacks 登录停点记录（0daccac2，REA 回执）

REA 回执新增第 4 节，实况为：2026-10-28 18:33 开始、18:37 打开 Play 并确认登录页、18:38 停在登录页等待创始人本人操作。安装包来自 BlueStacks 官方 Mac 产品页，`BlueStacksInstaller_5.21.790.7505.pkg`，SHA-256 `137accd707aa21028abf57412820d803fe550b07a1d5110ada291b80e10877aa`，签名 Developer ID Installer: now.gg, Inc. (UJYFHY4XNR)，Apple notarization trusted，`spctl` accepted；主机 macOS 26.6.2、Apple Silicon；安装收据显示 BlueStacks 与 BlueStacks Air MIM 均为 5.21.790.7505，应用位于 `/Applications/BlueStacks.app`。本次未点登录、未输入账号或验证码，未安装 FishingBooker 应用；APK 尚未取得、安装或提取，尚未开始拆解；逐项卡点与登录失败止损（记录原文并停止，不改用第三方 APK 来源、第三种模拟器或真机路线，等创始人决定）均已写明。原 AVD 路线已明确标注为历史停点、由 BlueStacks 新令替代，未把两条路线混写为并行。

## 与 Dot 补记对账

- 一致：脚本差量只改验收脚本、两分支各计 2 项、无删减断言；同 SHA CI [run 40671804540 / job 122760170458](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40671804540/job/122760170458) 成功，Step 4 为 854 项、G 升级夹具 4 项、Step 5 133 项、live 77 项、promotion 334 项、退款重订升级 33 项、证书 70 项；该 CI 是 e2ef8566 的结果，不替换旧 d3e0ab3c 的 853，也不把旧本地 852 改写为未实际执行的数值。
- 证据边界（本评审同样保留，不作扩大）：Dot 未自行重跑测试，本轮亦未重跑数据库验收；一轮 CI 不能证明两个竞态胜出分支都在这一轮实际发生，分支计数一致来自静态代码核对；旧本地 852 的具体执行分支未有留存日志对应，只能确认代码存在足以解释差一的条件路径，不能断言已还原那次实际运行。修复后 3 次全新隔离数据库运行均为 854 项的说法来自回执记录，本轮只读工具未独立复核该本地运行。
- Dot 补记明文：不是产品关单或下一项开工令；计数来源说明可按 Muse 原要求在 Luna 下次文档更新时对齐，不另派重复回修，不要求重跑测试。本评审同意该范围。

## 下一步指令

- 致创始人（待其本人操作的两件事，分属两条线，互不代替）：
  1. G 产品验收仍待明确决定；验收完成前不启动队列下一项（包船禁挤人），不接真实保险、真实资金或生产。
  2. REA 线当前停在 BlueStacks Air 内 Google Play 登录页，待创始人本人在 BlueStacks 内完成 Google 登录后告知 REA 会话继续；登录失败时把报错原文发回，不由执行方改走第三条路线。
- 致 Luna（fishingbooker拆解研究会话）：登录成功后按 BlueStacks 派单第 4–6 步从 Play 安装并导出两个目标应用、锁定包名／实测版本／SHA-256 后更新回执并给出新的开工与交付钟点，再接回原工单做 REA 拆解；登录前不安装、不提取、不承诺拆解钟点。
- 致 Luna（luna开发会话）：G 沙盒技术项至此关闭；不因本评审自行启动包船禁挤人、F 补偿券或会员星级/会员券；不重复为已关闭的补正或计数问题再发 Dot 请求。
