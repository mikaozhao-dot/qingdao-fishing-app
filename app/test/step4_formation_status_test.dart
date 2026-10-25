import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:qingdao_fishing_app/api_client.dart';
import 'package:qingdao_fishing_app/step4_flow.dart';

http.Response _jsonResponse(
  Map<String, dynamic> body, [
  int statusCode = 200,
]) => http.Response(
  jsonEncode(body),
  statusCode,
  headers: const {'content-type': 'application/json; charset=utf-8'},
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<void> pumpAnglerOrder(
    WidgetTester tester, {
    required String departureStatus,
    bool? preConfirmationMeetsThreshold,
    bool? platformGuarantee,
  }) async {
    Step1Api.clientOverride = MockClient((request) async {
      final path = request.url.path;
      if (path == '/orders') {
        return _jsonResponse({
          'items': [
            {
              'id': 'order-1',
              'boatName': '海钓测试船',
              'departureAt': '2026-10-28T08:00:00Z',
              'seatCount': 1,
              'totalFen': 50000,
              'status': 'paid',
            },
          ],
        });
      }
      if (path == '/orders/order-1') {
        return _jsonResponse({
          'order': {
            'id': 'order-1',
            'boatName': '海钓测试船',
            'orderNumber': 'TEST-001',
            'status': 'paid',
          },
        });
      }
      if (path == '/orders/order-1/fulfillment') {
        return _jsonResponse({
          'orderStatus': 'paid',
          'departure': {
            'id': 'departure-1',
            'status': departureStatus,
            'departureAt': '2026-10-28T08:00:00Z',
            'meetingAt': '2026-10-28T07:30:00Z',
            'marinaCode': '小港码头',
            'tripType': 'pro_fishing',
            'formationShortfallFen': null,
            'preConfirmationMeetsThreshold': preConfirmationMeetsThreshold,
            'platformGuarantee': platformGuarantee,
          },
          'checklist': null,
        });
      }
      if (path == '/orders/order-1/supplement-round') {
        return _jsonResponse({'round': null});
      }
      return _jsonResponse({'error': 'unexpected request: $path'}, 404);
    });
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Step4AnglerWorkspace(
            token: 'angler-token',
            onOpenProfile: () {},
            onTokenChanged: (_) {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('海钓测试船').first);
    await tester.pumpAndSettle();
  }

  tearDown(() => Step1Api.clientOverride = null);

  testWidgets(
    'angler distinguishes a threshold-met departure still awaiting confirmation',
    (tester) async {
      await pumpAnglerOrder(
        tester,
        departureStatus: 'open',
        preConfirmationMeetsThreshold: true,
      );
      expect(find.text('已达最低成行 · 待确认'), findsOneWidget);
    },
  );

  testWidgets(
    'angler labels an under-threshold departure still awaiting confirmation',
    (tester) async {
      await pumpAnglerOrder(
        tester,
        departureStatus: 'open',
        preConfirmationMeetsThreshold: false,
      );
      expect(find.text('待确认 · 尚未达最低门槛'), findsOneWidget);
    },
  );

  testWidgets('captain confirmation explains the platform guarantee boundary', (
    tester,
  ) async {
    await pumpAnglerOrder(
      tester,
      departureStatus: 'captain_confirmed',
      platformGuarantee: false,
    );
    expect(find.text('船长已确认成行'), findsOneWidget);
    expect(find.text('平台未补足差额，也不担保整船收入。'), findsOneWidget);
  });

  testWidgets(
    'captain-confirmed trips expose the same supported actions as confirmed trips',
    (tester) async {
      Step1Api.clientOverride = MockClient((request) async {
        if (request.url.path == '/captain/fulfillment') {
          return _jsonResponse({
            'items': [
              {
                'id': 'departure-1',
                'status': 'captain_confirmed',
                'platformGuarantee': false,
                'departureAt': '2026-10-28T08:00:00Z',
                'meetingAt': '2026-10-28T07:30:00Z',
                'marinaCode': '小港码头',
                'tripType': 'pro_fishing',
              },
            ],
          });
        }
        return _jsonResponse({'error': 'unexpected request'}, 404);
      });
      await tester.pumpWidget(
        MaterialApp(
          home: Step4CaptainWorkspace(
            token: 'captain-token',
            onOpenProfile: () {},
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('出航打卡'), findsOneWidget);
      expect(find.text('行前清单'), findsOneWidget);
      expect(find.text('掩码名单'), findsOneWidget);
      expect(find.text('实名名单'), findsOneWidget);
      expect(find.text('核对登船门禁'), findsOneWidget);
      expect(find.text('平台未补足差额，也不担保整船收入。'), findsOneWidget);
    },
  );
}
