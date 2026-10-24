import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import 'api_client.dart';
import 'fishing_tokens.dart';
import 'step3_flow.dart';

class Step4CaptainWorkspace extends StatefulWidget {
  const Step4CaptainWorkspace({
    required this.token,
    required this.onOpenProfile,
    super.key,
  });

  final String? token;
  final VoidCallback onOpenProfile;

  @override
  State<Step4CaptainWorkspace> createState() => _Step4CaptainWorkspaceState();
}

class _Step4CaptainWorkspaceState extends State<Step4CaptainWorkspace> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant Step4CaptainWorkspace oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.token != widget.token) _load();
  }

  Future<void> _load() async {
    if (widget.token == null) {
      if (mounted) {
        setState(() {
          _items = [];
          _loading = false;
          _error = null;
        });
      }
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await Step1Api.get(
        '/captain/fulfillment',
        token: widget.token,
      );
      if (!mounted) return;
      setState(() => _items = _maps(result['items']));
    } catch (error) {
      if (!mounted) return;
      final message = error.toString().replaceFirst('Exception: ', '');
      setState(() => _error = message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _checkin(Map<String, dynamic> item, String event) async {
    await _run(
      () => Step1Api.post('/captain/departures/${item['id']}/checkin', {
        'event': event,
      }, token: widget.token),
    );
  }

  Future<void> _run(Future<Map<String, dynamic>> Function() action) async {
    try {
      await action();
      await _load();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error.toString().replaceFirst('Exception: ', '')),
        ),
      );
    }
  }

  Future<void> _showChecklist(Map<String, dynamic> item) async {
    if (widget.token == null) return;
    try {
      final result = await Step1Api.get(
        '/captain/departures/${item['id']}/fulfillment',
        token: widget.token,
      );
      if (!mounted) return;
      final checklist = _map(result['checklist']);
      showModalBottomSheet<void>(
        context: context,
        showDragHandle: true,
        isScrollControlled: true,
        builder: (context) => _ChecklistSheet(checklist: checklist),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error.toString().replaceFirst('Exception: ', '')),
        ),
      );
    }
  }

  Future<void> _shareManifest(Map<String, dynamic> item, String format) async {
    if (widget.token == null) return;
    try {
      final csv = await Step1Api.getText(
        '/captain/departures/${item['id']}/manifest.csv?format=$format',
        token: widget.token,
      );
      if (!mounted) return;
      final filename = '乘船名单-${format == 'full' ? '实名' : '掩码'}.csv';
      final box = context.findRenderObject() as RenderBox?;
      await SharePlus.instance.share(
        ShareParams(
          title: filename,
          files: [
            XFile.fromData(
              utf8.encode(csv),
              mimeType: 'text/csv',
              name: filename,
            ),
          ],
          fileNameOverrides: [filename],
          sharePositionOrigin: box == null
              ? null
              : box.localToGlobal(Offset.zero) & box.size,
        ),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error.toString().replaceFirst('Exception: ', '')),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.token == null) {
      return _GatePage(
        eyebrow: 'CAPTAIN · AT SEA',
        title: '行程管理',
        body: '登录船长账号后，可查看已确认行程、完成出返航打卡、核对清单并导出乘船名单。',
        onLogin: widget.onOpenProfile,
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(18, 12, 18, 32),
        children: [
          const _Eyebrow('CAPTAIN · AT SEA'),
          const SizedBox(height: 8),
          const Text('行程管理', style: _headline),
          const SizedBox(height: 6),
          const Text('已确认行程的清单、打卡与名单管理。', style: _body),
          const SizedBox(height: 18),
          if (_loading) const LinearProgressIndicator(minHeight: 2),
          if (_error != null) _NoticeCard(message: _error!, onRetry: _load),
          if (!_loading && _error == null && _items.isEmpty)
            const _NoticeCard(message: '暂时没有已确认的行程。确认后会显示在这里。'),
          ..._items.map(
            (item) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _CaptainTripCard(
                item: item,
                onCheckin: (event) => _checkin(item, event),
                onManifest: (format) => _shareManifest(item, format),
                onChecklist: () => _showChecklist(item),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class Step4AnglerWorkspace extends StatefulWidget {
  const Step4AnglerWorkspace({
    required this.token,
    required this.onOpenProfile,
    required this.onTokenChanged,
    super.key,
  });

  final String? token;
  final VoidCallback onOpenProfile;
  final ValueChanged<String?> onTokenChanged;

  @override
  State<Step4AnglerWorkspace> createState() => _Step4AnglerWorkspaceState();
}

class _Step4AnglerWorkspaceState extends State<Step4AnglerWorkspace> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant Step4AnglerWorkspace oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.token != widget.token) _load();
  }

  Future<void> _load() async {
    if (widget.token == null) {
      if (mounted) {
        setState(() {
          _items = [];
          _loading = false;
          _error = null;
        });
      }
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await Step1Api.get('/orders', token: widget.token);
      if (!mounted) return;
      setState(() => _items = _maps(result['items']));
    } catch (error) {
      if (!mounted) return;
      final message = error.toString().replaceFirst('Exception: ', '');
      setState(() => _error = message);
      if (message.contains('登录已过期')) widget.onTokenChanged(null);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.token == null) {
      return _GatePage(
        eyebrow: 'YOUR TRIPS',
        title: '我的订单',
        body: '登录后可查看订单、出航时间、集合地点与行前清单。',
        onLogin: widget.onOpenProfile,
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(18, 12, 18, 32),
        children: [
          const _Eyebrow('YOUR TRIPS'),
          const SizedBox(height: 8),
          const Text('我的订单', style: _headline),
          const SizedBox(height: 14),
          if (_loading) const LinearProgressIndicator(minHeight: 2),
          if (_error != null) _NoticeCard(message: _error!, onRetry: _load),
          if (!_loading && _error == null && _items.isEmpty)
            const _NoticeCard(message: '还没有订单，选好座位后会显示在这里。'),
          ..._items.map(
            (item) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _OrderTile(
                item: item,
                onTap: () async {
                  await Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => _AnglerOrderPage(
                        orderId: '${item['id']}',
                        token: widget.token!,
                      ),
                    ),
                  );
                  if (mounted) _load();
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _AnglerOrderPage extends StatefulWidget {
  const _AnglerOrderPage({required this.orderId, required this.token});
  final String orderId;
  final String token;

  @override
  State<_AnglerOrderPage> createState() => _AnglerOrderPageState();
}

class _AnglerOrderPageState extends State<_AnglerOrderPage> {
  Map<String, dynamic> _order = {};
  Map<String, dynamic> _flow = {};
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        Step1Api.get('/orders/${widget.orderId}', token: widget.token),
        Step1Api.get('/orders/${widget.orderId}/fulfillment', token: widget.token),
      ]);
      if (!mounted) return;
      setState(() {
        _order = _map(results[0]['order']);
        _flow = results[1];
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _showChecklist() async {
    final checklist = _map(_flow['checklist']);
    if (checklist.isEmpty || !mounted) return;
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (context) => _ChecklistSheet(checklist: checklist),
    );
  }

  @override
  Widget build(BuildContext context) {
    final departure = _map(_flow['departure']);
    final checklist = _map(_flow['checklist']);
    final status = (departure['status'] ?? '').toString();
    return Scaffold(
      appBar: AppBar(title: const Text('行程详情')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? _NoticeCard(message: _error!, onRetry: _load)
          : ListView(
              padding: const EdgeInsets.fromLTRB(18, 8, 18, 32),
              children: [
                const _Eyebrow('YOUR TRIP'),
                const SizedBox(height: 8),
                Text((_order['boatName'] ?? '出海班次').toString(), style: _headline),
                const SizedBox(height: 5),
                Text('订单 ${_order['orderNumber'] ?? widget.orderId}', style: _muted),
                const SizedBox(height: 16),
                _Card(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const Expanded(child: Text('出海安排', style: _sectionTitle)),
                          _StagePill(label: _departureStatus(status)),
                        ],
                      ),
                      const SizedBox(height: 12),
                      _InfoLine(label: '出航时间', value: _dateTime(departure['departureAt'])),
                      _InfoLine(label: '集合码头', value: (departure['marinaCode'] ?? '待通知').toString()),
                      _InfoLine(label: '集合时间', value: _dateTime(departure['meetingAt'])),
                    ],
                  ),
                ),
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => OrderDetailPage(orderId: widget.orderId, token: widget.token),
                    ),
                  ),
                  icon: const Icon(Icons.receipt_long_outlined),
                  label: const Text('订单金额与保险详情'),
                ),
                if (checklist.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  _ChecklistSummary(checklist: checklist, onTap: _showChecklist),
                ] else if (['confirmed', 'in_progress', 'completed'].contains(status)) ...[
                  const SizedBox(height: 10),
                  const _NoticeCard(message: '行前清单正在生成，请稍后刷新查看。'),
                ],
              ],
            ),
    );
  }
}

class _CaptainTripCard extends StatelessWidget {
  const _CaptainTripCard({
    required this.item,
    required this.onCheckin,
    required this.onManifest,
    required this.onChecklist,
  });

  final Map<String, dynamic> item;
  final ValueChanged<String> onCheckin;
  final ValueChanged<String> onManifest;
  final VoidCallback onChecklist;

  @override
  Widget build(BuildContext context) {
    final status = (item['status'] ?? '').toString();
    return _Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(_dateTime(item['departureAt']), style: _sectionTitle),
                    const SizedBox(height: 3),
                    Text(
                      (item['marinaCode'] ?? '码头待定').toString() +
                          (item['tripType'] == 'pro_fishing' ? ' · 专业海钓' : ' · 海上体验'),
                      style: _muted,
                    ),
                  ],
                ),
              ),
              _StagePill(label: _departureStatus(status)),
            ],
          ),
          if (status == 'confirmed') ...[
            const SizedBox(height: 14),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilledButton.icon(
                  onPressed: () => onCheckin('departed'),
                  icon: const Icon(Icons.sailing_outlined),
                  label: const Text('出航打卡'),
                ),
                OutlinedButton.icon(
                  onPressed: onChecklist,
                  icon: const Icon(Icons.checklist_outlined),
                  label: const Text('行前清单'),
                ),
              ],
            ),
            const SizedBox(height: 8),
            _manifestActions(),
          ],
          if (status == 'in_progress') ...[
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: () => onCheckin('returned'),
              icon: const Icon(Icons.anchor_outlined),
              label: const Text('返航打卡'),
            ),
          ],
          if (status == 'completed') ...[
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: onChecklist,
              icon: const Icon(Icons.checklist_outlined),
              label: const Text('查看行前清单'),
            ),
            _manifestActions(),
          ],
        ],
      ),
    );
  }

  Widget _manifestActions() => Wrap(
    spacing: 8,
    children: [
      TextButton.icon(
        onPressed: () => onManifest('masked'),
        icon: const Icon(Icons.visibility_outlined),
        label: const Text('掩码名单'),
      ),
      TextButton.icon(
        onPressed: () => onManifest('full'),
        icon: const Icon(Icons.lock_outline),
        label: const Text('实名名单'),
      ),
    ],
  );
}

class _OrderTile extends StatelessWidget {
  const _OrderTile({required this.item, required this.onTap});
  final Map<String, dynamic> item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(FishingTokens.radius22),
    child: _Card(
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: FishingTokens.surfaceTint,
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Icon(
              Icons.sailing_outlined,
              color: FishingTokens.brand,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${item['boatName'] ?? '海钓班次'}', style: _sectionTitle),
                const SizedBox(height: 3),
                Text(
                  '${_dateTime(item['departureAt'])} · ${item['seatCount'] ?? 0} 位',
                  style: _muted,
                ),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text('¥${_yuan(_int(item['totalFen']))}', style: _moneyStyle),
              const SizedBox(height: 3),
              Text(_orderStatus('${item['status']}'), style: _smallNote),
            ],
          ),
          const SizedBox(width: 4),
          const Icon(Icons.chevron_right, size: 19, color: FishingTokens.muted),
        ],
      ),
    ),
  );
}

class _ChecklistSheet extends StatelessWidget {
  const _ChecklistSheet({required this.checklist});
  final Map<String, dynamic> checklist;

  @override
  Widget build(BuildContext context) {
    final items = _maps(checklist['items']);
    final insurance = _map(checklist['insurance']);
    final manifest = _map(checklist['manifest']);
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 28),
        child: ListView(
          shrinkWrap: true,
          children: [
            const _Eyebrow('BEFORE DEPARTURE'),
            const SizedBox(height: 8),
            const Text('行前清单', style: _headline),
            const SizedBox(height: 14),
            _InfoLine(label: '集合时间', value: _dateTime(checklist['meetingAt'])),
            _InfoLine(
              label: '集合码头',
              value: '${checklist['marinaCode'] ?? '待通知'}',
            ),
            _InfoLine(
              label: '海况提示',
              value: '${checklist['weather'] ?? '出航前更新海况'}',
            ),
            _InfoLine(
              label: '保险状态',
              value:
                  '${insurance['insuredOrderCount'] ?? 0} / ${insurance['orderCount'] ?? 0} 单已出单',
            ),
            _InfoLine(
              label: '名单校验',
              value:
                  '${manifest['passengerCount'] ?? 0} 人 / ${manifest['seatCount'] ?? 0} 个座位 · ${manifest['status'] == 'matched' ? '已匹配' : '需复核'}',
            ),
            const Divider(height: 22),
            ...items.map(
              (item) => ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(
                  item['done'] == true
                      ? Icons.check_circle
                      : Icons.radio_button_unchecked,
                  color: item['done'] == true
                      ? FishingTokens.brand
                      : FishingTokens.muted,
                ),
                title: Text('${item['title'] ?? ''}', style: _body),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ChecklistSummary extends StatelessWidget {
  const _ChecklistSummary({required this.checklist, required this.onTap});
  final Map<String, dynamic> checklist;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(FishingTokens.radius22),
    child: const _Card(
      child: Row(
        children: [
          Icon(Icons.checklist_rtl_outlined, color: FishingTokens.brand),
          SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('行前清单已生成', style: _sectionTitle),
                SizedBox(height: 4),
                Text('集合时间、地点、天气、保险与名单校验', style: _muted),
              ],
            ),
          ),
          Icon(Icons.chevron_right, color: FishingTokens.muted),
        ],
      ),
    ),
  );
}

class _GatePage extends StatelessWidget {
  const _GatePage({
    required this.eyebrow,
    required this.title,
    required this.body,
    required this.onLogin,
  });
  final String eyebrow;
  final String title;
  final String body;
  final VoidCallback onLogin;
  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.fromLTRB(18, 24, 18, 30),
    children: [
      const SizedBox(height: 40),
      const Icon(Icons.sailing_outlined, size: 44, color: FishingTokens.brand),
      const SizedBox(height: 18),
      _Eyebrow(eyebrow),
      const SizedBox(height: 8),
      Text(title, textAlign: TextAlign.center, style: _headline),
      const SizedBox(height: 8),
      Text(body, textAlign: TextAlign.center, style: _body),
      const SizedBox(height: 18),
      Center(
        child: FilledButton(onPressed: onLogin, child: const Text('前往登录')),
      ),
    ],
  );
}

class _NoticeCard extends StatelessWidget {
  const _NoticeCard({required this.message, this.onRetry});
  final String message;
  final VoidCallback? onRetry;
  @override
  Widget build(BuildContext context) => _Card(
    child: Row(
      children: [
        const Icon(Icons.info_outline, color: FishingTokens.brand),
        const SizedBox(width: 10),
        Expanded(child: Text(message, style: _body)),
        if (onRetry != null)
          IconButton(onPressed: onRetry, icon: const Icon(Icons.refresh)),
      ],
    ),
  );
}

class _Card extends StatelessWidget {
  const _Card({required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: FishingTokens.surface,
      border: Border.all(color: FishingTokens.line),
      borderRadius: BorderRadius.circular(FishingTokens.radius22),
    ),
    child: child,
  );
}

class _StagePill extends StatelessWidget {
  const _StagePill({required this.label});
  final String label;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(
      color: FishingTokens.surfaceTint,
      borderRadius: BorderRadius.circular(FishingTokens.radiusPill),
    ),
    child: Text(
      label,
      style: const TextStyle(
        color: FishingTokens.brand,
        fontSize: 11,
        fontWeight: FontWeight.w600,
      ),
    ),
  );
}

class _Eyebrow extends StatelessWidget {
  const _Eyebrow(this.label);
  final String label;
  @override
  Widget build(BuildContext context) => Text(
    label,
    style: const TextStyle(
      color: FishingTokens.brand,
      fontSize: 10,
      fontWeight: FontWeight.w700,
      letterSpacing: 1.5,
    ),
  );
}

class _InfoLine extends StatelessWidget {
  const _InfoLine({required this.label, required this.value});
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 5),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(width: 106, child: Text(label, style: _muted)),
        Expanded(child: Text(value, style: _body)),
      ],
    ),
  );
}

const _headline = TextStyle(
  fontSize: 26,
  height: 1.2,
  fontWeight: FontWeight.w800,
  color: FishingTokens.ink,
);
const _sectionTitle = TextStyle(
  fontSize: 15,
  height: 1.35,
  fontWeight: FontWeight.w700,
  color: FishingTokens.ink,
);
const _body = TextStyle(
  fontSize: 13,
  height: 1.55,
  color: FishingTokens.secondary,
);
const _muted = TextStyle(
  fontSize: 11,
  height: 1.45,
  color: FishingTokens.muted,
);
const _smallNote = TextStyle(
  fontSize: 10,
  height: 1.45,
  color: FishingTokens.muted,
);
const _moneyStyle = TextStyle(
  fontSize: 14,
  fontWeight: FontWeight.w700,
  color: FishingTokens.brand,
);

List<Map<String, dynamic>> _maps(dynamic value) => value is List
    ? value
          .whereType<Map>()
          .map((item) => item.cast<String, dynamic>())
          .toList()
    : <Map<String, dynamic>>[];
Map<String, dynamic> _map(dynamic value) =>
    value is Map ? value.cast<String, dynamic>() : <String, dynamic>{};
int _int(dynamic value, {int fallback = 0}) =>
    value is num ? value.round() : int.tryParse('$value') ?? fallback;
String _yuan(int fen) => (fen / 100).toStringAsFixed(2);
String _dateTime(dynamic value) {
  final date = DateTime.tryParse('$value')?.toLocal();
  if (date == null) return '待通知';
  final month = date.month.toString().padLeft(2, '0');
  final day = date.day.toString().padLeft(2, '0');
  final hour = date.hour.toString().padLeft(2, '0');
  final minute = date.minute.toString().padLeft(2, '0');
  return '$month月$day日 $hour:$minute';
}

String _departureStatus(String status) => switch (status) {
  'open' || 'forming' => '待确认',
  'handling_shortfall' => '待处置 · 未达成行门槛',
  'confirmed' => '平台已成行',
  'captain_confirmed' => '船长已确认成行',
  'weather_cancelled' => '天气取消',
  'in_progress' => '出海中',
  'completed' => '已返航',
  'cancelled' => '已取消',
  _ => '待发布',
};
String _orderStatus(String status) => switch (status) {
  'paid' => '已支付',
  'cancelled' => '已取消',
  'refunded' => '已退款',
  'completed' => '已完成',
  _ => '待支付',
};
