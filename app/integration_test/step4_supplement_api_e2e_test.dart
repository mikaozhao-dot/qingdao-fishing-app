import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:qingdao_fishing_app/fishing_tokens.dart';
import 'package:qingdao_fishing_app/step4_flow.dart';

const _token = String.fromEnvironment('STEP4_SCREENSHOT_TOKEN');
const _orderId = String.fromEnvironment('STEP4_SCREENSHOT_ORDER_ID');

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
      await tester.tap(find.text('配额验收船').last);
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
}
