import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:qingdao_fishing_app/api_client.dart';
import 'package:qingdao_fishing_app/step6_certificate_flow.dart';
import 'package:qingdao_fishing_app/step5_flow.dart';
import 'package:share_plus/share_plus.dart';

const _departureId = '00000000-0000-4000-8000-000000000106';
const _certificateId = '00000000-0000-4000-8000-000000000206';
const _token = 'step6-certificate-test-token';

Map<String, dynamic> _snapshot() => {
  'templateVersion': 'qd-cert-v1',
  'departureAt': '2026-10-20T03:00:00.000Z',
  'boatName': '海风号',
  'captainName': '张船长',
  'displayName': '海边钓友',
  'fishItems': [
    {
      'fishCode': 'yellow_croaker',
      'fishName': '小黄鱼',
      'quantity': 3,
      'maxIndividualWeightGrams': 1250,
      'maxLengthMm': 410,
      'source': '本人记录',
    },
  ],
  'promotionCode': 'FISH2026',
  'landingUrl': 'https://promotion.example/p/FISH2026?source=certificate',
};

List<Map<String, dynamic>> _sameFishSourceRows(int count) => List.generate(
  count,
  (index) => {
    'fishCode': 'yellow_croaker',
    'fishName': '小黄鱼',
    'quantity': index + 1,
    'source': index.isEven ? '本人记录' : '本人补充',
  },
);

Future<void> _verifyCenterAfterPreviewReturn(
  WidgetTester tester, {
  required bool useSystemBack,
  required bool generate,
}) async {
  var listRequests = 0;
  var generated = false;
  Step1Api.clientOverride = MockClient((request) async {
    if (request.url.path == '/step6/certificates/me') {
      listRequests += 1;
      return http.Response(
        jsonEncode({
          'certificates': generated
              ? [
                  {
                    'id': _certificateId,
                    'templateVersion': 'qd-cert-v1',
                    'generatedAt': '2026-10-27T12:00:00.000Z',
                    'hidden': false,
                    'snapshot': _snapshot(),
                  },
                ]
              : [],
          'eligibleDepartures': generated
              ? []
              : [
                  {
                    'departureId': _departureId,
                    'departureAt': '2026-10-20T03:00:00.000Z',
                    'boatName': '海风号',
                    'captainName': '张船长',
                    'displayName': '海边钓友',
                    'fishSummary': ['小黄鱼 × 3'],
                  },
                ],
        }),
        200,
        headers: {'content-type': 'application/json'},
      );
    }
    if (request.url.path ==
        '/step6/certificates/departures/$_departureId/preview') {
      return http.Response(
        jsonEncode({'preview': _snapshot()}),
        200,
        headers: {'content-type': 'application/json'},
      );
    }
    if (request.url.path == '/step6/certificates' && request.method == 'POST') {
      generated = true;
      return http.Response(
        jsonEncode({
          'created': true,
          'certificate': {'id': _certificateId, 'snapshot': _snapshot()},
        }),
        201,
        headers: {'content-type': 'application/json'},
      );
    }
    fail('Unexpected request: ${request.method} ${request.url}');
  });

  await tester.binding.setSurfaceSize(const Size(390, 844));
  await tester.pumpWidget(
    MaterialApp(
      home: Step6CertificateCenterPage(token: _token, onRequireLogin: () {}),
    ),
  );
  await tester.pumpAndSettle();
  await tester.tap(find.text('预览证书'));
  await tester.pumpAndSettle();
  if (generate) {
    await tester.tap(find.text('生成并保存证书快照'));
    await tester.pumpAndSettle();
  }

  if (useSystemBack) {
    await tester.binding.handlePopRoute();
  } else {
    await tester.tap(find.byType(BackButton));
  }
  await tester.pumpAndSettle();

  expect(listRequests, generate ? 2 : 1);
  if (generate) {
    expect(find.text('还没有证书'), findsNothing);
    expect(find.text('预览证书'), findsNothing);
    expect(find.textContaining('1 条记录'), findsOneWidget);
  } else {
    expect(find.text('还没有证书'), findsOneWidget);
    expect(find.text('预览证书'), findsOneWidget);
  }
  await tester.binding.setSurfaceSize(null);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  tearDown(() => Step1Api.clientOverride = null);

  testWidgets(
    'certificate center previews, freezes, and shares a PNG without editable catch fields',
    (tester) async {
      ShareParams? sharedParams;
      Step1Api.clientOverride = MockClient((request) async {
        if (request.url.path == '/step6/certificates/me') {
          return http.Response(
            jsonEncode({
              'certificates': [],
              'eligibleDepartures': [
                {
                  'departureId': _departureId,
                  'departureAt': '2026-10-20T03:00:00.000Z',
                  'boatName': '海风号',
                  'captainName': '张船长',
                  'displayName': '海边钓友',
                  'fishSummary': ['小黄鱼 × 3'],
                },
              ],
            }),
            200,
            headers: {'content-type': 'application/json'},
          );
        }
        if (request.url.path ==
            '/step6/certificates/departures/$_departureId/preview') {
          return http.Response(
            jsonEncode({'preview': _snapshot()}),
            200,
            headers: {'content-type': 'application/json'},
          );
        }
        if (request.url.path == '/step6/certificates' &&
            request.method == 'POST') {
          expect(jsonDecode(request.body), {'departureId': _departureId});
          return http.Response(
            jsonEncode({
              'created': true,
              'certificate': {
                'id': _certificateId,
                'templateVersion': 'qd-cert-v1',
                'generatedAt': '2026-10-27T12:00:00.000Z',
                'hidden': false,
                'snapshot': _snapshot()
                  ..['generatedAt'] = '2026-10-27T12:00:00.000Z',
              },
            }),
            201,
            headers: {'content-type': 'application/json'},
          );
        }
        fail('Unexpected request: ${request.method} ${request.url}');
      });

      await tester.binding.setSurfaceSize(const Size(390, 844));
      await tester.pumpWidget(
        MaterialApp(
          home: Step6CertificateCenterPage(
            token: _token,
            onRequireLogin: () {},
            shareImage: (params) async {
              sharedParams = params;
            },
            imageEncoder: (_) async =>
                Uint8List.fromList([0x89, 0x50, 0x4e, 0x47]),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('可生成的航次'), findsOneWidget);
      expect(find.text('海风号'), findsOneWidget);
      await tester.tap(find.text('预览证书'));
      await tester.pumpAndSettle();

      expect(find.text('渔获纪念证'), findsOneWidget);
      expect(find.text('小黄鱼'), findsOneWidget);
      expect(find.byType(TextField), findsNothing);
      expect(find.text('生成并保存证书快照'), findsOneWidget);
      await tester.tap(find.text('生成并保存证书快照'));
      await tester.pumpAndSettle();
      expect(find.text('保存或分享图片'), findsOneWidget);

      await tester.tap(find.text('保存或分享图片'));
      await tester.pumpAndSettle();
      expect(sharedParams?.files, hasLength(1));
      expect(sharedParams?.files?.single.mimeType, 'image/png');
      expect(sharedParams?.fileNameOverrides?.single, contains('渔获证书'));

      await tester.binding.setSurfaceSize(null);
    },
  );

  testWidgets('generated certificate refreshes center after AppBar back', (
    tester,
  ) async {
    await _verifyCenterAfterPreviewReturn(
      tester,
      useSystemBack: false,
      generate: true,
    );
  });

  testWidgets('generated certificate refreshes center after system back', (
    tester,
  ) async {
    await _verifyCenterAfterPreviewReturn(
      tester,
      useSystemBack: true,
      generate: true,
    );
  });

  testWidgets('returning without generation keeps the original list state', (
    tester,
  ) async {
    await _verifyCenterAfterPreviewReturn(
      tester,
      useSystemBack: false,
      generate: false,
    );
  });

  testWidgets(
    'certificate artwork shows 1, 4, and 5 source rows without silent omission',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(390, 844));
      for (final count in [1, 4, 5]) {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: Center(
                child: RepaintBoundary(
                  key: const ValueKey('certificate-output'),
                  child: CertificateArtwork(
                    snapshot: _snapshot()
                      ..['fishItems'] = _sameFishSourceRows(count),
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();

        for (var index = 0; index < count.clamp(0, 4); index++) {
          expect(
            find.byKey(ValueKey('certificate-fish-row-$index')),
            findsOneWidget,
          );
        }
        expect(
          find.byKey(const ValueKey('certificate-fish-row-4')),
          findsNothing,
        );
        if (count <= 4) {
          expect(
            find.byKey(const ValueKey('certificate-omission-summary')),
            findsNothing,
          );
          expect(find.text('完整明细见 App 内本航次渔获详情'), findsNothing);
        } else {
          expect(find.textContaining('共 5 条渔获记录'), findsOneWidget);
          expect(find.textContaining('展示前 4 条'), findsOneWidget);
          expect(find.textContaining('另有 1 条未展示'), findsOneWidget);
          expect(find.text('完整明细见 App 内本航次渔获详情'), findsOneWidget);

          final artworkRect = tester.getRect(
            find.byKey(const ValueKey('certificate-artwork')),
          );
          final summaryRect = tester.getRect(
            find.byKey(const ValueKey('certificate-omission-summary')),
          );
          expect(summaryRect.top, greaterThanOrEqualTo(artworkRect.top));
          expect(summaryRect.bottom, lessThanOrEqualTo(artworkRect.bottom));

          final boundary = tester.renderObject<RenderRepaintBoundary>(
            find.byKey(const ValueKey('certificate-output')),
          );
          Uint8List? generatedPng;
          await tester.runAsync(() async {
            final image = await boundary.toImage(pixelRatio: 3);
            try {
              expect(image.width, 1080);
              expect(image.height, 1656);
              final pngData = await image.toByteData(
                format: ui.ImageByteFormat.png,
              );
              expect(pngData, isNotNull);
              generatedPng = Uint8List.fromList(
                pngData!.buffer.asUint8List(
                  pngData.offsetInBytes,
                  pngData.lengthInBytes,
                ),
              );
            } finally {
              image.dispose();
            }
          });
          final pngBytes = generatedPng!;
          expect(pngBytes.take(8).toList(), [137, 80, 78, 71, 13, 10, 26, 10]);
          expect(pngBytes.length, greaterThan(1000));
        }
        expect(tester.takeException(), isNull);
      }
      await tester.binding.setSurfaceSize(null);
    },
  );

  testWidgets(
    'saved certificate opens its existing read-only trip catch details',
    (tester) async {
      var detailLoaded = false;
      Step1Api.clientOverride = MockClient((request) async {
        if (request.url.path == '/step6/certificates/me') {
          return http.Response(
            jsonEncode({
              'certificates': [
                {
                  'id': _certificateId,
                  'departureId': _departureId,
                  'templateVersion': 'qd-cert-v1',
                  'generatedAt': '2026-10-27T12:00:00.000Z',
                  'hidden': false,
                  'snapshot': _snapshot(),
                },
              ],
              'eligibleDepartures': [],
            }),
            200,
            headers: {'content-type': 'application/json'},
          );
        }
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
        if (request.url.path == '/step5/departures/$_departureId/me') {
          detailLoaded = true;
          return http.Response(
            jsonEncode({
              'role': 'passenger',
              'departureId': _departureId,
              'captainReport': {
                'outcome': 'caught',
                'items': [
                  {'fishCode': 'yellow_croaker', 'quantity': 2},
                ],
              },
              'ownReport': {
                'outcome': 'caught',
                'items': [
                  {'fishCode': 'yellow_croaker', 'quantity': 3},
                ],
              },
              'captainResponse': {
                'action': 'supplement',
                'items': [
                  {'fishCode': 'yellow_croaker', 'quantity': 1},
                ],
              },
              'reconciliation': 'supplemented',
              'review': null,
            }),
            200,
            headers: {'content-type': 'application/json'},
          );
        }
        fail('Unexpected request: ${request.method} ${request.url}');
      });

      await tester.binding.setSurfaceSize(const Size(390, 844));
      await tester.pumpWidget(
        MaterialApp(
          home: Step6CertificateCenterPage(
            token: _token,
            onRequireLogin: () {},
            catchDetailsPageBuilder: (context, departureId, token) =>
                Step5AnglerReportPage(
                  departureId: departureId,
                  orderId: null,
                  token: token,
                  readOnly: true,
                ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('海风号'));
      await tester.pumpAndSettle();
      expect(find.text('查看本航次渔获详情'), findsOneWidget);
      await tester.tap(find.text('查看本航次渔获详情'));
      await tester.pumpAndSettle();

      expect(detailLoaded, isTrue);
      expect(find.text('本航次渔获详情'), findsOneWidget);
      expect(find.text('船长本航渔获'), findsOneWidget);
      expect(find.text('本人渔获记录'), findsOneWidget);
      expect(find.text('本人补充渔获'), findsOneWidget);
      expect(find.byType(TextField), findsNothing);
      expect(find.text('添加鱼种'), findsNothing);
      expect(find.text('提交渔获与回应'), findsNothing);
      expect(find.text('提交返港评价'), findsNothing);
      await tester.binding.setSurfaceSize(null);
    },
  );
}
