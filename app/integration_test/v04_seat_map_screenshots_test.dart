import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:integration_test/integration_test.dart';
import 'package:qingdao_fishing_app/api_client.dart';
import 'package:qingdao_fishing_app/step3_flow.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('captures 4+8 and 8+4 quota seat maps with live inventory states', (
    tester,
  ) async {
    Future<void> showScenario({
      required String name,
      required List<int> platformNumbers,
      required Set<int> premiumNumbers,
      required bool selectFive,
    }) async {
      Step1Api.clientOverride = MockClient((request) async {
        if (request.method == 'GET' && request.url.path.endsWith('/seats')) {
          return http.Response(
            jsonEncode({
              'seatCount': 12,
              'expiresInSeconds': 600,
              'seatLayout': [
                for (var number = 1; number <= 12; number++)
                  {
                    'number': number,
                    'side': number <= 6 ? 'port' : 'starboard',
                    'section': number <= 2 || number >= 11
                        ? 'bow'
                        : number <= 4 || number >= 9
                        ? 'mid'
                        : 'stern',
                    'isPremium': premiumNumbers.contains(number),
                    'saleChannel': platformNumbers.contains(number)
                        ? 'platform'
                        : 'offline',
                  },
              ],
              'seats': [
                for (final number in platformNumbers)
                  {
                    'id': 'inventory-$number',
                    'number': number,
                    'side': number <= 6 ? 'port' : 'starboard',
                    'section': number <= 2 || number >= 11
                        ? 'bow'
                        : number <= 4 || number >= 9
                        ? 'mid'
                        : 'stern',
                    'isPremium': premiumNumbers.contains(number),
                    'priceFen': premiumNumbers.contains(number) ? 60000 : 50000,
                    'status': 'available',
                  },
              ],
            }),
            200,
          );
        }
        return http.Response(
          jsonEncode({'error': 'unexpected integration request'}),
          404,
        );
      });

      await tester.pumpWidget(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          home: SeatSelectionPage(
            key: ValueKey(name),
            departureId: 'demo-$name',
            token: 'integration-test-token',
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('共 12 席'), findsOneWidget);
      expect(find.byIcon(Icons.settings_rounded), findsNWidgets(3));
      expect(
        find.textContaining('${platformNumbers.length} 席线上库存'),
        findsOneWidget,
      );

      final rects = [
        for (var number = 1; number <= 12; number++)
          tester.getRect(find.byKey(ValueKey('seat-$number'))),
      ];
      for (var left = 0; left < rects.length; left++) {
        for (var right = left + 1; right < rects.length; right++) {
          expect(
            rects[left].overlaps(rects[right]),
            isFalse,
            reason:
                'seat ${left + 1} and seat ${right + 1} hit regions must not overlap',
          );
        }
      }

      if (selectFive) {
        final seatFive = find.byKey(const ValueKey('seat-5'));
        await tester.ensureVisible(seatFive);
        await tester.tap(seatFive);
        await tester.pumpAndSettle();
      }
      final png = await binding.takeScreenshot(name);
      expect(png, isNotEmpty);
    }

    await showScenario(
      name: '15-v04-quota-4-plus-8-before',
      platformNumbers: [1, 2, 3, 4],
      premiumNumbers: {5, 6, 7, 8},
      selectFive: false,
    );
    await showScenario(
      name: '16-v04-quota-4-plus-8-after-seat-5',
      platformNumbers: [1, 2, 3, 4, 5],
      premiumNumbers: {6, 7},
      selectFive: true,
    );
    await showScenario(
      name: '17-v04-quota-8-plus-4-current',
      platformNumbers: [1, 2, 3, 4, 5, 6, 7, 8],
      premiumNumbers: {5, 6, 7, 8},
      selectFive: true,
    );
  });
}
