import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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

  testWidgets('keeps the copy action when browser fallback returns false', (
    tester,
  ) async {
    String? copiedText;
    final modes = <LaunchMode>[];
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          copiedText =
              (call.arguments as Map<Object?, Object?>)['text'] as String?;
        }
        return null;
      },
    );
    addTearDown(() {
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        null,
      );
    });

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: LiveStatusLinkButton(
            profileUrl: 'https://www.douyin.com/user/fallback-test',
            launch: (_, mode) async {
              modes.add(mode);
              return false;
            },
          ),
        ),
      ),
    );
    await tester.tap(find.text('船长正在抖音直播 · 打开主页'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('浏览器打开'));
    await tester.pumpAndSettle();

    expect(find.text('浏览器无法打开，请复制链接重试。'), findsOneWidget);
    expect(find.text('复制链接'), findsOneWidget);
    expect(modes, [LaunchMode.externalApplication, LaunchMode.platformDefault]);
    await tester.tap(find.text('复制链接'));
    await tester.pumpAndSettle();
    expect(copiedText, 'https://www.douyin.com/user/fallback-test');
  });

  testWidgets('keeps the copy action when browser fallback throws', (
    tester,
  ) async {
    final modes = <LaunchMode>[];
    String? copiedText;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          copiedText =
              (call.arguments as Map<Object?, Object?>)['text'] as String?;
        }
        return null;
      },
    );
    addTearDown(() {
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        null,
      );
    });

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: LiveStatusLinkButton(
            profileUrl: 'https://www.douyin.com/user/fallback-test',
            launch: (_, mode) async {
              modes.add(mode);
              if (mode == LaunchMode.platformDefault) {
                throw PlatformException(code: 'browser_unavailable');
              }
              return false;
            },
          ),
        ),
      ),
    );
    await tester.tap(find.text('船长正在抖音直播 · 打开主页'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('浏览器打开'));
    await tester.pumpAndSettle();

    expect(find.text('浏览器无法打开，请复制链接重试。'), findsOneWidget);
    expect(find.text('复制链接'), findsOneWidget);
    expect(modes, [LaunchMode.externalApplication, LaunchMode.platformDefault]);
    await tester.tap(find.text('复制链接'));
    await tester.pumpAndSettle();
    expect(copiedText, 'https://www.douyin.com/user/fallback-test');
  });

  testWidgets('closes the fallback dialog after browser successfully opens', (
    tester,
  ) async {
    final modes = <LaunchMode>[];

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: LiveStatusLinkButton(
            profileUrl: 'https://www.douyin.com/user/fallback-test',
            launch: (_, mode) async {
              modes.add(mode);
              return mode == LaunchMode.platformDefault;
            },
          ),
        ),
      ),
    );
    await tester.tap(find.text('船长正在抖音直播 · 打开主页'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('浏览器打开'));
    await tester.pumpAndSettle();

    expect(find.text('打开抖音主页'), findsNothing);
    expect(modes, [LaunchMode.externalApplication, LaunchMode.platformDefault]);
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
