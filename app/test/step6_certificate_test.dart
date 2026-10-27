import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:qingdao_fishing_app/api_client.dart';
import 'package:qingdao_fishing_app/step6_certificate_flow.dart';
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
}
