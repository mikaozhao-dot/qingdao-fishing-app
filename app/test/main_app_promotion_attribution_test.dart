import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:qingdao_fishing_app/api_client.dart';
import 'package:qingdao_fishing_app/main.dart' as app;

final _visitorToken =
    '${List.filled(32, 'a').join()}.${List.filled(43, 'b').join()}';
const _sessionToken = 'promotion-app-session';
final _coldStartLink = Uri.parse('yuediaozhe://promotion?ref=$_visitorToken');
final _newHotLink = Uri.parse(
  'yuediaozhe://promotion?ref=${List.filled(32, 'c').join()}.${List.filled(43, 'd').join()}',
);

http.Response _json(Map<String, dynamic> body, [int status = 200]) =>
    http.Response(
      jsonEncode(body),
      status,
      headers: {'content-type': 'application/json'},
    );

Future<void> _logIn(WidgetTester tester) async {
  await tester.enterText(
    find.byWidgetPredicate(
      (widget) => widget is TextField && widget.decoration?.labelText == '手机号',
    ),
    '16600000123',
  );
  await tester.tap(find.text('获取验证码'));
  await tester.pumpAndSettle();
  await tester.enterText(
    find.byWidgetPredicate(
      (widget) =>
          widget is TextField && widget.decoration?.labelText == '短信验证码',
    ),
    '246810',
  );
  await tester.tap(find.text('登录并创建账号'));
  await tester.pumpAndSettle();
}

void main() {
  tearDown(() => Step1Api.clientOverride = null);

  test('app links owns both native deep-link handlers', () {
    final android = File(
      'android/app/src/main/AndroidManifest.xml',
    ).readAsStringSync();
    final ios = File('ios/Runner/Info.plist').readAsStringSync();
    expect(android, contains('android:name="flutter_deeplinking_enabled"'));
    expect(android, contains('android:value="false"'));
    expect(ios, contains('<key>FlutterDeepLinkingEnabled</key>\n\t<false/>'));
  });

  testWidgets(
    'cold-start referral survives login and retries the same token after self-referral',
    (tester) async {
      final linkController = StreamController<Uri>.broadcast();
      final claims = <String>[];
      var claimCount = 0;
      Step1Api.clientOverride = MockClient((request) async {
        if (request.url.path == '/auth/code') {
          return _json({'sandboxCode': '246810'});
        }
        if (request.url.path == '/auth/register') {
          return _json({
            'token': _sessionToken,
            'user': {
              'id': 'user-1',
              'displayName': '测试用户',
              'identityStatus': 'not_submitted',
            },
          });
        }
        if (request.url.path == '/account/me') {
          return _json({
            'user': {
              'id': 'user-1',
              'displayName': '测试用户',
              'identityStatus': 'not_submitted',
            },
          });
        }
        if (request.url.path == '/promotions/attribution/claim') {
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          claims.add(body['visitorToken'] as String);
          claimCount += 1;
          return claimCount == 1
              ? _json({'claimed': false, 'reason': 'self_referral'})
              : _json({'claimed': true, 'reason': 'claimed'});
        }
        fail('Unexpected API request: ${request.method} ${request.url.path}');
      });

      await tester.pumpWidget(
        MaterialApp(
          home: app.AppShell(
            initialPromotionLink: () async => _coldStartLink,
            promotionLinkStream: linkController.stream,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('手机号登录 / 注册'), findsOneWidget);

      await _logIn(tester);
      expect(claims, [_visitorToken]);

      // A later scan of another code reuses the browser visitor token.
      linkController.add(_coldStartLink);
      await tester.pumpAndSettle();
      expect(claims, [_visitorToken, _visitorToken]);

      linkController.add(_coldStartLink);
      await tester.pumpAndSettle();
      expect(claims, [_visitorToken, _visitorToken]);

      await tester.pumpWidget(const SizedBox.shrink());
      await linkController.close();
    },
  );

  testWidgets(
    'a newer hot link received during an in-flight invalid claim is processed next',
    (tester) async {
      final linkController = StreamController<Uri>.broadcast();
      final firstClaim = Completer<http.Response>();
      final claims = <String>[];
      var claimCount = 0;
      Step1Api.clientOverride = MockClient((request) async {
        if (request.url.path == '/auth/code') {
          return _json({'sandboxCode': '246810'});
        }
        if (request.url.path == '/auth/register') {
          return _json({
            'token': _sessionToken,
            'user': {
              'id': 'user-1',
              'displayName': '测试用户',
              'identityStatus': 'not_submitted',
            },
          });
        }
        if (request.url.path == '/account/me') {
          return _json({
            'user': {
              'id': 'user-1',
              'displayName': '测试用户',
              'identityStatus': 'not_submitted',
            },
          });
        }
        if (request.url.path == '/promotions/attribution/claim') {
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          claims.add(body['visitorToken'] as String);
          claimCount += 1;
          if (claimCount == 1) return firstClaim.future;
          return _json({'claimed': true, 'reason': 'claimed'});
        }
        fail('Unexpected API request: ${request.method} ${request.url.path}');
      });

      await tester.pumpWidget(
        MaterialApp(
          home: app.AppShell(
            initialPromotionLink: () async => _coldStartLink,
            promotionLinkStream: linkController.stream,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await _logIn(tester);
      await tester.pump();
      expect(claims, [_visitorToken]);

      linkController.add(_newHotLink);
      await tester.pump();
      firstClaim.complete(
        _json({'claimed': false, 'reason': 'no_active_referral'}),
      );
      await tester.pumpAndSettle();

      expect(claims, [
        _visitorToken,
        '${List.filled(32, 'c').join()}.${List.filled(43, 'd').join()}',
      ]);

      await tester.pumpWidget(const SizedBox.shrink());
      await linkController.close();
    },
  );

  testWidgets(
    'duplicate link delivery and AppShell recreation do not duplicate attribution',
    (tester) async {
      final firstLinkController = StreamController<Uri>.broadcast();
      final claims = <String>[];
      final attributedTokens = <String>{};
      Step1Api.clientOverride = MockClient((request) async {
        if (request.url.path == '/auth/code') {
          return _json({'sandboxCode': '246810'});
        }
        if (request.url.path == '/auth/register') {
          return _json({
            'token': _sessionToken,
            'user': {
              'id': 'user-1',
              'displayName': '测试用户',
              'identityStatus': 'not_submitted',
            },
          });
        }
        if (request.url.path == '/account/me') {
          return _json({
            'user': {
              'id': 'user-1',
              'displayName': '测试用户',
              'identityStatus': 'not_submitted',
            },
          });
        }
        if (request.url.path == '/promotions/attribution/claim') {
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          final visitorToken = body['visitorToken'] as String;
          claims.add(visitorToken);
          return attributedTokens.add(visitorToken)
              ? _json({'claimed': true, 'reason': 'claimed'})
              : _json({'claimed': false, 'reason': 'already_attributed'});
        }
        fail('Unexpected API request: ${request.method} ${request.url}');
      });

      await tester.pumpWidget(
        MaterialApp(
          home: app.AppShell(
            initialPromotionLink: () async => _coldStartLink,
            promotionLinkStream: firstLinkController.stream,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await _logIn(tester);
      expect(claims, [_visitorToken]);
      expect(attributedTokens, {_visitorToken});

      // app_links may emit the initial URI again after native lifecycle changes.
      firstLinkController.add(_coldStartLink);
      firstLinkController.add(_coldStartLink);
      await tester.pumpAndSettle();
      expect(claims, [_visitorToken]);
      expect(attributedTokens, {_visitorToken});

      // Recreate the app shell as a widget-level Activity recreation simulation.
      await tester.pumpWidget(const SizedBox.shrink());
      await firstLinkController.close();
      final recreatedLinkController = StreamController<Uri>.broadcast();
      await tester.pumpWidget(
        MaterialApp(
          home: app.AppShell(
            initialPromotionLink: () async => _coldStartLink,
            promotionLinkStream: recreatedLinkController.stream,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await _logIn(tester);

      expect(claims, [_visitorToken, _visitorToken]);
      expect(attributedTokens, {_visitorToken});
      await tester.pumpWidget(const SizedBox.shrink());
      await recreatedLinkController.close();
    },
  );
}
