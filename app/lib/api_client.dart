import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

class Step1Api {
  static const _configured = String.fromEnvironment('API_BASE_URL');
  static final http.Client _defaultClient = http.Client();

  @visibleForTesting
  static http.Client? clientOverride;

  static http.Client get _client => clientOverride ?? _defaultClient;

  static String get baseUrl {
    if (_configured.isNotEmpty) return _configured;
    if (kIsWeb) return 'http://localhost:3000';
    return defaultTargetPlatform == TargetPlatform.android
        ? 'http://10.0.2.2:3000'
        : 'http://127.0.0.1:3000';
  }

  static Future<Map<String, dynamic>> get(String path, {String? token}) async {
    final response = await _client
        .get(
          Uri.parse('$baseUrl$path'),
          headers: token == null
              ? const {}
              : {'authorization': 'Bearer $token'},
        )
        .timeout(const Duration(seconds: 12));
    return _decode(response);
  }

  static Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic> body, {
    String? token,
  }) async {
    final response = await _client
        .post(
          Uri.parse('$baseUrl$path'),
          headers: {
            'content-type': 'application/json',
            if (token != null) 'authorization': 'Bearer $token',
          },
          body: jsonEncode(body),
        )
        .timeout(const Duration(seconds: 20));
    return _decode(response);
  }

  static Future<Map<String, dynamic>> put(
    String path,
    Map<String, dynamic> body, {
    String? token,
  }) async {
    final response = await _client
        .put(
          Uri.parse('$baseUrl$path'),
          headers: {
            'content-type': 'application/json',
            if (token != null) 'authorization': 'Bearer $token',
          },
          body: jsonEncode(body),
        )
        .timeout(const Duration(seconds: 20));
    return _decode(response);
  }

  static Future<Map<String, dynamic>> delete(
    String path, {
    String? token,
  }) async {
    final response = await _client
        .delete(
          Uri.parse('$baseUrl$path'),
          headers: token == null
              ? const {}
              : {'authorization': 'Bearer $token'},
        )
        .timeout(const Duration(seconds: 12));
    return _decode(response);
  }

  static Future<String> getText(String path, {String? token}) async {
    final response = await _client
        .get(
          Uri.parse('$baseUrl$path'),
          headers: token == null
              ? const {}
              : {'authorization': 'Bearer $token'},
        )
        .timeout(const Duration(seconds: 12));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      throw Exception(body['error'] ?? '请求失败（${response.statusCode}）');
    }
    return response.body;
  }

  static Map<String, dynamic> _decode(http.Response response) {
    final data = response.body.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(data['error'] ?? '请求失败（${response.statusCode}）');
    }
    return data;
  }
}
