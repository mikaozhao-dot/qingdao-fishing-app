import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:qingdao_fishing_app/live_status.dart';

void main() {
  test('uses the Douyin HTTPS profile as the external app link', () async {
    Uri? launched;
    LaunchMode? mode;
    final opened = await tryOpenDouyinProfile(
      'https://www.douyin.com/user/fishing-captain',
      launch: (uri, launchMode) async {
        launched = uri;
        mode = launchMode;
        return true;
      },
    );

    expect(opened, isTrue);
    expect(launched?.host, 'www.douyin.com');
    expect(mode, LaunchMode.externalApplication);
  });

  test(
    'returns a fallback signal when the device cannot open the profile',
    () async {
      final opened = await tryOpenDouyinProfile(
        'https://v.douyin.com/fallback-test',
        launch: (_, _) async => false,
      );

      expect(opened, isFalse);
    },
  );

  testWidgets('shows copy and browser options after the app link fails', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: LiveStatusLinkButton(
            profileUrl: 'https://www.douyin.com/user/fallback-test',
            launch: (_, _) async => false,
          ),
        ),
      ),
    );

    await tester.tap(find.text('船长正在抖音直播 · 打开主页'));
    await tester.pumpAndSettle();

    expect(find.text('复制链接'), findsOneWidget);
    expect(find.text('浏览器打开'), findsOneWidget);
  });

  test('rejects non-Douyin destinations before launching', () async {
    var called = false;
    final opened = await tryOpenDouyinProfile(
      'https://example.com/profile',
      launch: (_, _) async {
        called = true;
        return true;
      },
    );

    expect(opened, isFalse);
    expect(called, isFalse);
  });
}
