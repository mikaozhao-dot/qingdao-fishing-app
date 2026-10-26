import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:qingdao_fishing_app/api_client.dart';
import 'package:qingdao_fishing_app/step2_flow.dart';

http.Response _json(Map<String, dynamic> value) => http.Response(
  jsonEncode(value),
  200,
  headers: const {'content-type': 'application/json; charset=utf-8'},
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  tearDown(() => Step1Api.clientOverride = null);

  testWidgets('workbench refreshes live badge after detail starts and ends', (
    tester,
  ) async {
    var live = false;
    var captainDepartureLoads = 0;
    const tripDateTime = '2026-10-28  05:00';
    Step1Api.clientOverride = MockClient((request) async {
      final path = request.url.path;
      if (path == '/step2/options') return _json({});
      if (path == '/captain/departure-context') return _json({'boats': []});
      if (path == '/captain/departures') {
        captainDepartureLoads += 1;
        return _json({
          'items': [
            {
              'id': 'trip-1',
              'status': 'in_progress',
              'departureDate': '2026-10-28',
              'departureTime': '05:00',
              'returnTime': '12:00',
              'captainName': '测试船长',
              'marinaName': '小港码头',
              'targetAreaName': '青岛近海',
              'tripType': 'pro_fishing',
              'bookedSeatCount': 0,
              'totalSeatCount': 4,
              'platformQuotaSeats': 4,
              'pricePerSeatFen': 50000,
              'liveStatus': {
                'active': live,
                'profileUrl': 'https://www.douyin.com/user/captain',
              },
              'boat': {
                'id': 'boat-1',
                'name': '海钓测试船',
                'lengthCm': 900,
                'seatCount': 4,
              },
              'fishTargets': [],
            },
          ],
        });
      }
      if (path == '/departures/trip-1') {
        return _json({
          'departure': {
            'id': 'trip-1',
            'status': 'in_progress',
            'departureDate': '2026-10-28',
            'departureTime': '05:00',
            'returnTime': '12:00',
            'meetingTime': '04:30',
            'bookingDeadline': '2026-10-27T12:00:00Z',
            'captainName': '测试船长',
            'marinaName': '小港码头',
            'targetAreaName': '青岛近海',
            'tripType': 'pro_fishing',
            'bookedSeatCount': 0,
            'totalSeatCount': 4,
            'platformQuotaSeats': 4,
            'pricePerSeatFen': 50000,
            'minimumTotalFen': 100000,
            'bookedAmountFen': 0,
            'remainingMinimumFen': 100000,
            'liveStatus': {
              'active': live,
              'profileUrl': 'https://www.douyin.com/user/captain',
            },
            'boat': {
              'id': 'boat-1',
              'name': '海钓测试船',
              'lengthCm': 900,
              'seatCount': 4,
              'facilities': [],
            },
            'rigConfig': {
              'baitTypes': [],
              'baitGramsPerPerson': 0,
              'mainLinePe': 1,
              'leaderLineNumber': 2,
              'sinkerShape': 'round',
              'sinkerMinGrams': 20,
              'sinkerMaxGrams': 60,
            },
            'seats': [],
            'fishTargets': [],
          },
        });
      }
      if (path == '/step5/departures/trip-1/live/start') {
        live = true;
        return _json({'active': true});
      }
      if (path == '/step5/departures/trip-1/live/end') {
        live = false;
        return _json({'active': false});
      }
      return _json({'error': 'unexpected request: $path'});
    });

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Step2Workspace(
            roleLabel: '船长端',
            tabLabel: '工作台',
            token: 'captain-token',
            onTokenChanged: (_) {},
            onOpenProfile: () {},
            onSelectTab: (_) {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(captainDepartureLoads, 1);
    expect(find.text('直播中 · 抖音'), findsNothing);
    await tester.tap(find.text(tripDateTime));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('标记开始直播'),
      300,
      scrollable: find.byType(Scrollable).last,
    );
    await tester.tap(find.text('标记开始直播'));
    await tester.pumpAndSettle();
    expect(find.text('结束直播状态'), findsOneWidget);
    await tester.pageBack();
    await tester.pumpAndSettle();

    expect(captainDepartureLoads, 2);
    expect(find.text('直播中 · 抖音'), findsOneWidget);

    await tester.tap(find.text(tripDateTime));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('结束直播状态'),
      300,
      scrollable: find.byType(Scrollable).last,
    );
    await tester.tap(find.text('结束直播状态'));
    await tester.pumpAndSettle();
    await tester.pageBack();
    await tester.pumpAndSettle();

    expect(captainDepartureLoads, 3);
    expect(find.text('直播中 · 抖音'), findsNothing);
  });
}
