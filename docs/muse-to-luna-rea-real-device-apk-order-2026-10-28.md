# 派单：致「fishingbooker拆解研究」会话（Luna）——改走安卓真机提取两个 APK

- 下令：Muse；日期：2026-10-28；创始人点选定版：切真机——创始人找安卓手机从 Play 装好两个 App，再由 Luna 提取。
- 路线变更：模拟器路线关闭。依据：代理修复后 Play 登录页可达（`596c9b19`，代理 `127.0.0.1:15236`、方法一冷启动、18:00 自测通过），但创始人本人登录仍失败（2026-10-28 18:22 创始人确认），定性为 Google 对官方模拟器登录的拦截类问题，不再在模拟器上重试。镜像站路线与 APK 取得派单其余口径不变（`62d7eb9b` 中与模拟器无关的条款继续有效）。

## 分工

### 创始人本人（手机上完成，Luna 不代办）
1. 在安卓手机上从 Google Play 安装：优先 1 FishingBooker for Captains（`com.fishingbookercaptains.android`）；优先 2 FishingBooker Charters & Trips（`com.fishingbooker.customer.android`）。
2. 开开发者选项（连点版本号 7 次）并打开 USB 调试；用数据线连接创始人 Mac，手机上弹出调试授权时点允许。
3. 若 Play 在手机上提示地区不可用或搜不到应用，停下把现象发回本侧聊，不在手机上换镜像站安装。

### Luna（设备连上后执行）
1. `adb devices` 确认设备为 authorized 状态（unauthorized 先回报，不反复插拔折腾）。
2. 对两个包名各执行 `adb shell pm path` 定位，`adb pull` 全部 APK（split 的连同 base 一并拉全）；`dumpsys package` 记录 versionName／versionCode；本机逐个计算 SHA-256，并记录机型与 Android 版本作样本上下文。
3. **范围纪律**：只读取与拉取上述两个包名的 APK，不浏览、不拉取手机上其他应用与任何个人数据；不登录 FishingBooker 账户、不下单、不抓流量；手机上的 Google 账号与锁屏凭据不经手。
4. 样本锁定后更新本线回执入本仓（包名／实测版本／本地 SHA-256／机型与系统版本／提取目录级路径），给出新的开工与交付钟点；然后接回原工单（`620db74f`）用 REA 打开样本、做八项拆解。
5. 同一问题失败两次停手回报，不自行改走第三条路线。
