import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:qingdao_fishing_app/fishing_tokens.dart';
import 'package:qingdao_fishing_app/step4_flow.dart';

const _token = String.fromEnvironment('STEP4_SCREENSHOT_TOKEN');
const _orderId = String.fromEnvironment('STEP4_SCREENSHOT_ORDER_ID');
const _captainToken = String.fromEnvironment('STEP4_SCREENSHOT_CAPTAIN_TOKEN');
const _captainConfirmedToken = String.fromEnvironment(
  'STEP4_SCREENSHOT_CONFIRMED_TOKEN',
);
const _captainConfirmedDepartureId = String.fromEnvironment(
  'STEP4_SCREENSHOT_CONFIRMED_DEPARTURE_ID',
);
const _captainConfirmedOrderId = String.fromEnvironment(
  'STEP4_SCREENSHOT_CONFIRMED_ORDER_ID',
);

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'real sandbox API drives supplement through confirmed departure',
    (tester) async {
      if (_token.isEmpty || _orderId.isEmpty) {
        fail('Provide STEP4_SCREENSHOT_TOKEN and STEP4_SCREENSHOT_ORDER_ID.');
      }
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
              token: _token,
              onOpenProfile: () {},
              onTokenChanged: (_) {},
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final orderTile = find.byKey(const ValueKey('order-$_orderId'));
      await tester.scrollUntilVisible(
        orderTile,
        450,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(orderTile);
      await tester.pumpAndSettle();

      expect(find.text('成团补差'), findsOneWidget);
      expect(find.text('待确认'), findsOneWidget);
      expect(find.text('待处置 · 未达成行门槛'), findsOneWidget);
      expect(find.text('平台可核验金额尚差 ¥0.01，班次待处置。'), findsOneWidget);
      expect(
        await binding.takeScreenshot('21-step4-formation-shortfall'),
        isNotEmpty,
      );
      await tester.ensureVisible(find.text('同意本轮补差'));
      await tester.pumpAndSettle();
      expect(find.text('¥0.01'), findsNWidgets(2));
      expect(
        await binding.takeScreenshot('18-step4-supplement-consent'),
        isNotEmpty,
      );

      await tester.tap(find.text('同意本轮补差'));
      await tester.pumpAndSettle();
      expect(find.text('等待补差支付'), findsOneWidget);
      await tester.ensureVisible(find.text('继续沙盒补差支付'));
      await tester.pumpAndSettle();
      expect(
        await binding.takeScreenshot('19-step4-supplement-payment'),
        isNotEmpty,
      );

      await tester.tap(find.text('继续沙盒补差支付'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('模拟支付成功'));
      await tester.pumpAndSettle();
      expect(find.text('补差完成'), findsOneWidget);
      expect(find.text('平台已成行'), findsOneWidget);
      expect(
        await binding.takeScreenshot('20-step4-supplement-complete'),
        isNotEmpty,
      );
    },
  );

  testWidgets(
    'real sandbox API shows captain-confirmed actions and guarantee boundary',
    (tester) async {
      if (_captainToken.isEmpty ||
          _captainConfirmedToken.isEmpty ||
          _captainConfirmedDepartureId.isEmpty ||
          _captainConfirmedOrderId.isEmpty) {
        fail('Provide captain-confirmed departure fixture values.');
      }
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
            body: Step4CaptainWorkspace(
              token: _captainToken,
              onOpenProfile: () {},
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final tripCard = find.byKey(
        const ValueKey('captain-trip-$_captainConfirmedDepartureId'),
      );
      await tester.scrollUntilVisible(
        tripCard,
        450,
        scrollable: find.byType(Scrollable).first,
      );
      expect(
        find.descendant(of: tripCard, matching: find.text('船长已确认成行')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: tripCard, matching: find.text('出航打卡')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: tripCard, matching: find.text('行前清单')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: tripCard, matching: find.text('核对登船门禁')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: tripCard, matching: find.text('掩码名单')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: tripCard, matching: find.text('实名名单')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: tripCard, matching: find.text('平台未补足差额，也不担保整船收入。')),
        findsOneWidget,
      );
      expect(
        await binding.takeScreenshot('22-step4-captain-confirmed'),
        isNotEmpty,
      );
    },
  );

  testWidgets(
    'real sandbox API explains captain confirmation on the passenger trip page',
    (tester) async {
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
              token: _captainConfirmedToken,
              onOpenProfile: () {},
              onTokenChanged: (_) {},
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final orderTile = find.byKey(
        const ValueKey('order-$_captainConfirmedOrderId'),
      );
      await tester.scrollUntilVisible(
        orderTile,
        450,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(orderTile);
      await tester.pumpAndSettle();
      expect(find.text('船长已确认成行'), findsOneWidget);
      expect(find.text('平台未补足差额，也不担保整船收入。'), findsOneWidget);
      expect(
        await binding.takeScreenshot('23-step4-captain-confirmed-angler'),
        isNotEmpty,
      );
    },
  );
}
