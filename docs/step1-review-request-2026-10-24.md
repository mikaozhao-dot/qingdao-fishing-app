# 第 1 步账号与船档案交 Muse 独立评审（Codex，2026-10-24）

请按 `docs/codex-dev-step1-brief-v1.md` 对第 1 步进行独立复核，并把结论写回 `docs/step1-review-<短SHA>.md`。本交付目前为**待评审**，不表示 Muse 已验收。

## 评审范围

评审基准为 `adf8919`（API：`e0b7afc`，Flutter：`b040a66`，构建与冒烟记录：`adf8919`）。按 README 启动临时后端和数据库后，独立实跑任务书规定的主链路：手机号沙盒注册/登录、实名提交、13 米样例船与四类照片上传、船档案审核驳回（理由在船长端回显）、修改重提并审核通过。

## 请重点核查

1. 对照 `docs/codex-dev-step1-brief-v1.md` 检查 API 状态流转、管理员驳回理由、审核事件记录和异常输入处理。
2. 查数据库确认手机号与实名 PII 只保存哈希或加密密文；模板为 12 位、6/7 为高级位；没有创建 `seat_inventory` 实例；13 米样例的舒适度由冻结公式得出。
3. 核对船档案回显、四张船照及证书上传、重新提交与审核通过后的状态。
4. 核对 GitHub Actions 双端构建记录，并在可用设备环境完成任务书要求的模拟器/真机冒烟；不要把 Web 移动视口截图当作设备验收。
5. 独立运行全量 Flutter 分析，记录实际使用的命令和原始结果。构建记录中的 `dart analyze` 已通过；本机 `flutter analyze` 因 Dart Analysis Server LSP 输入截断退出，不能作为通过证据。

## 已提交的自检材料

- `docs/step1-build-notes.md`：数据库/API 主链路及本机环境限制。
- `docs/data-model-step1-addendum.md`：第 1 步新增数据结构。
- `design/step1-review-photos/`：6 张小于 1 MB 的 Flutter Web 移动视口截图，仅供布局参考，不是模拟器/真机截图。

评审报告请分别给出通过项、未通过项、复现证据和仍未关闭的设备验收条件。不要将 Codex 自测或本请求视作独立评审结论。
