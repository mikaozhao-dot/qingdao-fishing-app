# 派单：致「fishingbooker拆解研究」会话（Luna）——改走 BlueStacks Air 装机提取 APK

- 下令：Muse；日期：2026-10-28；创始人改定：先用消费级模拟器 BlueStacks Air 试，真机派单（`bbabf919`）暂缓保留、未撤销，本单失败后是否回真机路线由创始人再定。
- 路线沿革：镜像站全灭（`cc516f4d`）→官方模拟器＋Play：代理修通、登录页可达（`596c9b19`），但创始人本人登录仍被拦截（2026-10-28 18:22 确认），官方模拟器路线关闭。本单换 BlueStacks Air（Apple Silicon 版、自带 Play、登录兼容性好），只解决样本取得，样本锁定后仍接回原工单（`620db74f`）做 REA 拆解。

## 执行次序

1. **只走官方来源安装**：从 BlueStacks 官网下载适配创始人 Mac（M 系列、Apple Silicon）的 BlueStacks Air 安装包并安装；不从任何第三方下载站取安装包。安装过程中若 macOS 弹出须创始人本人确认的步骤（安全提示、管理员口令、系统扩展许可），停下把要点的那一步写清回报，不代填创始人口令。
2. **备机**：启动 BlueStacks Air，确认其内 Google Play 可打开并停在登录页；网络沿用 Mac 现行代理环境（BlueStacks 一般随宿主机网络，如 Play 不可达，先核对宿主机代理是否对应用生效，把现象原样记录，不自行折腾第三方网络工具）。
3. **登录停点不变**：停在登录页入仓记录「BlueStacks 已备好、待创始人本人登录」。创始人用本人 Google 账号在 BlueStacks 内完成登录；Luna 不代填、不代存、不经手其口令与验证码。
4. **装机**：登录成功后在 BlueStacks 内从 Play 安装：优先 1 FishingBooker for Captains（`com.fishingbookercaptains.android`）；优先 2 FishingBooker Charters & Trips（`com.fishingbooker.customer.android`）。
5. **提取与锁定样本**：将两个应用的 APK 导出到 Mac 本机（可用 BlueStacks 自带的文件导出／媒体管理器，或在模拟器内装 APK 提取类工具——所用方法与工具名须记入回执；split 的连同 base 全量导出）。文件到 Mac 后逐个计算 SHA-256、读出 versionName／versionCode 锁定样本；与分发页候选值不一致的，以本机实测为准并注明。
6. **回执与接续**：更新本线回执入本仓（安装版本、登录结果、两个应用的包名／实测版本／本地 SHA-256／导出目录级路径），给出新的开工与交付钟点，随后按原工单第 0 步用 REA 打开样本、继续八项拆解。

## 红线

- 登录仍失败（报错或拦截）：把报错原文入仓停手，不试第三种模拟器、不同时启用真机派单，等创始人再定。
- 不登录 FishingBooker 账户、不下单、不抓生产流量；除两个目标应用与第 5 步声明的提取工具外，不在 BlueStacks 内安装其他应用。
- APK 本体只留本机、不入仓；回执只记元数据与哈希。
- 同一问题失败两次停手回报。
