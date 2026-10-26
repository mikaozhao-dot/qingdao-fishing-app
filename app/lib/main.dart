import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'api_client.dart';
import 'fishing_tokens.dart';
import 'promotion_flow.dart';
import 'step1_flow.dart';
import 'step2_flow.dart';
import 'step4_flow.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: FishingTokens.background,
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );
  runApp(const QingdaoFishingApp());
}

class QingdaoFishingApp extends StatelessWidget {
  const QingdaoFishingApp({super.key});

  @override
  Widget build(BuildContext context) {
    final colorScheme =
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
          error: const Color(0xFFD9786C),
          onError: FishingTokens.background,
        );

    return MaterialApp(
      title: '约钓者',
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
  String? _sessionToken;
  final AppLinks _appLinks = AppLinks();
  StreamSubscription<Uri>? _deepLinkSubscription;
  String? _pendingPromotionVisitorToken;
  String? _claimedPromotionVisitorToken;
  bool _claimingPromotion = false;

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

  @override
  void initState() {
    super.initState();
    _deepLinkSubscription = _appLinks.uriLinkStream.listen(
      _receivePromotionLink,
      onError: (_) {},
    );
    _appLinks
        .getInitialLink()
        .then((uri) {
          if (uri != null) _receivePromotionLink(uri);
        })
        .catchError((_) {});
  }

  @override
  void dispose() {
    _deepLinkSubscription?.cancel();
    super.dispose();
  }

  void _receivePromotionLink(Uri uri) {
    final visitorToken = promotionVisitorTokenFromUri(uri);
    if (visitorToken == null) return;
    _pendingPromotionVisitorToken = visitorToken;
    if (_sessionToken == null && _selectedIndex != 3) {
      setState(() => _selectedIndex = 3);
    }
    _claimPendingPromotion();
  }

  void _handleTokenChanged(String? token) {
    setState(() => _sessionToken = token);
    if (token != null) _claimPendingPromotion();
  }

  Future<void> _claimPendingPromotion() async {
    final visitorToken = _pendingPromotionVisitorToken;
    final token = _sessionToken;
    if (visitorToken == null ||
        token == null ||
        _claimingPromotion ||
        visitorToken == _claimedPromotionVisitorToken) {
      return;
    }
    _claimingPromotion = true;
    try {
      await Step1Api.post('/promotions/attribution/claim', {
        'visitorToken': visitorToken,
      }, token: token);
      _claimedPromotionVisitorToken = visitorToken;
      _pendingPromotionVisitorToken = null;
    } catch (_) {
      // Keep the referral until the user is authenticated and the API is reachable.
    } finally {
      _claimingPromotion = false;
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
              '约钓者',
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
          IconButton(
            tooltip: '推广中心',
            icon: const Icon(Icons.campaign_outlined),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (pageContext) => PromotionCenterPage(
                  token: _sessionToken,
                  onRequireLogin: () {
                    Navigator.of(pageContext).pop();
                    setState(() => _selectedIndex = 3);
                  },
                ),
              ),
            ),
          ),
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
        child: tab.label == '订单' && _role == AppRole.angler
            ? Step4AnglerWorkspace(
                token: _sessionToken,
                onOpenProfile: () => setState(() => _selectedIndex = 3),
                onTokenChanged: _handleTokenChanged,
              )
            : tab.label == '行程' && _role == AppRole.captain
            ? Step4CaptainWorkspace(
                token: _sessionToken,
                onOpenProfile: () => setState(() => _selectedIndex = 3),
              )
            : tab.label == '我的'
            ? Step1Workspace(
                roleLabel: _roleLabel,
                tabLabel: tab.label,
                token: _sessionToken,
                onTokenChanged: _handleTokenChanged,
                onOpenProfile: () => setState(() => _selectedIndex = 3),
              )
            : Step2Workspace(
                roleLabel: _roleLabel,
                tabLabel: tab.label,
                token: _sessionToken,
                onTokenChanged: _handleTokenChanged,
                onOpenProfile: () => setState(() => _selectedIndex = 3),
                onSelectTab: (index) => setState(() => _selectedIndex = index),
              ),
      ),
      bottomNavigationBar: SafeArea(
        minimum: const EdgeInsets.fromLTRB(16, 0, 16, 8),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(FishingTokens.radiusPill),
          child: NavigationBar(
            selectedIndex: _selectedIndex,
            onDestinationSelected: (index) =>
                setState(() => _selectedIndex = index),
            destinations: _tabs
                .map(
                  (item) => NavigationDestination(
                    icon: Icon(item.icon),
                    selectedIcon: Icon(item.icon, color: FishingTokens.brand),
                    label: item.label,
                  ),
                )
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
