import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:qingdao_fishing_app/api_client.dart';
import 'package:qingdao_fishing_app/fishing_tokens.dart';
import 'package:qingdao_fishing_app/step6_certificate_flow.dart';

const _departureId = '00000000-0000-4000-8000-000000000106';
const _certificateId = '00000000-0000-4000-8000-000000000206';
const _token = 'local-visual-demo-token';

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
    {
      'fishCode': 'sea_bass',
      'fishName': '鲈鱼',
      'quantity': 1,
      'maxIndividualWeightGrams': 2350,
      'maxLengthMm': 520,
      'source': '本人记录',
    },
    {
      'fishCode': 'blackhead',
      'fishName': '黑头（许氏平鲉）',
      'quantity': 2,
      'maxIndividualWeightGrams': 840,
      'maxLengthMm': 360,
      'source': '船长整船记录（本人确认）',
    },
  ],
  'promotionCode': 'FISH2026',
  'landingUrl': 'https://promotion.example/p/FISH2026?source=certificate',
};

void main() {
  // ignore: invalid_use_of_visible_for_testing_member
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
              'fishSummary': ['小黄鱼 × 3', '鲈鱼 × 1'],
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
      return http.Response(
        jsonEncode({
          'created': true,
          'certificate': {
            'id': _certificateId,
            'templateVersion': 'qd-cert-v1',
            'generatedAt': DateTime.now().toIso8601String(),
            'hidden': false,
            'snapshot': _snapshot()
              ..['generatedAt'] = DateTime.now().toIso8601String(),
          },
        }),
        201,
        headers: {'content-type': 'application/json'},
      );
    }
    return http.Response(
      '{"error":"visual demo route not configured"}',
      404,
      headers: {'content-type': 'application/json'},
    );
  });
  const screenFromBuild = String.fromEnvironment('SCREEN');
  final queryScreen = Uri.base.queryParameters['screen'] ?? '';
  runApp(
    _CertificateVisualDemo(
      screen: queryScreen.isNotEmpty ? queryScreen : screenFromBuild,
    ),
  );
}

class _CertificateVisualDemo extends StatelessWidget {
  const _CertificateVisualDemo({this.screen});

  final String? screen;

  @override
  Widget build(BuildContext context) {
    final scheme =
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
        );
    return MaterialApp(
      title: '渔获证书视觉预览',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: scheme,
        scaffoldBackgroundColor: FishingTokens.background,
        appBarTheme: const AppBarTheme(
          backgroundColor: FishingTokens.background,
          foregroundColor: FishingTokens.ink,
          elevation: 0,
          surfaceTintColor: Colors.transparent,
        ),
        cardTheme: CardThemeData(
          color: FishingTokens.surface,
          elevation: 0,
          shape: RoundedRectangleBorder(
            side: const BorderSide(color: FishingTokens.line),
            borderRadius: BorderRadius.circular(FishingTokens.radius22),
          ),
        ),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
            backgroundColor: FishingTokens.brand,
            foregroundColor: FishingTokens.background,
          ),
        ),
      ),
      home: switch (screen) {
        'preview' => Step6CertificatePreviewPage(
          departureId: '',
          token: _token,
          initialCertificate: {
            'id': _certificateId,
            'snapshot': _snapshot(),
          },
        ),
        'artwork' => Scaffold(
          backgroundColor: FishingTokens.background,
          body: Center(child: CertificateArtwork(snapshot: _snapshot())),
        ),
        _ => Step6CertificateCenterPage(token: _token, onRequireLogin: () {}),
      },
    );
  }
}
