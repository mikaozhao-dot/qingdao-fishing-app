import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:qingdao_fishing_app/api_client.dart';
import 'package:qingdao_fishing_app/step3_flow.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late List<int> platformSeatNumbers;
  List<String>? heldSeatIds;

  void installMockApi() {
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
                  'isPremium': number >= 5 && number <= 8,
                  'saleChannel': platformSeatNumbers.contains(number)
                      ? 'platform'
                      : 'offline',
                },
            ],
            'seats': [
              for (final number in platformSeatNumbers)
                {
                  'id': 'inventory-$number',
                  'number': number,
                  'side': number <= 6 ? 'port' : 'starboard',
                  'section': number <= 2 || number >= 11
                      ? 'bow'
                      : number <= 4 || number >= 9
                      ? 'mid'
                      : 'stern',
                  'isPremium': number >= 5 && number <= 8,
                  'priceFen': number >= 5 && number <= 8 ? 60000 : 50000,
                  'status': 'available',
                },
            ],
          }),
          200,
        );
      } else if (request.method == 'POST' &&
          request.url.path.endsWith('/seat-holds')) {
        heldSeatIds =
            (jsonDecode(request.body) as Map<String, dynamic>)['seatIds']
                .cast<String>();
        return http.Response(
          jsonEncode({
            'holdId': 'test-hold',
            'expiresAt': DateTime.now()
                .add(const Duration(minutes: 10))
                .toIso8601String(),
          }),
          200,
        );
      }
      return http.Response(
        jsonEncode({'error': 'unexpected test request'}),
        404,
      );
    });
  }

  Future<void> openSeatPage(WidgetTester tester, {required Size size}) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = size;
    await tester.pumpWidget(
      const MaterialApp(
        home: SeatSelectionPage(
          departureId: 'test-departure',
          token: 'test-token',
        ),
      ),
    );
    await tester.pumpAndSettle(const Duration(milliseconds: 50));
  }

  void expectNoSeatOverlap(WidgetTester tester) {
    final markers = [
      for (var number = 1; number <= 12; number++)
        tester.getRect(find.byKey(ValueKey('seat-$number'))),
    ];
    for (var left = 0; left < markers.length; left++) {
      for (var right = left + 1; right < markers.length; right++) {
        expect(
          markers[left].overlaps(markers[right]),
          isFalse,
          reason:
              'seat ${left + 1} and seat ${right + 1} must have separate hit regions',
        );
      }
    }
  }

  setUp(() {
    heldSeatIds = null;
    platformSeatNumbers = [];
  });

  tearDown(() {
    Step1Api.clientOverride = null;
  });

  testWidgets(
    '4+8 keeps all positions visible without making offline seats selectable',
    (tester) async {
      platformSeatNumbers = [1, 2, 3, 4];
      installMockApi();
      await openSeatPage(tester, size: const Size(320, 568));

      expect(find.textContaining('共 12 席'), findsOneWidget);
      expect(find.textContaining('4 席线上库存'), findsOneWidget);
      expectNoSeatOverlap(tester);

      final offlineFive = find.byKey(const ValueKey('seat-5'));
      await tester.ensureVisible(offlineFive);
      final offlineFiveRect = tester.getRect(offlineFive);
      await tester.tapAt(
        Offset(offlineFiveRect.right - 7.5, offlineFiveRect.top + 7.5),
      );
      await tester.pump();
      expect(find.text('请选择座位'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('premium badge and transparent marker edges stay tappable', (
    tester,
  ) async {
    platformSeatNumbers = [1, 2, 3, 4, 5, 6, 7, 8];
    installMockApi();
    await openSeatPage(tester, size: const Size(390, 844));

    expect(find.textContaining('共 12 席'), findsOneWidget);
    expect(find.textContaining('8 席线上库存'), findsOneWidget);
    expectNoSeatOverlap(tester);
    final seatFive = find.byKey(const ValueKey('seat-5'));
    await tester.ensureVisible(seatFive);
    final seatFiveRect = tester.getRect(seatFive);
    await tester.tapAt(
      Offset(seatFiveRect.right - 7.5, seatFiveRect.top + 7.5),
    );
    await tester.pump();
    expect(find.text('5号位（左舷 · 船尾）'), findsOneWidget);
    expect(find.text('¥600.00/位'), findsOneWidget);

    final transparentEdge = Offset(
      seatFiveRect.left + 3,
      seatFiveRect.center.dy,
    );
    await tester.tapAt(transparentEdge);
    await tester.pump();
    expect(find.text('请选择座位'), findsOneWidget);
    await tester.tapAt(transparentEdge);
    await tester.pump();
    expect(find.text('5号位（左舷 · 船尾）'), findsOneWidget);

    await tester.tap(find.text('确认选择'));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.runAsync(
      () async => Future<void>.delayed(const Duration(milliseconds: 100)),
    );
    await tester.pump();
    expect(heldSeatIds, ['inventory-5']);
    expect(tester.takeException(), isNull);
  });
}
