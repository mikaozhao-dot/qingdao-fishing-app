import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:qingdao_fishing_app/api_client.dart';
import 'package:qingdao_fishing_app/step5_flow.dart';

void main() {
  tearDown(() => Step1Api.clientOverride = null);

  testWidgets(
    'loads fish boards, switches month, and keeps the true empty state',
    (tester) async {
      final paths = <Uri>[];
      Step1Api.clientOverride = MockClient((request) async {
        paths.add(request.url);
        final month = request.url.queryParameters['month'] ?? '2026-10';
        final hasCatch = month == '2026-10';
        return http.Response(
          jsonEncode({
            'month': month,
            'timeZone': 'Asia/Shanghai',
            'availableMonths': ['2026-10', '2026-09'],
            'boards': hasCatch
                ? [
                    {
                      'fishCode': 'yellow_croaker',
                      'fishName': '小黄鱼',
                      'items': [
                        {
                          'rank': 1,
                          'maxIndividualWeightGrams': 2700,
                          'returnAt': '2026-10-24T04:00:00.000Z',
                          'departureDate': '2026-10-24',
                          'captainName': '船长甲',
                          'catcherName': '昵称北风',
                          'catchSource': 'passenger',
                          'departureId': 'test-departure',
                        },
                        {
                          'rank': 2,
                          'maxIndividualWeightGrams': 1900,
                          'returnAt': '2026-10-24T04:00:00.000Z',
                          'departureDate': '2026-10-24',
                          'captainName': '船长甲',
                          'catcherName': '船长整船回填',
                          'catchSource': 'captain',
                          'departureId': 'test-departure-captain',
                        },
                      ],
                    },
                  ]
                : [],
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      });

      await tester.pumpWidget(
        const MaterialApp(home: Step5FishLeaderboardPage(token: 'test-token')),
      );
      await tester.pumpAndSettle();

      expect(find.text('大鱼榜'), findsOneWidget);
      expect(find.text('小黄鱼'), findsOneWidget);
      expect(find.text('昵称北风'), findsOneWidget);
      expect(find.text('2.70 kg'), findsOneWidget);
      expect(find.text('船长甲 · 2026.10.24'), findsNWidgets(2));
      expect(find.text('船长整船回填'), findsOneWidget);
      expect(find.textContaining('每航次每鱼种仅展示最大一条'), findsNWidgets(2));
      expect(find.textContaining('不代表平台称重认证'), findsOneWidget);
      expect(paths.single.path, '/step5/fish-leaderboard');

      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('2026 年 9 月').last);
      await tester.pumpAndSettle();

      expect(paths.last.queryParameters['month'], '2026-09');
      expect(find.text('这个月还没有上榜渔获'), findsOneWidget);
    },
  );
}
