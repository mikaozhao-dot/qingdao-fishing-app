import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:share_plus/share_plus.dart';
import 'package:qingdao_fishing_app/api_client.dart';
import 'package:qingdao_fishing_app/promotion_flow.dart';

void main() {
  tearDown(() => Step1Api.clientOverride = null);

  test('promotion deep link accepts only the signed visitor token shape', () {
    final token = '${'a' * 32}.${'b' * 43}';
    expect(
      promotionVisitorTokenFromUri(
        Uri.parse('yuediaozhe://promotion?ref=$token'),
      ),
      token,
    );
    expect(
      promotionVisitorTokenFromUri(Uri.parse('https://promotion?ref=$token')),
      isNull,
    );
    expect(
      promotionVisitorTokenFromUri(
        Uri.parse('yuediaozhe://promotion?ref=short'),
      ),
      isNull,
    );
  });

  testWidgets(
    'promotion center shows live code, commission totals and referral policy',
    (tester) async {
      Step1Api.clientOverride = MockClient((request) async {
        expect(request.url.path, '/promotions/me');
        return http.Response(
          jsonEncode({
            'codes': [
              {
                'id': 'code-1',
                'code': 'AB12CD34',
                'channel': 'member',
                'status': 'active',
                'scanCount': 3,
                'attributionCount': 2,
                'validMemberCount': 1,
                'landingUrl': 'https://example.test/p/AB12CD34?source=qr',
              },
              {
                'id': 'code-2',
                'code': 'WAITING1',
                'channel': 'hotel',
                'status': 'pending',
                'scanCount': 0,
                'attributionCount': 0,
                'validMemberCount': 0,
              },
            ],
            'totals': {
              'total_fen': 2460,
              'frozen_fen': 1200,
              'available_fen': 500,
              'withdrawal_pending_fen': 0,
              'paid_fen': 760,
              'refund_exception_count': 1,
            },
            'commissions': [
              {
                'id': 'commission-1',
                'amountFen': 500,
                'netTicketAmountFen': 10000,
                'status': 'available',
                'releaseAt': '2026-11-01T00:00:00.000Z',
                'orderNumber': 'QD-TEST-1',
                'refundAfterRelease': false,
                'promotionCode': 'AB12CD34',
                'sourceChannel': 'member',
              },
            ],
            'attributions': [
              {
                'id': 'attribution-1',
                'status': 'qualified',
                'promotionCode': 'AB12CD34',
                'sourceChannel': 'member',
                'orderNumber': 'QD-TEST-1',
              },
            ],
            'payouts': [],
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      });

      await tester.pumpWidget(
        const MaterialApp(home: PromotionCenterPage(token: 'session-token')),
      );
      await tester.pumpAndSettle();

      expect(find.text('推广中心'), findsOneWidget);
      expect(find.text('¥24.6'), findsOneWidget);
      expect(find.text('¥5'), findsOneWidget);
      expect(find.text('AB12CD34'), findsNWidgets(2));
      expect(find.text('保存 / 分享海报'), findsOneWidget);
      await tester.scrollUntilVisible(
        find.text('WAITING1'),
        250,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('待审核'), findsOneWidget);
    },
  );

  testWidgets('poster share receives a generated PNG file', (tester) async {
    ShareParams? shared;
    Future<Uint8List?>? encodedPoster;
    Step1Api.clientOverride = MockClient((request) async {
      expect(request.url.path, '/promotions/me');
      return http.Response(
        jsonEncode({
          'codes': [
            {
              'id': 'code-1',
              'code': 'AB12CD34',
              'channel': 'member',
              'status': 'active',
              'scanCount': 0,
              'attributionCount': 0,
              'validMemberCount': 0,
              'landingUrl': 'https://example.test/p/AB12CD34?source=qr',
            },
          ],
          'totals': {},
          'commissions': [],
          'attributions': [],
          'payouts': [],
        }),
        200,
        headers: {'content-type': 'application/json'},
      );
    });

    await tester.pumpWidget(
      MaterialApp(
        home: PromotionCenterPage(
          token: 'session-token',
          sharePoster: (params) async {
            shared = params;
            return ShareResult.unavailable;
          },
          posterImageEncoder: (boundary) =>
              encodedPoster = tester.runAsync(() async {
                final image = await boundary.toImage(pixelRatio: 3);
                try {
                  final data = await image.toByteData(
                    format: ui.ImageByteFormat.png,
                  );
                  if (data == null) throw StateError('PNG encoding failed');
                  return Uint8List.view(
                    data.buffer,
                    data.offsetInBytes,
                    data.lengthInBytes,
                  );
                } finally {
                  image.dispose();
                }
              }),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final shareButton = find.text('保存 / 分享海报');
    final shareButtonWidget = find.ancestor(
      of: shareButton,
      matching: find.byType(OutlinedButton),
    );
    await tester.ensureVisible(shareButtonWidget);
    await tester.pumpAndSettle();
    await tester.tap(shareButtonWidget);
    await tester.pump();
    expect(encodedPoster, isNotNull);
    await encodedPoster;
    await tester.pumpAndSettle();
    expect(shared, isNotNull);
    expect(shared!.files, hasLength(1));
    final imageFile = shared!.files!.single;
    expect(imageFile.mimeType, 'image/png');
    expect(shared!.fileNameOverrides, ['约钓者-member-推广海报.png']);
    final bytes = await imageFile.readAsBytes();
    expect(bytes.take(8).toList(), [
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
    ]);
    expect(bytes.length, greaterThan(1000));
  });
}
