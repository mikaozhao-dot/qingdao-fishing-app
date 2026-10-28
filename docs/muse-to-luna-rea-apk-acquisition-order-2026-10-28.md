# 派单：致「fishingbooker拆解研究」会话（Luna）——经安卓模拟器／真机从 Play 提取两个 APK

- 下令：Muse；日期：2026-10-28；创始人点选定版：走安卓手机或模拟器，从 Play 装好两个 App 再提取 APK。
- 背景：开工回执（`7287b442`）与阻塞记录（`cc516f4d`）已确认镜像站路线全灭（APKPure 403／APKCombo 连接失败／Aptoide 403／Uptodown 404）。本单改走 Play 正规来源锁定样本；REA 加载验证已通过，本单只解决样本取得，取得后按原工单（`620db74f`）继续拆解。

## 执行次序

1. **环境先行**：在创始人 Mac 上确认 Android SDK／emulator 可用（R4 线已推进安装，以本机实际为准）；建带 Google Play 的 AVD（Play 商店系统镜像、arm64）。若有现成安卓真机可连 adb，可优先真机，路径相同。
2. **登录停点**：模拟器／真机需要登录 Google 账号时**停下回报**，写清需要创始人本人完成哪一步；不得代填、代存创始人的 Google 账号口令，不得用一次性／他人账号绕过。若 Play 提示地区不可用或应用不可见，同样停下如实回报现象，不切换镜像站冒充本路线成果。
3. **装机**：从 Play 安装两个应用——优先 1：FishingBooker for Captains（`com.fishingbookercaptains.android`）；优先 2：FishingBooker Charters & Trips（`com.fishingbooker.customer.android`）。
4. **提取与锁定样本**：`adb shell pm path` 定位后 `adb pull` 全部 APK（若为 split APK，base 与全部 split 一并拉取并逐个记录）；本机计算每个文件的 SHA-256，并以 `dumpsys package` 记录 versionName／versionCode／文件大小。与回执中的来源公布候选值对照，不一致以本机实测为准并注明差异。
5. **回执更新**：样本锁定后更新本线回执入本仓——两个应用的包名／实测版本／本地 SHA-256／提取路径（本机路径只记目录级，不入仓二进制本体），并给出新的开工与交付钟点；随后按原工单第 0 步用 REA 实际打开样本，继续八项拆解。

## 红线

- APK／split 文件只留本机，不入仓、不外传；入仓的只有元数据、哈希与回执。
- 不登录 FishingBooker 账户、不下单、不抓生产流量；Play 登录仅限创始人本人完成的 Google 账号登录。
- 同一问题失败两次停手回报，不自行换第三条路线；排期只在样本锁定后重报，不默默顺延。
