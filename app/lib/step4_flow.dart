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

  Future<void> _showInsuranceGate(Map<String, dynamic> item) async {
    if (widget.token == null) return;
    try {
      final result = await Step1Api.get(
        '/captain/departures/${item['id']}/insurance-gate',
        token: widget.token,
      );
      if (!mounted) return;
      showModalBottomSheet<void>(
        context: context,
        showDragHandle: true,
        isScrollControlled: true,
        builder: (context) => _InsuranceGateSheet(gate: result),
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
                onInsuranceGate: () => _showInsuranceGate(item),
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
  Map<String, dynamic> _supplementRound = {};
  bool _loading = true;
  bool _supplementWorking = false;
  String? _error;
  String? _supplementError;

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
        Step1Api.get(
          '/orders/${widget.orderId}/fulfillment',
          token: widget.token,
        ),
        Step1Api.get(
          '/orders/${widget.orderId}/supplement-round',
          token: widget.token,
        ),
      ]);
      if (!mounted) return;
      setState(() {
        _order = _map(results[0]['order']);
        _flow = results[1];
        _supplementRound = _map(results[2]['round']);
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

  Future<void> _decideSupplement(String action) async {
    if (_supplementWorking) return;
    if (action == 'reject') {
      final roundAlreadyFailed = [
        'failed',
        'expired',
      ].contains(_supplementRound['status']);
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(roundAlreadyFailed ? '退出并申请全额退款？' : '拒绝本轮补差？'),
          content: Text(
            roundAlreadyFailed
                ? '本轮已失效。退出将取消本订单并申请全额退款，不收取退改违约金；已支付的补差款另按退款义务处理。'
                : '拒绝会使整轮补差失效，相关订单按规则全额退款，且不会自动发起第二轮。',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('再想想'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(roundAlreadyFailed ? '确认退出' : '确认拒绝'),
            ),
          ],
        ),
      );
      if (confirmed != true || !mounted) return;
    }
    setState(() {
      _supplementWorking = true;
      _supplementError = null;
    });
    try {
      await Step1Api.post(
        '/orders/${widget.orderId}/supplement-rounds/${_supplementRound['id']}/decision',
        {'action': action},
        token: widget.token,
      );
      await _load();
    } catch (error) {
      if (!mounted) return;
      setState(
        () =>
            _supplementError = error.toString().replaceFirst('Exception: ', ''),
      );
    } finally {
      if (mounted) setState(() => _supplementWorking = false);
    }
  }

  Future<void> _openSupplementPayment() async {
    if (_supplementWorking) return;
    setState(() {
      _supplementWorking = true;
      _supplementError = null;
    });
    try {
      final intent = await Step1Api.post(
        '/orders/${widget.orderId}/supplement-rounds/${_supplementRound['id']}/payment-intents',
        const {},
        token: widget.token,
      );
      if (!mounted) return;
      final payment = _map(intent['payment']);
      setState(() => _supplementWorking = false);
      final outcome = await showModalBottomSheet<String>(
        context: context,
        showDragHandle: true,
        builder: (context) => Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('补差沙盒支付', style: _sectionTitle),
              const SizedBox(height: 8),
              Text('本次补差 ¥${_yuan(_int(payment['amountFen']))}', style: _body),
              const SizedBox(height: 6),
              const Text('仅用于开发演示，不会扣款。选择模拟结果以验证整轮流程。', style: _muted),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: () => Navigator.pop(context, 'success'),
                  icon: const Icon(Icons.check_circle_outline),
                  label: const Text('模拟支付成功'),
                ),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: [
                  OutlinedButton(
                    onPressed: () => Navigator.pop(context, 'failure'),
                    child: const Text('模拟支付失败'),
                  ),
                  OutlinedButton(
                    onPressed: () => Navigator.pop(context, 'timeout'),
                    child: const Text('模拟支付超时'),
                  ),
                ],
              ),
            ],
          ),
        ),
      );
      if (outcome != null && mounted) {
        setState(() => _supplementWorking = true);
        await Step1Api.post(
          '/orders/${widget.orderId}/supplement-rounds/${_supplementRound['id']}/sandbox-payment',
          {'outcome': outcome},
          token: widget.token,
        );
      }
      if (mounted) await _load();
    } catch (error) {
      if (!mounted) return;
      setState(
        () =>
            _supplementError = error.toString().replaceFirst('Exception: ', ''),
      );
    } finally {
      if (mounted) setState(() => _supplementWorking = false);
    }
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
                Text(
                  (_order['boatName'] ?? '出海班次').toString(),
                  style: _headline,
                ),
                const SizedBox(height: 5),
                Text(
                  '订单 ${_order['orderNumber'] ?? widget.orderId}',
                  style: _muted,
                ),
                const SizedBox(height: 16),
                _Card(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const Expanded(
                            child: Text('出海安排', style: _sectionTitle),
                          ),
                          _StagePill(label: _departureStatus(status)),
                        ],
                      ),
                      const SizedBox(height: 12),
                      _InfoLine(
                        label: '出航时间',
                        value: _dateTime(departure['departureAt']),
                      ),
                      _InfoLine(
                        label: '集合码头',
                        value: (departure['marinaCode'] ?? '待通知').toString(),
                      ),
                      _InfoLine(
                        label: '集合时间',
                        value: _dateTime(departure['meetingAt']),
                      ),
                    ],
                  ),
                ),
                if (_supplementRound.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  _SupplementRoundCard(
                    round: _supplementRound,
                    working: _supplementWorking,
                    error: _supplementError,
                    onDecision: _decideSupplement,
                    onPay: _openSupplementPayment,
                  ),
                ],
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  onPressed: () async {
                    await Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => OrderDetailPage(
                          orderId: widget.orderId,
                          token: widget.token,
                        ),
                      ),
                    );
                    if (mounted) _load();
                  },
                  icon: const Icon(Icons.receipt_long_outlined),
                  label: const Text('订单金额与保险详情'),
                ),
                if (checklist.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  _ChecklistSummary(
                    checklist: checklist,
                    onTap: _showChecklist,
                  ),
                ] else if ([
                  'confirmed',
                  'in_progress',
                  'completed',
                ].contains(status)) ...[
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
    required this.onInsuranceGate,
  });

  final Map<String, dynamic> item;
  final ValueChanged<String> onCheckin;
  final ValueChanged<String> onManifest;
  final VoidCallback onChecklist;
  final VoidCallback onInsuranceGate;

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
                          (item['tripType'] == 'pro_fishing'
                              ? ' · 专业海钓'
                              : ' · 海上体验'),
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
                OutlinedButton.icon(
                  onPressed: onInsuranceGate,
                  icon: const Icon(Icons.verified_user_outlined),
                  label: const Text('登船门禁'),
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
          if (status == 'captain_confirmed') ...[
            const SizedBox(height: 14),
            OutlinedButton.icon(
              onPressed: onInsuranceGate,
              icon: const Icon(Icons.verified_user_outlined),
              label: const Text('核对登船门禁'),
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

class _InsuranceGateSheet extends StatelessWidget {
  const _InsuranceGateSheet({required this.gate});
  final Map<String, dynamic> gate;

  @override
  Widget build(BuildContext context) {
    final required = _map(gate['requiredCoverage']);
    final passengers = _maps(gate['passengers']);
    final tripReady = gate['canDepartureProceed'] == true;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 28),
        child: ListView(
          shrinkWrap: true,
          children: [
            const _Eyebrow('BOARDING · INSURANCE CHECK'),
            const SizedBox(height: 8),
            const Text('登船门禁', style: _headline),
            const SizedBox(height: 14),
            _Card(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('航次必需保障', style: _sectionTitle),
                  const SizedBox(height: 7),
                  Text(
                    _insuranceGateStatus('${required['status']}'),
                    style: TextStyle(
                      color: tripReady
                          ? FishingTokens.brand
                          : Colors.orangeAccent,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if (required['failureReason'] != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      _insuranceFailureReason('${required['failureReason']}'),
                      style: _muted,
                    ),
                  ],
                  const SizedBox(height: 8),
                  Text(
                    tripReady ? '航次必需保障已核验。' : '航次必需保障未核实，全船暂不能登船。',
                    style: _body,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            const Text('乘客保障', style: _sectionTitle),
            const SizedBox(height: 8),
            if (passengers.isEmpty)
              const _NoticeCard(message: '暂无已支付乘客。')
            else
              ...passengers.map((passenger) {
                final canBoard = passenger['canBoard'] == true;
                final seatNumber = passenger['seatNumber'];
                return Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: _Card(
                    child: Row(
                      children: [
                        Icon(
                          canBoard
                              ? Icons.check_circle_outline
                              : Icons.block_outlined,
                          color: canBoard
                              ? FishingTokens.brand
                              : Colors.orangeAccent,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                seatNumber == null ? '乘客' : '$seatNumber 号钓位',
                                style: _sectionTitle,
                              ),
                              const SizedBox(height: 3),
                              Text(
                                _insuranceGateStatus('${passenger['status']}'),
                                style: _muted,
                              ),
                              if (passenger['failureReason'] != null)
                                Text(
                                  _insuranceFailureReason(
                                    '${passenger['failureReason']}',
                                  ),
                                  style: _muted,
                                ),
                            ],
                          ),
                        ),
                        Text(
                          canBoard ? '可登船' : '暂不能登船',
                          style: TextStyle(
                            color: canBoard
                                ? FishingTokens.brand
                                : Colors.orangeAccent,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              }),
            const SizedBox(height: 8),
            const Text(
              '仅依据保险机构回查的有效状态放行；单个乘客问题不自动拦停其他乘客，也不能人工跳过门禁。',
              style: _smallNote,
            ),
          ],
        ),
      ),
    );
  }
}

String _insuranceGateStatus(String status) => switch (status) {
  'effective' => '保障已核实生效',
  'pending_verification' => '待核实',
  'failed' => '保障未生效',
  'not_insured' => '尚未投保',
  _ => '未核实',
};

String _insuranceFailureReason(String reason) => switch (reason) {
  'platform_supplier_fault' => '平台或供应商故障',
  'data_error' => '资料有误',
  'insurer_rejected' => '保险机构拒保',
  'payment_failed' => '保费支付失败',
  _ => '失败原因待核实',
};

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

class _SupplementRoundCard extends StatelessWidget {
  const _SupplementRoundCard({
    required this.round,
    required this.working,
    required this.error,
    required this.onDecision,
    required this.onPay,
  });

  final Map<String, dynamic> round;
  final bool working;
  final String? error;
  final ValueChanged<String> onDecision;
  final VoidCallback onPay;

  @override
  Widget build(BuildContext context) {
    final participant = _map(round['participant']);
    final roundStatus = (round['status'] ?? '').toString();
    final consent = (participant['consentStatus'] ?? '').toString();
    final payment = (participant['paymentStatus'] ?? '').toString();
    final amountFen = _int(participant['amountFen']);
    final statusLabel = switch (roundStatus) {
      'collecting_consent' => '等待全员确认',
      'collecting_payment' => '等待补差支付',
      'succeeded' => '补差完成',
      'failed' => '本轮已失效',
      'expired' => '响应超时',
      _ => '补差状态更新中',
    };

    return _Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(child: Text('成团补差', style: _sectionTitle)),
              _StagePill(label: statusLabel),
            ],
          ),
          const SizedBox(height: 10),
          _InfoLine(
            label: '本轮缺口',
            value: '¥${_yuan(_int(round['shortfallFen']))}',
          ),
          _InfoLine(
            label: '确认截止',
            value: _dateTime(round['responseDeadlineAt']),
          ),
          if (participant.isEmpty) ...[
            const SizedBox(height: 6),
            const Text('本订单不在本轮补差参与范围内。', style: _muted),
          ] else ...[
            _InfoLine(label: '本单补差', value: '¥${_yuan(amountFen)}'),
            _InfoLine(label: '确认状态', value: _consentLabel(consent)),
            if (roundStatus == 'collecting_consent' &&
                consent == 'pending') ...[
              const SizedBox(height: 12),
              const Text('同意后需等待所有参与订单确认；本轮只发起一次。', style: _muted),
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  FilledButton(
                    onPressed: working ? null : () => onDecision('accept'),
                    child: const Text('同意本轮补差'),
                  ),
                  OutlinedButton(
                    onPressed: working ? null : () => onDecision('reject'),
                    child: const Text('拒绝本轮'),
                  ),
                ],
              ),
            ],
            if (roundStatus == 'collecting_consent' && consent == 'accepted')
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text('已确认，等待其他参与订单回复。', style: _muted),
              ),
            if (roundStatus == 'collecting_payment') ...[
              _InfoLine(label: '支付状态', value: _supplementPaymentLabel(payment)),
              if (consent == 'accepted' &&
                  amountFen > 0 &&
                  payment != 'succeeded') ...[
                const SizedBox(height: 10),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: working ? null : onPay,
                    icon: const Icon(Icons.lock_outline),
                    label: const Text('继续沙盒补差支付'),
                  ),
                ),
              ],
              if (amountFen == 0)
                const Padding(
                  padding: EdgeInsets.only(top: 8),
                  child: Text('本单分摊金额为 ¥0，无需支付。', style: _muted),
                ),
            ],
            if (roundStatus == 'succeeded')
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text('本轮补差已完成，服务器已复核成行结果。', style: _muted),
              ),
            if (['failed', 'expired'].contains(roundStatus))
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text('本轮不会自动重开；请查看订单退款状态。', style: _muted),
              ),
            if (['failed', 'expired'].contains(roundStatus) &&
                !['rejected', 'timed_out'].contains(consent)) ...[
              const SizedBox(height: 8),
              const Text('本轮失效后，你仍可退出本订单并申请全额退款。', style: _muted),
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  onPressed: working ? null : () => onDecision('reject'),
                  child: const Text('退出并申请全额退款'),
                ),
              ),
            ],
          ],
          if (working) ...[
            const SizedBox(height: 10),
            const LinearProgressIndicator(minHeight: 2),
          ],
          if (error != null) ...[
            const SizedBox(height: 8),
            Text(
              error!,
              style: const TextStyle(color: Colors.redAccent, fontSize: 12),
            ),
          ],
        ],
      ),
    );
  }
}

String _consentLabel(String status) => switch (status) {
  'pending' => '待确认',
  'accepted' => '已同意',
  'rejected' => '已拒绝',
  'timed_out' => '已超时',
  _ => '—',
};

String _supplementPaymentLabel(String status) => switch (status) {
  'pending' => '待支付',
  'succeeded' => '已支付',
  'failed' => '失败 · 本轮已失效',
  'refund_pending' => '退款处理中',
  _ => '尚未开始',
};

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
  'formation_overdue' => '已过出航时间 · 待人工处理',
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
