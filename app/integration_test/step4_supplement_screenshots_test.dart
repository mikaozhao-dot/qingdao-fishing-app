import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:integration_test/integration_test.dart';
import 'package:qingdao_fishing_app/api_client.dart';
import 'package:qingdao_fishing_app/fishing_tokens.dart';
import 'package:qingdao_fishing_app/step4_flow.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  http.Response utf8Response(String body, int status) => http.Response(
    body,
    status,
    headers: const {'content-type': 'application/json; charset=utf-8'},
  );

  testWidgets('captures mock supplement consent, payment, and completion', (
    tester,
  ) async {
    const orderId = '00000000-0000-4000-8000-000000000001';
    const roundId = '00000000-0000-4000-8000-000000000002';
    var roundStatus = 'collecting_consent';
    var consentStatus = 'pending';
    var paymentStatus = 'not_started';

    Step1Api.clientOverride = MockClient((request) async {
      final path = request.url.path;
      if (request.method == 'GET' && path == '/orders') {
        return utf8Response(
          jsonEncode({
            'items': [
              {
                'id': orderId,
                'orderNumber': 'QD-DEMO-26001',
                'status': 'paid',
                'totalFen': 50000,
                'seatCount': 1,
                'boatName': '青礁号',
                'departureAt': '2026-10-28T01:00:00.000Z',
              },
            ],
          }),
          200,
        );
      }
      if (request.method == 'GET' && path == '/orders/$orderId') {
        return utf8Response(
          jsonEncode({
            'order': {
              'id': orderId,
              'orderNumber': 'QD-DEMO-26001',
              'status': 'paid',
              'boatName': '青礁号',
            },
          }),
          200,
        );
      }
      if (request.method == 'GET' && path == '/orders/$orderId/fulfillment') {
        return utf8Response(
          jsonEncode({
            'departure': {
              'id': '00000000-0000-4000-8000-000000000003',
              'status': roundStatus == 'succeeded'
                  ? 'confirmed'
                  : 'handling_shortfall',
              'departureAt': '2026-10-28T01:00:00.000Z',
              'meetingAt': '2026-10-28T00:30:00.000Z',
              'marinaCode': '青岛小港码头',
            },
            'checklist': {},
          }),
          200,
        );
      }
      if (request.method == 'GET' &&
          path == '/orders/$orderId/supplement-round') {
        return utf8Response(
          jsonEncode({
            'round': {
              'id': roundId,
              'status': roundStatus,
              'responseDeadlineAt': '2026-10-26T10:00:00.000Z',
              'shortfallFen': 35000,
              'participant': {
                'id': '00000000-0000-4000-8000-000000000004',
                'orderId': orderId,
                'amountFen': 3889,
                'seatCount': 1,
                'consentStatus': consentStatus,
                'paymentStatus': paymentStatus,
              },
            },
          }),
          200,
        );
      }
      if (request.method == 'POST' &&
          path == '/orders/$orderId/supplement-rounds/$roundId/decision') {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        if (body['action'] == 'accept') {
          consentStatus = 'accepted';
          roundStatus = 'collecting_payment';
        }
        return utf8Response(
          jsonEncode({
            'round': {'id': roundId, 'status': roundStatus},
          }),
          200,
        );
      }
      if (request.method == 'POST' &&
          path ==
              '/orders/$orderId/supplement-rounds/$roundId/payment-intents') {
        paymentStatus = 'pending';
        return utf8Response(
          jsonEncode({
            'payment': {
              'id': '00000000-0000-4000-8000-000000000005',
              'amountFen': 3889,
              'status': 'pending',
              'adapter': 'sandbox',
              'checkoutUrl': 'sandbox-pay://supplement/demo',
            },
          }),
          201,
        );
      }
      if (request.method == 'POST' &&
          path ==
              '/orders/$orderId/supplement-rounds/$roundId/sandbox-payment') {
        roundStatus = 'succeeded';
        paymentStatus = 'succeeded';
        return utf8Response(jsonEncode({'status': 'succeeded'}), 200);
      }
      return utf8Response(
        jsonEncode({'error': 'unexpected request: ${request.method} $path'}),
        404,
      );
    });
    addTearDown(() => Step1Api.clientOverride = null);

    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          useMaterial3: true,
          colorScheme:
              ColorScheme.fromSeed(
                seedColor: FishingTokens.brand,
                brightness: Brightness.dark,
                surface: FishingTokens.surface,
              ).copyWith(
                primary: FishingTokens.brand,
                onPrimary: FishingTokens.background,
                secondary: FishingTokens.success,
                onSecondary: FishingTokens.background,
                onSurface: FishingTokens.ink,
                error: const Color(0xFFD9786C),
                onError: FishingTokens.background,
              ),
          scaffoldBackgroundColor: FishingTokens.background,
          appBarTheme: const AppBarTheme(
            backgroundColor: FishingTokens.background,
            foregroundColor: FishingTokens.ink,
            elevation: 0,
            surfaceTintColor: Colors.transparent,
          ),
        ),
        home: Scaffold(
          body: Step4AnglerWorkspace(
            token: 'integration-test-token',
            onOpenProfile: () {},
            onTokenChanged: (_) {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('青礁号').first);
    await tester.pumpAndSettle();

    expect(find.text('成团补差'), findsOneWidget);
    await tester.ensureVisible(find.text('同意本轮补差'));
    await tester.pumpAndSettle();
    expect(find.text('本轮缺口'), findsOneWidget);
    expect(find.text('¥38.89'), findsOneWidget);
    expect(
      await binding.takeScreenshot('mock-18-step4-supplement-consent'),
      isNotEmpty,
    );

    await tester.tap(find.text('同意本轮补差'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('继续沙盒补差支付'));
    await tester.pumpAndSettle();
    expect(find.text('等待补差支付'), findsOneWidget);
    expect(
      await binding.takeScreenshot('mock-19-step4-supplement-payment'),
      isNotEmpty,
    );

    await tester.tap(find.text('继续沙盒补差支付'));
    await tester.pumpAndSettle();
    expect(find.text('模拟支付成功'), findsOneWidget);
    await tester.tap(find.text('模拟支付成功'));
    await tester.pumpAndSettle();
    expect(find.text('补差完成'), findsOneWidget);
    expect(find.text('平台已成行'), findsOneWidget);
    expect(
      await binding.takeScreenshot('mock-20-step4-supplement-complete'),
      isNotEmpty,
    );
  });
}
