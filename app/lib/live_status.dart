import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import 'api_client.dart';
import 'fishing_tokens.dart';

typedef ProfileUrlLaunch = Future<bool> Function(Uri uri, LaunchMode mode);

Future<bool> tryOpenDouyinProfile(
  String profileUrl, {
  ProfileUrlLaunch? launch,
}) async {
  final uri = Uri.tryParse(profileUrl);
  if (uri == null || uri.scheme != 'https') return false;
  final host = uri.host.toLowerCase();
  if (!{'douyin.com', 'www.douyin.com', 'v.douyin.com'}.contains(host)) {
    return false;
  }
  try {
    return await (launch ?? ((value, mode) => launchUrl(value, mode: mode)))(
      uri,
      LaunchMode.externalApplication,
    );
  } catch (_) {
    return false;
  }
}

Future<void> openDouyinProfile(
  BuildContext context,
  String profileUrl, {
  ProfileUrlLaunch? launch,
}) async {
  final opened = await tryOpenDouyinProfile(profileUrl, launch: launch);
  if (!context.mounted || opened) return;
  final uri = Uri.tryParse(profileUrl);
  if (uri == null || uri.scheme != 'https') return;
  await showDialog<void>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: const Text('打开抖音主页'),
      content: const Text('暂时无法唤起抖音，可复制主页链接或用浏览器打开。'),
      actions: [
        TextButton(
          onPressed: () async {
            await Clipboard.setData(ClipboardData(text: profileUrl));
            if (dialogContext.mounted) Navigator.pop(dialogContext);
            if (context.mounted) {
              ScaffoldMessenger.of(
                context,
              ).showSnackBar(const SnackBar(content: Text('主页链接已复制')));
            }
          },
          child: const Text('复制链接'),
        ),
        FilledButton(
          onPressed: () async {
            try {
              await launchUrl(uri, mode: LaunchMode.platformDefault);
            } catch (_) {
              // The copy action remains available when the browser cannot open it.
            }
            if (dialogContext.mounted) Navigator.pop(dialogContext);
          },
          child: const Text('浏览器打开'),
        ),
      ],
    ),
  );
}

class LiveStatusLinkButton extends StatelessWidget {
  const LiveStatusLinkButton({
    required this.profileUrl,
    this.compact = false,
    this.launch,
    super.key,
  });

  final String? profileUrl;
  final bool compact;
  final ProfileUrlLaunch? launch;

  @override
  Widget build(BuildContext context) {
    if (profileUrl == null || profileUrl!.isEmpty) {
      return const Chip(
        avatar: Icon(Icons.sensors, size: 16),
        label: Text('船长直播中'),
        backgroundColor: Color(0x223BBE9A),
      );
    }
    return ActionChip(
      avatar: const Icon(Icons.sensors, size: 16, color: FishingTokens.brand),
      label: Text(compact ? '直播中 · 抖音' : '船长正在抖音直播 · 打开主页'),
      onPressed: () => openDouyinProfile(context, profileUrl!, launch: launch),
      backgroundColor: FishingTokens.surfaceTint,
      side: BorderSide(color: FishingTokens.brand.withValues(alpha: .35)),
    );
  }
}

Future<void> submitLiveReport(
  BuildContext context, {
  required String departureId,
  required String token,
}) async {
  const reasons = <String, String>{
    'not_live': '当前没有直播',
    'wrong_account': '账号与船长不符',
    'misleading_content': '直播内容与本航次无关',
    'other': '其他问题',
  };
  var reason = reasons.keys.first;
  final note = TextEditingController();
  var sending = false;
  String? error;
  final reported = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (dialogContext) => StatefulBuilder(
      builder: (context, setDialogState) => AlertDialog(
        title: const Text('反馈直播标记'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            DropdownButtonFormField<String>(
              initialValue: reason,
              decoration: const InputDecoration(labelText: '反馈原因'),
              items: reasons.entries
                  .map(
                    (entry) => DropdownMenuItem(
                      value: entry.key,
                      child: Text(entry.value),
                    ),
                  )
                  .toList(),
              onChanged: sending
                  ? null
                  : (value) {
                      if (value != null) setDialogState(() => reason = value);
                    },
            ),
            const SizedBox(height: 10),
            TextField(
              controller: note,
              maxLength: 500,
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: '补充说明（选填）',
                border: OutlineInputBorder(),
              ),
            ),
            if (error != null)
              Text(error!, style: const TextStyle(color: Color(0xFFE17E70))),
          ],
        ),
        actions: [
          TextButton(
            onPressed: sending
                ? null
                : () => Navigator.pop(dialogContext, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: sending
                ? null
                : () async {
                    setDialogState(() {
                      sending = true;
                      error = null;
                    });
                    try {
                      await Step1Api.post(
                        '/step5/departures/$departureId/live-reports',
                        {'reason': reason, 'note': note.text.trim()},
                        token: token,
                      );
                      if (dialogContext.mounted) {
                        Navigator.pop(dialogContext, true);
                      }
                    } catch (exception) {
                      setDialogState(() {
                        sending = false;
                        error = exception.toString().replaceFirst(
                          'Exception: ',
                          '',
                        );
                      });
                    }
                  },
            child: Text(sending ? '提交中…' : '提交反馈'),
          ),
        ],
      ),
    ),
  );
  note.dispose();
  if (reported == true && context.mounted) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('已收到反馈，同一班次不会重复计入')));
  }
}

class LiveStatusAction extends StatelessWidget {
  const LiveStatusAction({
    required this.departureId,
    required this.profileUrl,
    required this.token,
    super.key,
  });

  final String departureId;
  final String? profileUrl;
  final String token;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      LiveStatusLinkButton(profileUrl: profileUrl),
      const SizedBox(height: 6),
      TextButton.icon(
        onPressed: () =>
            submitLiveReport(context, departureId: departureId, token: token),
        icon: const Icon(Icons.flag_outlined, size: 18),
        label: const Text('反馈直播标记'),
      ),
    ],
  );
}
