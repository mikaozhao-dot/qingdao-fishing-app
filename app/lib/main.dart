import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.light,
    systemNavigationBarColor: FishingTokens.background,
    systemNavigationBarIconBrightness: Brightness.light,
  ));
  runApp(const QingdaoFishingApp());
}

abstract final class FishingTokens {
  // UI v2 冻结稿 A「深海霓虹」；与 docs/ui-v2-design-system.md 同源。
  static const background = Color(0xFF081410);
  static const deepSurface = Color(0xFF0B1913);
  static const surface = Color(0xFF13241B);
  static const surfaceTint = Color(0xFF192B21);
  static const line = Color(0xFF20352A);
  static const ink = Color(0xFFF0F5EE);
  static const secondary = Color(0xFF9AAC9E);
  static const muted = Color(0xFF728679);
  static const brand = Color(0xFFCDF463);
  static const success = Color(0xFFB6E77B);

  static const space4 = 4.0;
  static const space8 = 8.0;
  static const space12 = 12.0;
  static const space16 = 16.0;
  static const space24 = 24.0;
  static const space32 = 32.0;
  static const radius8 = 8.0;
  static const radius12 = 12.0;
  static const radius22 = 22.0;
  static const radiusPill = 999.0;
}

class QingdaoFishingApp extends StatelessWidget {
  const QingdaoFishingApp({super.key});

  @override
  Widget build(BuildContext context) {
    final colorScheme = ColorScheme.fromSeed(
      seedColor: FishingTokens.brand,
      brightness: Brightness.dark,
      surface: FishingTokens.surface,
    ).copyWith(
      primary: FishingTokens.brand,
      onPrimary: FishingTokens.background,
      secondary: FishingTokens.success,
      onSecondary: FishingTokens.background,
      onSurface: FishingTokens.ink,
      error: const Color(0xFFD9786C),
      onError: FishingTokens.background,
    );

    return MaterialApp(
      title: '拼船海钓',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: colorScheme,
        scaffoldBackgroundColor: FishingTokens.background,
        appBarTheme: const AppBarTheme(
          backgroundColor: FishingTokens.background,
          foregroundColor: FishingTokens.ink,
          centerTitle: false,
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
        dividerTheme: const DividerThemeData(
          color: FishingTokens.line,
          thickness: 1,
          space: 1,
        ),
        navigationBarTheme: NavigationBarThemeData(
          backgroundColor: FishingTokens.deepSurface,
          indicatorColor: FishingTokens.surfaceTint,
          labelTextStyle: WidgetStateProperty.resolveWith((states) {
            return TextStyle(
              fontSize: 11,
              fontWeight: states.contains(WidgetState.selected)
                  ? FontWeight.w600
                  : FontWeight.w400,
              color: states.contains(WidgetState.selected)
                  ? FishingTokens.brand
                  : FishingTokens.secondary,
            );
          }),
        ),
      ),
      home: const AppShell(),
    );
  }
}

enum AppRole { angler, captain }

class AppShell extends StatefulWidget {
  const AppShell({super.key});

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  AppRole _role = AppRole.angler;
  int _selectedIndex = 0;
  String _healthMessage = '尚未连接';
  bool _checkingHealth = false;

  static const _anglerTabs = <_AppTab>[
    _AppTab('首页', Icons.home_outlined),
    _AppTab('活动', Icons.explore_outlined),
    _AppTab('订单', Icons.receipt_long_outlined),
    _AppTab('我的', Icons.person_outline),
  ];

  static const _captainTabs = <_AppTab>[
    _AppTab('工作台', Icons.dashboard_outlined),
    _AppTab('发班', Icons.add_circle_outline),
    _AppTab('行程', Icons.sailing_outlined),
    _AppTab('我的', Icons.person_outline),
  ];

  List<_AppTab> get _tabs =>
      _role == AppRole.angler ? _anglerTabs : _captainTabs;

  String get _roleLabel => _role == AppRole.angler ? '钓友端' : '船长端';

  String get _endpoint {
    const configured = String.fromEnvironment('API_BASE_URL');
    if (configured.isNotEmpty) return configured;
    return Platform.isAndroid
        ? 'http://10.0.2.2:3000'
        : 'http://127.0.0.1:3000';
  }

  Future<void> _checkBackend() async {
    setState(() {
      _checkingHealth = true;
      _healthMessage = '正在连接后端…';
    });
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 4);
    try {
      final request = await client.getUrl(Uri.parse('$_endpoint/health'));
      final response = await request.close().timeout(const Duration(seconds: 6));
      final body = await response.transform(utf8.decoder).join();
      if (response.statusCode != HttpStatus.ok) {
        throw HttpException('HTTP ${response.statusCode}');
      }
      final payload = jsonDecode(body) as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        _healthMessage = '已连接 · v${payload['version']}';
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _healthMessage =
            '暂不可用 · ${error is SocketException ? '请确认服务已启动' : error.runtimeType}';
      });
    } finally {
      client.close(force: true);
      if (mounted) setState(() => _checkingHealth = false);
    }
  }

  void _switchRole(AppRole role) {
    setState(() {
      _role = role;
      _selectedIndex = 0;
    });
  }

  @override
  Widget build(BuildContext context) {
    final tab = _tabs[_selectedIndex];
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '青岛海钓',
              style: TextStyle(fontSize: 23, fontWeight: FontWeight.w900),
            ),
            Text(
              '拼船与海上体验',
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: FishingTokens.secondary,
                    letterSpacing: 0.5,
                  ),
            ),
          ],
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: FishingTokens.space12),
            child: PopupMenuButton<AppRole>(
              tooltip: '切换身份',
              onSelected: _switchRole,
              itemBuilder: (context) => const [
                PopupMenuItem(value: AppRole.angler, child: Text('钓友端')),
                PopupMenuItem(value: AppRole.captain, child: Text('船长端')),
              ],
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: FishingTokens.space12,
                  vertical: FishingTokens.space8,
                ),
                decoration: BoxDecoration(
                  color: FishingTokens.surface,
                  borderRadius: BorderRadius.circular(FishingTokens.radiusPill),
                  border: Border.all(color: FishingTokens.line),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(_roleLabel, style: const TextStyle(fontSize: 12)),
                    const SizedBox(width: FishingTokens.space4),
                    const Icon(Icons.expand_more, size: 16),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
      body: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.all(FishingTokens.space16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                tab.label,
                style: const TextStyle(
                  fontSize: 23,
                  height: 1.25,
                  fontWeight: FontWeight.w900,
                  color: FishingTokens.ink,
                ),
              ),
              const SizedBox(height: FishingTokens.space8),
              Text(
                _role == AppRole.angler
                    ? '钓友客户端基础框架已就位'
                    : '船长工作台基础框架已就位',
                style: const TextStyle(
                  fontSize: 13,
                  color: FishingTokens.secondary,
                ),
              ),
              const SizedBox(height: FishingTokens.space24),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(FishingTokens.space16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const Icon(Icons.hub_outlined,
                              color: FishingTokens.brand, size: 19),
                          const SizedBox(width: FishingTokens.space8),
                          const Expanded(
                            child: Text(
                              '后端连接',
                              style: TextStyle(fontWeight: FontWeight.w600),
                            ),
                          ),
                          TextButton(
                            onPressed: _checkingHealth ? null : _checkBackend,
                            child: Text(_checkingHealth ? '检查中' : '检查'),
                          ),
                        ],
                      ),
                      const SizedBox(height: FishingTokens.space4),
                      Text(
                        _healthMessage,
                        style: const TextStyle(
                          fontSize: 12,
                          color: FishingTokens.secondary,
                        ),
                      ),
                      const SizedBox(height: FishingTokens.space8),
                      Text(
                        _endpoint,
                        style: const TextStyle(
                          fontSize: 10,
                          color: FishingTokens.muted,
                          fontFamily: 'monospace',
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const Spacer(),
              const Center(
                child: Text(
                  '第 0 步工程骨架 · A 深海霓虹视觉基准',
                  style: TextStyle(
                    fontSize: 10,
                    color: FishingTokens.muted,
                  ),
                ),
              ),
              const SizedBox(height: FishingTokens.space8),
            ],
          ),
        ),
      ),
      bottomNavigationBar: SafeArea(
        minimum: const EdgeInsets.fromLTRB(16, 0, 16, 8),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(FishingTokens.radiusPill),
          child: NavigationBar(
            selectedIndex: _selectedIndex,
            onDestinationSelected: (index) => setState(() => _selectedIndex = index),
            destinations: _tabs
                .map((item) => NavigationDestination(
                      icon: Icon(item.icon),
                      selectedIcon: Icon(item.icon, color: FishingTokens.brand),
                      label: item.label,
                    ))
                .toList(growable: false),
          ),
        ),
      ),
    );
  }
}

class _AppTab {
  const _AppTab(this.label, this.icon);

  final String label;
  final IconData icon;
}
