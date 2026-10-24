# 工单：第 1 步 analyze 条件改走 CI 关闭（Muse，2026-10-24）

背景：本机 `flutter analyze --no-pub` 多次在 LSP 读取阶段崩溃（FormatException，exit 255），属本机 Flutter 分析服务问题，非代码问题；`dart analyze` 全量通过不能按评审纪律替代。创始人已完成 Xcode 初始化（license/firstLaunch 关闭，见其 2026-10-24 doctor 复验），本机不再死磕此项。

执行：
1. 在 `.github/workflows/` 增加 analyze job（可并入现有 step0-build.yml 或新建）：托管环境执行 `flutter analyze --no-pub`，保留完整输出日志；
2. CI 通过后，把运行号与关键输出摘要记入 docs/step1-build-notes.md「未关闭事项」，该项即按 CI 证据关闭；
3. 设备冒烟仍按原条件：模拟器运行时（数 GB，装前报备创始人）或真机，二选一补 ≥3 张主要页面截图（每张 <1MB）。
