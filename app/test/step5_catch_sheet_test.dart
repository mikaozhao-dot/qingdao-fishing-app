import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:qingdao_fishing_app/api_client.dart';
import 'package:qingdao_fishing_app/step5_flow.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    Step1Api.clientOverride = MockClient((request) async {
      expect(request.url.path, '/step5/fish-catalog');
      return http.Response(
        jsonEncode({
          'items': [
            {'code': 'yellow_croaker', 'name': '小黄鱼'},
            {'code': 'sea_bass', 'name': '鲈鱼'},
          ],
        }),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
  });

  tearDown(() => Step1Api.clientOverride = null);

  testWidgets(
    'captain catch sheet adds a species and distinguishes zero catch',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: FilledButton(
                onPressed: () => showModalBottomSheet<void>(
                  context: context,
                  isScrollControlled: true,
                  builder: (_) => const Step5CaptainCatchSheet(
                    departureId: '00000000-0000-4000-8000-000000000001',
                    token: 'captain-token',
                  ),
                ),
                child: const Text('open report'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('open report'));
      await tester.pumpAndSettle();
      expect(find.text('回填本航渔获'), findsOneWidget);
      expect(find.text('本航零渔获'), findsOneWidget);
      await tester.tap(find.text('添加鱼种'));
      await tester.pumpAndSettle();
      expect(find.text('数量（尾）'), findsOneWidget);
      expect(find.text('小黄鱼'), findsOneWidget);
      await tester.tap(find.text('本航零渔获'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<SwitchListTile>(find.byType(SwitchListTile).first).value,
        isTrue,
      );
      expect(find.text('添加鱼种'), findsNothing);
      expect(find.text('提交航次记录'), findsOneWidget);
    },
  );

  testWidgets(
    'angler page exposes catch, response, and structured review controls',
    (tester) async {
      const departureId = '00000000-0000-4000-8000-000000000002';
      Step1Api.clientOverride = MockClient((request) async {
        if (request.url.path == '/step5/fish-catalog') {
          return http.Response(
            jsonEncode({
              'items': [
                {'code': 'yellow_croaker', 'name': '小黄鱼'},
              ],
            }),
            200,
            headers: {'content-type': 'application/json'},
          );
        }
        expect(request.url.path, '/step5/departures/$departureId/me');
        return http.Response(
          jsonEncode({
            'role': 'passenger',
            'departureId': departureId,
            'captainReport': null,
            'ownReport': null,
            'captainResponse': null,
            'reconciliation': null,
            'review': null,
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      await tester.pumpWidget(
        const MaterialApp(
          home: Step5AnglerReportPage(
            departureId: departureId,
            orderId: '00000000-0000-4000-8000-000000000003',
            token: 'angler-token',
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('返港记录与评价'), findsOneWidget);
      expect(find.text('填写本人实际渔获'), findsOneWidget);
      expect(find.text('船长服务'), findsOneWidget);
      expect(find.text('船况体验'), findsOneWidget);
      await tester.tap(find.text('填写本人实际渔获'));
      await tester.pumpAndSettle();
      expect(find.text('添加鱼种'), findsOneWidget);
      await tester.tap(find.text('添加鱼种'));
      await tester.pumpAndSettle();
      expect(find.text('数量（尾）'), findsOneWidget);
    },
  );

  testWidgets(
    'angler can submit catch and captain response in either order without reposting a source',
    (tester) async {
      Future<void> runCase({required bool submitCatchFirst}) async {
        const departureId = '00000000-0000-4000-8000-000000000004';
        final trip = <String, dynamic>{
          'role': 'passenger',
          'departureId': departureId,
          'captainReport': {
            'outcome': 'caught',
            'items': [
              {'fishCode': 'yellow_croaker', 'quantity': 2},
            ],
          },
          'ownReport': null,
          'captainResponse': null,
          'reconciliation': null,
          'review': null,
        };
        final payloads = <Map<String, dynamic>>[];
        Step1Api.clientOverride = MockClient((request) async {
          if (request.url.path == '/step5/fish-catalog') {
            return http.Response(
              jsonEncode({
                'items': [
                  {'code': 'yellow_croaker', 'name': '小黄鱼'},
                ],
              }),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          if (request.url.path == '/step5/departures/$departureId/me') {
            return http.Response(
              jsonEncode(trip),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          expect(
            request.url.path,
            '/step5/departures/$departureId/passenger-catch',
          );
          final payload = jsonDecode(request.body) as Map<String, dynamic>;
          payloads.add(payload);
          if (payload.containsKey('catchReport')) {
            if (trip['ownReport'] != null) {
              return http.Response('{"error":"duplicate catch source"}', 409);
            }
            trip['ownReport'] = payload['catchReport'];
          }
          if (payload.containsKey('captainResponse')) {
            if (trip['captainResponse'] != null) {
              return http.Response(
                '{"error":"duplicate response source"}',
                409,
              );
            }
            trip['captainResponse'] = payload['captainResponse'];
          }
          return http.Response('{"ok":true}', 201);
        });

        await tester.pumpWidget(
          const MaterialApp(
            home: Step5AnglerReportPage(
              departureId: departureId,
              orderId: '00000000-0000-4000-8000-000000000005',
              token: 'angler-token',
            ),
          ),
        );
        await tester.pumpAndSettle();

        Future<void> addOwnCatch() async {
          final toggle = find.widgetWithText(SwitchListTile, '填写本人实际渔获');
          await tester.ensureVisible(toggle);
          await tester.pumpAndSettle();
          await tester.tap(toggle);
          await tester.pumpAndSettle();
          await tester.tap(find.text('添加鱼种'));
          await tester.pumpAndSettle();
        }

        Future<void> confirmCaptainCatch() async {
          final responseDropdown = find.byType(DropdownButtonFormField<String>);
          await tester.ensureVisible(responseDropdown);
          await tester.pumpAndSettle();
          await tester.tap(responseDropdown);
          await tester.pumpAndSettle();
          await tester.tap(find.text('确认船长记录').last);
          await tester.pumpAndSettle();
        }

        Future<void> submit() async {
          final submitButton = find.text('提交渔获与回应');
          await tester.ensureVisible(submitButton);
          await tester.pumpAndSettle();
          await tester.tap(submitButton);
          await tester.pumpAndSettle();
        }

        if (submitCatchFirst) {
          await addOwnCatch();
          await submit();
          await confirmCaptainCatch();
          await submit();
          expect(payloads, hasLength(2));
          expect(payloads[0].keys, contains('catchReport'));
          expect(payloads[0].keys, isNot(contains('captainResponse')));
          expect(payloads[1].keys, contains('captainResponse'));
          expect(payloads[1].keys, isNot(contains('catchReport')));
          expect(trip['ownReport']['items'], [
            {'fishCode': 'yellow_croaker', 'quantity': 1},
          ]);
          expect(trip['captainResponse']['action'], 'confirm');
        } else {
          await confirmCaptainCatch();
          await submit();
          await addOwnCatch();
          await submit();
          expect(payloads, hasLength(2));
          expect(payloads[0].keys, contains('captainResponse'));
          expect(payloads[0].keys, isNot(contains('catchReport')));
          expect(payloads[1].keys, contains('catchReport'));
          expect(payloads[1].keys, isNot(contains('captainResponse')));
          expect(trip['captainResponse']['action'], 'confirm');
          expect(trip['ownReport']['items'], [
            {'fishCode': 'yellow_croaker', 'quantity': 1},
          ]);
        }
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pumpAndSettle();
      }

      await runCase(submitCatchFirst: true);
      await runCase(submitCatchFirst: false);
    },
  );

  testWidgets(
    'personal fish atlas shows all species without lighting unreported fish',
    (tester) async {
      Step1Api.clientOverride = MockClient((request) async {
        expect(request.url.path, '/step5/me/fish-atlas');
        return http.Response(
          jsonEncode({'items': [], 'sourceRule': 'personal reports only'}),
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      await tester.pumpWidget(
        const MaterialApp(home: Step5FishAtlasPage(token: 'angler-token')),
      );
      await tester.pumpAndSettle();
      expect(find.text('小黄鱼'), findsOneWidget);
      expect(find.text('黄条鰤'), findsOneWidget);
      expect(find.text('待点亮'), findsNWidgets(17));
    },
  );
}
