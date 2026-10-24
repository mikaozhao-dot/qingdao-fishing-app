import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';

import 'api_client.dart';
import 'fishing_tokens.dart';

class Step3OrdersWorkspace extends StatefulWidget {
  const Step3OrdersWorkspace({
    required this.token,
    required this.onOpenProfile,
    required this.onTokenChanged,
    super.key,
  });

  final String? token;
  final VoidCallback onOpenProfile;
  final ValueChanged<String?> onTokenChanged;

  @override
  State<Step3OrdersWorkspace> createState() => _Step3OrdersWorkspaceState();
}

class _Step3OrdersWorkspaceState extends State<Step3OrdersWorkspace> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant Step3OrdersWorkspace oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.token != widget.token) _load();
  }

  Future<void> _load() async {
    final token = widget.token;
    if (token == null) {
      setState(() {
        _items = [];
        _loading = false;
        _error = null;
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await Step1Api.get('/orders', token: token);
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
      return _Step3Message(
        title: '登录后查看订单',
        body: '订单记录与支付状态会保存在你的账号中。',
        action: '去登录',
        onAction: widget.onOpenProfile,
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(18, 12, 18, 32),
        children: [
          const _Eyebrow('YOUR TRIPS'),
          const SizedBox(height: 8),
          const Text('我的订单', style: _titleStyle),
          const SizedBox(height: 14),
          if (_loading) const LinearProgressIndicator(minHeight: 2),
          if (_error != null) _ErrorCard(message: _error!, onRetry: _load),
          if (!_loading && _error == null && _items.isEmpty)
            const _Step3Message(title: '还没有订单', body: '选好座位后，订单会出现在这里。'),
          ..._items.map(
            (item) => _OrderCard(
              item: item,
              onTap: () async {
                await Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => OrderDetailPage(
                      orderId: '${item['id']}',
                      token: widget.token!,
                    ),
                  ),
                );
                if (mounted) _load();
              },
            ),
          ),
        ],
      ),
    );
  }
}

class SeatSelectionPage extends StatefulWidget {
  const SeatSelectionPage({
    required this.departureId,
    required this.token,
    super.key,
  });

  final String departureId;
  final String token;

  @override
  State<SeatSelectionPage> createState() => _SeatSelectionPageState();
}

class _SeatSelectionPageState extends State<SeatSelectionPage> {
  List<Map<String, dynamic>> _seats = [];
  final Set<String> _selected = {};
  bool _loading = true;
  bool _submitting = false;
  String? _error;
  String? _layoutError;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _layoutError = null;
    });
    try {
      final result = await Step1Api.get(
        '/departures/${widget.departureId}/seats',
        token: widget.token,
      );
      if (!mounted) return;
      final seats = _maps(result['seats']);
      final missingPosition = seats.where((seat) {
        final side = seat['side'];
        final section = seat['section'];
        return (side != 'port' && side != 'starboard') ||
            !_seatSections.contains('$section');
      }).toList();
      setState(() {
        _seats = seats;
        _layoutError = missingPosition.isEmpty
            ? null
            : '钓位 ${missingPosition.first['number'] ?? '未知'} 缺少舷侧或分区资料，暂不能安全展示和锁位。';
        final availableIds = seats
            .where((seat) => seat['status'] == 'available')
            .map((seat) => '${seat['id']}')
            .toSet();
        _selected.removeWhere((id) => !availableIds.contains(id));
        if (_layoutError != null) _selected.clear();
      });
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = error.toString().replaceFirst('Exception: ', ''),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  int get _totalFen => _seats
      .where((seat) => _selected.contains('${seat['id']}'))
      .fold(0, (total, seat) => total + _number(seat['priceFen']));

  Future<void> _holdSeats() async {
    if (_selected.isEmpty || _submitting) return;
    setState(() => _submitting = true);
    try {
      final response = await Step1Api.post(
        '/departures/${widget.departureId}/seat-holds',
        {'seatIds': _selected.toList()},
        token: widget.token,
      );
      final hold = _map(response['hold']);
      final expiresAt =
          DateTime.tryParse('${response['expiresAt'] ?? hold['expiresAt']}') ??
          DateTime.now().add(const Duration(minutes: 10));
      final seats = _seats
          .where((seat) => _selected.contains('${seat['id']}'))
          .toList();
      if (!mounted) return;
      await Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(
          builder: (_) => OrderConfirmationPage(
            holdId: '${response['holdId'] ?? hold['holdId']}',
            expiresAt: expiresAt,
            seats: seats,
            token: widget.token,
          ),
        ),
      );
    } catch (error) {
      if (mounted) {
        final message = error.toString().replaceFirst('Exception: ', '');
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(message)));
        await _load();
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFF063638),
    appBar: AppBar(
      title: const Text('选择座位'),
      backgroundColor: const Color(0xFF063638),
      foregroundColor: const Color(0xFFEAF2EE),
      elevation: 0,
    ),
    body: _loading
        ? const Center(child: CircularProgressIndicator())
        : _error != null
        ? _ErrorCard(message: _error!, onRetry: _load)
        : Stack(
            children: [
              const Positioned.fill(
                child: CustomPaint(painter: _SeaWaterPainter()),
              ),
              Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(18, 8, 18, 2),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        const Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              _Eyebrow('SEAT MAP'),
                              SizedBox(height: 3),
                              Text('按船型挑选钓位', style: _sectionStyle),
                              SizedBox(height: 2),
                              Text('船头朝上 · 位置示意，非等比例', style: _noteStyle),
                            ],
                          ),
                        ),
                        Text(
                          '${_seats.length} 个钓位',
                          style: const TextStyle(
                            color: FishingTokens.secondary,
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(8, 0, 8, 6),
                      child: Column(
                        children: [
                          Expanded(
                            child: _SeatMap(
                              seats: _seats,
                              selectedIds: _selected,
                              layoutError: _layoutError,
                              onTap: (seat) {
                                final id = '${seat['id']}';
                                if (_layoutError != null ||
                                    (seat['status'] != 'available' &&
                                        !_selected.contains(id))) {
                                  return;
                                }
                                setState(() {
                                  if (!_selected.add(id)) {
                                    _selected.remove(id);
                                  } else if (_selected.length > 6) {
                                    _selected.remove(id);
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      const SnackBar(
                                        content: Text('同一订单最多选择 6 个座位'),
                                      ),
                                    );
                                  }
                                });
                              },
                            ),
                          ),
                          const Padding(
                            padding: EdgeInsets.fromLTRB(8, 2, 8, 2),
                            child: _SeatLegend(),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
    bottomNavigationBar: _loading || _error != null
        ? null
        : SafeArea(
            top: false,
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
              decoration: const BoxDecoration(
                color: Color(0xFF052224),
                border: Border(top: BorderSide(color: Color(0xFF315457))),
              ),
              child: Row(
                children: [
                  Expanded(
                    flex: 6,
                    child: Row(
                      children: [
                        _SelectedSeatBadge(
                          seats: _seats,
                          selectedIds: _selected,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Text(
                                '已选择座位',
                                style: TextStyle(
                                  color: Color(0xFFAFC6C1),
                                  fontSize: 10,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              const SizedBox(height: 3),
                              Text(
                                _selectedSeatSummary(_seats, _selected),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: Color(0xFFF3F7F3),
                                  fontSize: 12,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              Text(
                                _selected.length == 1
                                    ? '${_money(_totalFen)}/位'
                                    : '合计 ${_money(_totalFen)}',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: Color(0xFFFFC875),
                                  fontSize: 17,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    flex: 4,
                    child: SizedBox(
                      height: 54,
                      child: FilledButton(
                        style: FilledButton.styleFrom(
                          backgroundColor: const Color(0xFFC9F05A),
                          foregroundColor: const Color(0xFF12251B),
                          disabledBackgroundColor: const Color(0xFF48594A),
                          disabledForegroundColor: const Color(0xFFB0BBB1),
                          shape: const StadiumBorder(),
                          elevation: 5,
                        ),
                        onPressed:
                            _selected.isEmpty ||
                                _submitting ||
                                _layoutError != null
                            ? null
                            : _holdSeats,
                        child: _submitting
                            ? const SizedBox(
                                width: 19,
                                height: 19,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const FittedBox(
                                fit: BoxFit.scaleDown,
                                child: Text(
                                  '确认选择',
                                  style: TextStyle(
                                    fontSize: 18,
                                    fontWeight: FontWeight.w900,
                                    letterSpacing: 1,
                                  ),
                                ),
                              ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
  );
}

class OrderConfirmationPage extends StatefulWidget {
  const OrderConfirmationPage({
    required this.holdId,
    required this.expiresAt,
    required this.seats,
    required this.token,
    super.key,
  });

  final String holdId;
  final DateTime expiresAt;
  final List<Map<String, dynamic>> seats;
  final String token;

  @override
  State<OrderConfirmationPage> createState() => _OrderConfirmationPageState();
}

class _PassengerFields {
  _PassengerFields(this.seatId, this.seatNumber)
    : name = TextEditingController(),
      identity = TextEditingController(),
      phone = TextEditingController();

  final String seatId;
  final int seatNumber;
  final TextEditingController name;
  final TextEditingController identity;
  final TextEditingController phone;

  void dispose() {
    name.dispose();
    identity.dispose();
    phone.dispose();
  }
}

class _OrderConfirmationPageState extends State<OrderConfirmationPage> {
  late final List<_PassengerFields> _passengers = widget.seats
      .map((seat) => _PassengerFields('${seat['id']}', _number(seat['number'])))
      .toList();
  late final String _idempotencyKey = _newIdempotencyKey();
  Timer? _timer;
  int _secondsLeft = 0;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _tick();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) => _tick());
  }

  void _tick() {
    if (!mounted) return;
    final seconds = widget.expiresAt.difference(DateTime.now()).inSeconds;
    setState(() => _secondsLeft = max(0, seconds));
  }

  int get _totalFen =>
      widget.seats.fold(0, (sum, seat) => sum + _number(seat['priceFen']));

  Future<void> _createOrder() async {
    if (_saving) return;
    if (_secondsLeft <= 0) {
      setState(() => _error = '座位锁定已到期，请返回重新选位。');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final orderResponse = await Step1Api.post('/orders', {
        'holdId': widget.holdId,
        'idempotencyKey': _idempotencyKey,
        'passengers': [
          for (final passenger in _passengers)
            {
              'seatId': passenger.seatId,
              'fullName': passenger.name.text.trim(),
              'identityNumber': passenger.identity.text.trim(),
              'phone': passenger.phone.text.trim(),
            },
        ],
      }, token: widget.token);
      final order = _map(orderResponse['order']);
      if (!mounted) return;
      await Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(
          builder: (_) => SandboxPaymentPage(
            orderId: '${order['id']}',
            orderNumber: '${order['orderNumber']}',
            totalFen: _number(_map(order['amount'])['totalFen']),
            token: widget.token,
          ),
        ),
      );
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = error.toString().replaceFirst('Exception: ', ''),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    for (final passenger in _passengers) {
      passenger.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('确认订单')),
    body: ListView(
      padding: const EdgeInsets.fromLTRB(18, 8, 18, 28),
      children: [
        const _Eyebrow('CONFIRM YOUR SEATS'),
        const SizedBox(height: 8),
        const Text('核对乘船人信息', style: _titleStyle),
        const SizedBox(height: 6),
        Text(
          '锁位剩余 ${_secondsLeft ~/ 60}:${(_secondsLeft % 60).toString().padLeft(2, '0')}',
          style: _bodyStyle,
        ),
        const SizedBox(height: 14),
        _Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('座位与金额', style: _sectionStyle),
              const SizedBox(height: 8),
              for (final seat in widget.seats)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          '钓位 ${seat['number']}${seat['isPremium'] == true ? ' · 船尾加价位' : ''}',
                          style: _bodyStyle,
                        ),
                      ),
                      Text(
                        _money(_number(seat['priceFen'])),
                        style: _bodyStyle,
                      ),
                    ],
                  ),
                ),
              const Divider(height: 20),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('应付金额'),
                  Text(_money(_totalFen), style: _priceStyle),
                ],
              ),
              const SizedBox(height: 6),
              const Text('全额预付；服务端以座位价格重算，沙盒支付不会产生真实资金流。', style: _noteStyle),
            ],
          ),
        ),
        const SizedBox(height: 14),
        for (var index = 0; index < _passengers.length; index++) ...[
          _PassengerForm(index: index + 1, fields: _passengers[index]),
          const SizedBox(height: 10),
        ],
        const _Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('意外险必买', style: _sectionStyle),
              SizedBox(height: 6),
              Text('保险由持牌保险机构承保并独立收取保费。本订单金额不含保费，平台不经手保险费。', style: _bodyStyle),
            ],
          ),
        ),
        if (_error != null) ...[
          const SizedBox(height: 10),
          _ErrorCard(message: _error!),
        ],
        const SizedBox(height: 14),
        FilledButton(
          onPressed: _saving || _secondsLeft <= 0 ? null : _createOrder,
          child: Text(_saving ? '正在创建订单…' : '确认并进入沙盒支付 · ${_money(_totalFen)}'),
        ),
      ],
    ),
  );
}

class SandboxPaymentPage extends StatefulWidget {
  const SandboxPaymentPage({
    required this.orderId,
    required this.orderNumber,
    required this.totalFen,
    required this.token,
    super.key,
  });

  final String orderId;
  final String orderNumber;
  final int totalFen;
  final String token;

  @override
  State<SandboxPaymentPage> createState() => _SandboxPaymentPageState();
}

class _SandboxPaymentPageState extends State<SandboxPaymentPage> {
  bool _loading = true;
  bool _submitting = false;
  String? _error;
  String? _reference;

  @override
  void initState() {
    super.initState();
    _createIntent();
  }

  Future<void> _createIntent() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await Step1Api.post(
        '/orders/${widget.orderId}/payment-intents',
        const {},
        token: widget.token,
      );
      if (mounted) {
        setState(() => _reference = '${_map(result['payment'])['reference']}');
      }
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = error.toString().replaceFirst('Exception: ', ''),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _simulate(String outcome) async {
    if (_submitting || _reference == null) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await Step1Api.post('/orders/${widget.orderId}/sandbox-payment', {
        'outcome': outcome,
      }, token: widget.token);
      if (!mounted) return;
      await Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(
          builder: (_) =>
              OrderDetailPage(orderId: widget.orderId, token: widget.token),
        ),
      );
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = error.toString().replaceFirst('Exception: ', ''),
        );
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('沙盒支付')),
    body: ListView(
      padding: const EdgeInsets.fromLTRB(18, 12, 18, 28),
      children: [
        const _Eyebrow('PAYMENT ADAPTER · SANDBOX'),
        const SizedBox(height: 10),
        const Icon(Icons.shield_outlined, size: 54, color: FishingTokens.brand),
        const SizedBox(height: 12),
        const Text('模拟支付', textAlign: TextAlign.center, style: _titleStyle),
        const SizedBox(height: 8),
        const Text(
          '这是沙盒演示，不会连接微信/支付宝，也不会产生真实扣款。',
          textAlign: TextAlign.center,
          style: _bodyStyle,
        ),
        const SizedBox(height: 18),
        _Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _InfoRow(label: '订单号', value: widget.orderNumber),
              const SizedBox(height: 8),
              _InfoRow(
                label: '应付金额',
                value: _money(widget.totalFen),
                highlight: true,
              ),
              if (_reference != null) ...[
                const SizedBox(height: 8),
                _InfoRow(label: '沙盒流水', value: _reference!),
              ],
            ],
          ),
        ),
        if (_loading)
          const Padding(
            padding: EdgeInsets.all(18),
            child: Center(child: CircularProgressIndicator()),
          ),
        if (_error != null) ...[
          const SizedBox(height: 12),
          _ErrorCard(message: _error!, onRetry: _createIntent),
        ],
        const SizedBox(height: 16),
        _OutcomeButton(
          label: '模拟支付成功',
          icon: Icons.check_circle_outline,
          onPressed: _loading || _error != null
              ? null
              : () => _simulate('success'),
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: _loading || _error != null
              ? null
              : () => _simulate('failure'),
          icon: const Icon(Icons.highlight_off_outlined),
          label: const Text('模拟支付失败'),
        ),
        const SizedBox(height: 8),
        TextButton.icon(
          onPressed: _loading || _error != null
              ? null
              : () => _simulate('timeout'),
          icon: const Icon(Icons.timer_off_outlined),
          label: const Text('模拟支付超时并释放锁位'),
        ),
        if (_submitting) const LinearProgressIndicator(minHeight: 2),
      ],
    ),
  );
}

class OrderDetailPage extends StatefulWidget {
  const OrderDetailPage({
    required this.orderId,
    required this.token,
    super.key,
  });

  final String orderId;
  final String token;

  @override
  State<OrderDetailPage> createState() => _OrderDetailPageState();
}

class _OrderDetailPageState extends State<OrderDetailPage> {
  Map<String, dynamic>? _order;
  bool _loading = true;
  bool _insuranceWorking = false;
  String? _error;

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await Step1Api.get(
        '/orders/${widget.orderId}',
        token: widget.token,
      );
      if (mounted) setState(() => _order = _map(result['order']));
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = error.toString().replaceFirst('Exception: ', ''),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openInsurance() async {
    if (_insuranceWorking) return;
    setState(() {
      _insuranceWorking = true;
      _error = null;
    });
    try {
      final response = await Step1Api.post(
        '/orders/${widget.orderId}/insurance/checkout',
        const {},
        token: widget.token,
      );
      final url = '${response['checkoutUrl'] ?? ''}';
      if (!mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        backgroundColor: FishingTokens.surface,
        builder: (context) => Padding(
          padding: const EdgeInsets.fromLTRB(20, 24, 20, 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('沙盒投保入口', style: _sectionStyle),
              const SizedBox(height: 8),
              const Text('此链接使用保留的 .invalid 域名，不会访问真实保险机构。', style: _bodyStyle),
              const SizedBox(height: 12),
              SelectableText(url, style: _noteStyle),
              const SizedBox(height: 10),
              _OutcomeButton(
                label: '模拟保险机构回传已投保',
                icon: Icons.verified_outlined,
                onPressed: () async {
                  Navigator.pop(context);
                  try {
                    await Step1Api.post(
                      '/orders/${widget.orderId}/insurance/sandbox',
                      {'status': 'issued'},
                      token: widget.token,
                    );
                    if (mounted) _load();
                  } catch (error) {
                    if (mounted) {
                      setState(
                        () => _error = error.toString().replaceFirst(
                          'Exception: ',
                          '',
                        ),
                      );
                    }
                  }
                },
              ),
            ],
          ),
        ),
      );
      await _load();
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = error.toString().replaceFirst('Exception: ', ''),
        );
      }
    } finally {
      if (mounted) setState(() => _insuranceWorking = false);
    }
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('订单详情')),
    body: _loading
        ? const Center(child: CircularProgressIndicator())
        : _error != null && _order == null
        ? _ErrorCard(message: _error!, onRetry: _load)
        : _body(),
  );

  Widget _body() {
    final order = _order!;
    final amount = _map(order['amount']);
    final seats = _maps(order['seats']);
    final passengers = _maps(order['passengers']);
    final insurance = _map(order['insurance']);
    final passengerCoverages = _maps(insurance['passengerCoverages']);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(18, 8, 18, 28),
        children: [
          const _Eyebrow('ORDER · SANDBOX'),
          const SizedBox(height: 8),
          const Text('订单已生成', style: _titleStyle),
          const SizedBox(height: 12),
          _Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _InfoRow(label: '订单号', value: '${order['orderNumber']}'),
                const SizedBox(height: 8),
                _InfoRow(
                  label: '订单状态',
                  value: _orderStatus('${order['status']}'),
                  highlight: true,
                ),
                const SizedBox(height: 8),
                _InfoRow(
                  label: '班次',
                  value:
                      '${order['boatName'] ?? '海上班次'} · ${order['departureAt'] ?? ''}',
                ),
                const SizedBox(height: 8),
                _InfoRow(
                  label: '应付金额',
                  value: _money(_number(amount['totalFen'])),
                  highlight: true,
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          _Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('座位与乘船人', style: _sectionStyle),
                const SizedBox(height: 8),
                for (var index = 0; index < seats.length; index++)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 5),
                    child: Text(
                      '钓位 ${seats[index]['number']} · ${_money(_number(seats[index]['priceFen']))}　${_passengerLabel(passengers, seats[index])}',
                      style: _bodyStyle,
                    ),
                  ),
                const SizedBox(height: 6),
                const Text('实名资料已加密保存；订单页仅显示掩码。', style: _noteStyle),
              ],
            ),
          ),
          const SizedBox(height: 12),
          _Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('金额明细', style: _sectionStyle),
                const SizedBox(height: 8),
                _InfoRow(
                  label: '船位费',
                  value: _money(_number(amount['seatFeeFen'])),
                ),
                _InfoRow(
                  label: '优惠',
                  value: '-${_money(_number(amount['discountFen']))}',
                ),
                _InfoRow(
                  label: '平台服务费',
                  value: _money(_number(amount['platformFeeFen'])),
                ),
                const Divider(height: 20),
                _InfoRow(
                  label: '合计',
                  value: _money(_number(amount['totalFen'])),
                  highlight: true,
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          _Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('保险状态', style: _sectionStyle),
                const SizedBox(height: 6),
                Text(
                  _insuranceStatus('${insurance['status']}'),
                  style: _bodyStyle,
                ),
                const SizedBox(height: 4),
                const Text('保险费由持牌保险机构独立收取，不计入本订单，平台不代收。', style: _noteStyle),
                if (passengerCoverages.isNotEmpty) ...[
                  const Divider(height: 20),
                  for (final coverage in passengerCoverages)
                    _InfoRow(
                      label: coverage['seatNumber'] == null
                          ? '乘客保障'
                          : '钓位 ${coverage['seatNumber']} 保障',
                      value: _passengerInsuranceStatus(
                        '${coverage['status']}',
                        coverage['failureReason']?.toString(),
                      ),
                    ),
                ],
                if (insurance['checkoutUrl'] != null) ...[
                  const SizedBox(height: 6),
                  SelectableText(
                    '${insurance['checkoutUrl']}',
                    style: _noteStyle,
                  ),
                ],
                if (order['status'] == 'paid' &&
                    insurance['status'] != 'issued') ...[
                  const SizedBox(height: 12),
                  FilledButton.tonalIcon(
                    onPressed: _insuranceWorking ? null : _openInsurance,
                    icon: const Icon(Icons.open_in_new_rounded),
                    label: Text(_insuranceWorking ? '正在准备…' : '查看沙盒投保入口'),
                  ),
                ],
                if (insurance['status'] == 'issued') ...[
                  const SizedBox(height: 6),
                  Text(
                    '沙盒保单号：${insurance['policyReference'] ?? '已登记'}',
                    style: _noteStyle,
                  ),
                ],
              ],
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 10),
            _ErrorCard(message: _error!),
          ],
          const SizedBox(height: 12),
          const Text('退改按平台阶梯规则执行；此阶段仅展示，不提供退款操作。', style: _noteStyle),
        ],
      ),
    );
  }
}

class _PassengerForm extends StatelessWidget {
  const _PassengerForm({required this.index, required this.fields});
  final int index;
  final _PassengerFields fields;

  @override
  Widget build(BuildContext context) => _Panel(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('乘船人 $index · 钓位 ${fields.seatNumber}', style: _sectionStyle),
        const SizedBox(height: 8),
        TextField(
          controller: fields.name,
          textInputAction: TextInputAction.next,
          decoration: const InputDecoration(labelText: '真实姓名'),
        ),
        TextField(
          controller: fields.identity,
          textInputAction: TextInputAction.next,
          keyboardType: TextInputType.text,
          decoration: const InputDecoration(labelText: '身份证号码'),
        ),
        TextField(
          controller: fields.phone,
          keyboardType: TextInputType.phone,
          decoration: const InputDecoration(labelText: '手机号'),
        ),
      ],
    ),
  );
}

class _SeatMap extends StatelessWidget {
  const _SeatMap({
    required this.seats,
    required this.selectedIds,
    required this.layoutError,
    required this.onTap,
  });
  final List<Map<String, dynamic>> seats;
  final Set<String> selectedIds;
  final String? layoutError;
  final ValueChanged<Map<String, dynamic>> onTap;

  @override
  Widget build(BuildContext context) {
    if (layoutError != null) {
      return _Panel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('座位位置待核对', style: _sectionStyle),
            const SizedBox(height: 6),
            Text(layoutError!, style: _bodyStyle),
          ],
        ),
      );
    }
    if (_isFounderTwelveSeatLayout(seats)) {
      return _FounderBoatMap(
        seats: seats,
        selectedIds: selectedIds,
        onTap: onTap,
      );
    }
    return _GenericSeatMap(
      seats: seats,
      selectedIds: selectedIds,
      onTap: onTap,
    );
  }
}

const _founderLayoutByNumber = <int, String>{
  1: 'port:bow',
  2: 'port:bow',
  3: 'port:mid',
  4: 'port:mid',
  5: 'port:stern',
  6: 'port:stern',
  7: 'starboard:stern',
  8: 'starboard:stern',
  9: 'starboard:mid',
  10: 'starboard:mid',
  11: 'starboard:bow',
  12: 'starboard:bow',
};
const _seatSections = {'bow', 'mid', 'stern'};

bool _isFounderTwelveSeatLayout(List<Map<String, dynamic>> seats) {
  if (seats.length != _founderLayoutByNumber.length) return false;
  final actual = <int, String>{};
  final premiumNumbers = <int>{};
  for (final seat in seats) {
    final number = _number(seat['number']);
    if (actual.containsKey(number)) return false;
    actual[number] = '${seat['side']}:${seat['section']}';
    if (seat['isPremium'] == true) premiumNumbers.add(number);
  }
  const originalPremium = {6, 7};
  const expandedPremium = {5, 6, 7, 8};
  final supportedPremium =
      premiumNumbers.length == originalPremium.length &&
          premiumNumbers.containsAll(originalPremium) ||
      premiumNumbers.length == expandedPremium.length &&
          premiumNumbers.containsAll(expandedPremium);
  if (!supportedPremium || actual.length != _founderLayoutByNumber.length) {
    return false;
  }
  return _founderLayoutByNumber.entries.every(
    (entry) => actual[entry.key] == entry.value,
  );
}

class _SeatPosition {
  const _SeatPosition({required this.seat, required this.x, required this.y});
  final Map<String, dynamic> seat;
  final double x;
  final double y;
}

List<_SeatPosition> _deriveSeatPositions(List<Map<String, dynamic>> seats) {
  const sectionBands = <String, (double, double)>{
    'bow': (.115, .325),
    'mid': (.345, .605),
    'stern': (.635, .855),
  };
  final groups = <String, List<Map<String, dynamic>>>{};
  for (final seat in seats) {
    final side = '${seat['side']}';
    final section = '${seat['section']}';
    groups.putIfAbsent('$side:$section', () => []).add(seat);
  }

  final positions = <_SeatPosition>[];
  for (final entry in groups.entries) {
    final parts = entry.key.split(':');
    final side = parts[0];
    final section = parts[1];
    final band = sectionBands[section]!;
    final group = entry.value
      ..sort((left, right) {
        final ascending = _number(
          left['number'],
        ).compareTo(_number(right['number']));
        return side == 'port' ? ascending : -ascending;
      });
    for (var index = 0; index < group.length; index++) {
      positions.add(
        _SeatPosition(
          seat: group[index],
          x: side == 'port' ? .235 : .765,
          y: band.$1 + (index + .5) * (band.$2 - band.$1) / group.length,
        ),
      );
    }
  }
  return positions;
}

class _FounderBoatMap extends StatelessWidget {
  const _FounderBoatMap({
    required this.seats,
    required this.selectedIds,
    required this.onTap,
  });
  final List<Map<String, dynamic>> seats;
  final Set<String> selectedIds;
  final ValueChanged<Map<String, dynamic>> onTap;

  @override
  Widget build(BuildContext context) => Center(
    child: AspectRatio(
      aspectRatio: .67,
      child: LayoutBuilder(
        builder: (context, mapConstraints) {
          final width = mapConstraints.maxWidth;
          final height = mapConstraints.maxHeight;
          final positions = _deriveSeatPositions(seats);
          const markerWidth = 52.0;
          const markerHeight = 50.0;
          return Stack(
            clipBehavior: Clip.none,
            children: [
              Positioned.fill(child: CustomPaint(painter: _BoatHullPainter())),
              Positioned(
                left: width * .405,
                top: height * .015,
                width: width * .19,
                height: 34,
                child: const Column(
                  children: [
                    Text(
                      '船头',
                      style: TextStyle(
                        color: Color(0xFFE4F1EE),
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        height: 1,
                      ),
                    ),
                    Icon(
                      Icons.arrow_drop_up_rounded,
                      color: Color(0xFFE4F1EE),
                      size: 22,
                    ),
                  ],
                ),
              ),
              Positioned(
                left: width * .005,
                top: height * .435,
                width: width * .15,
                height: 22,
                child: const _SideLabel('左舷', left: true),
              ),
              Positioned(
                right: width * .005,
                top: height * .435,
                width: width * .15,
                height: 22,
                child: const _SideLabel('右舷'),
              ),
              Positioned(
                left: width * .32,
                top: height * .335,
                width: width * .07,
                height: height * .275,
                child: const _AisleSchematic(),
              ),
              Positioned(
                right: width * .32,
                top: height * .335,
                width: width * .07,
                height: height * .275,
                child: const _AisleSchematic(),
              ),
              Positioned(
                left: width * .39,
                top: height * .31,
                width: width * .22,
                height: height * .30,
                child: const _CabinSchematic(),
              ),
              Positioned(
                left: width * .41,
                top: height * .875,
                width: width * .18,
                height: 24,
                child: const _SideLabel('船尾', showArrow: false),
              ),
              Positioned(
                left: width * .415,
                top: height * .92,
                width: width * .17,
                height: height * .075,
                child: const _EngineSchematic(),
              ),
              for (final position in positions)
                Positioned(
                  left: width * position.x - markerWidth / 2,
                  top: height * position.y - markerHeight / 2,
                  width: markerWidth,
                  height: markerHeight,
                  child: _SeatTile(
                    seat: position.seat,
                    selected: selectedIds.contains('${position.seat['id']}'),
                    onTap: () => onTap(position.seat),
                  ),
                ),
            ],
          );
        },
      ),
    ),
  );
}

class _GenericSeatMap extends StatelessWidget {
  const _GenericSeatMap({
    required this.seats,
    required this.selectedIds,
    required this.onTap,
  });
  final List<Map<String, dynamic>> seats;
  final Set<String> selectedIds;
  final ValueChanged<Map<String, dynamic>> onTap;

  @override
  Widget build(BuildContext context) {
    final port = seats.where((seat) => seat['side'] == 'port').toList()
      ..sort((a, b) => _number(a['number']).compareTo(_number(b['number'])));
    final starboard =
        seats.where((seat) => seat['side'] == 'starboard').toList()..sort(
          (a, b) => _number(b['number']).compareTo(_number(a['number'])),
        );
    return Row(
      children: [
        Expanded(
          child: _GenericSeatSide(
            label: '左舷',
            seats: port,
            selectedIds: selectedIds,
            onTap: onTap,
          ),
        ),
        const VerticalDivider(width: 14, indent: 8, endIndent: 8),
        Expanded(
          child: _GenericSeatSide(
            label: '右舷',
            seats: starboard,
            selectedIds: selectedIds,
            onTap: onTap,
          ),
        ),
      ],
    );
  }
}

class _GenericSeatSide extends StatelessWidget {
  const _GenericSeatSide({
    required this.label,
    required this.seats,
    required this.selectedIds,
    required this.onTap,
  });
  final String label;
  final List<Map<String, dynamic>> seats;
  final Set<String> selectedIds;
  final ValueChanged<Map<String, dynamic>> onTap;

  @override
  Widget build(BuildContext context) => Column(
    children: [
      Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Text(label, style: _noteStyle),
      ),
      Expanded(
        child: ListView.separated(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
          itemCount: seats.length,
          separatorBuilder: (_, _) => const SizedBox(height: 8),
          itemBuilder: (context, index) {
            final seat = seats[index];
            return Center(
              child: SizedBox(
                width: 64,
                height: 48,
                child: _SeatTile(
                  seat: seat,
                  selected: selectedIds.contains('${seat['id']}'),
                  onTap: () => onTap(seat),
                ),
              ),
            );
          },
        ),
      ),
    ],
  );
}

class _SeaWaterPainter extends CustomPainter {
  const _SeaWaterPainter();

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawColor(const Color(0xFF063638), BlendMode.src);
    for (var index = 0; index < 78; index++) {
      final x = ((index * 73 + 19) % 997) / 997 * size.width;
      final y = ((index * 137 + 43) % 991) / 991 * size.height;
      final line = Path()
        ..moveTo(x, y)
        ..quadraticBezierTo(
          x + 3 + sin(index * 1.7) * 3,
          y - 2,
          x + 8 + (index % 5) * 2,
          y + 1,
        );
      canvas.drawPath(
        line,
        Paint()
          ..color = const Color(
            0xFF8AC5B7,
          ).withValues(alpha: index.isEven ? .10 : .055)
          ..style = PaintingStyle.stroke
          ..strokeWidth = index % 4 == 0 ? 1.2 : .7
          ..strokeCap = StrokeCap.round,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _SeaWaterPainter oldDelegate) => false;
}

class _BoatHullPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final width = size.width;
    final height = size.height;
    final bounds = Offset.zero & size;
    final hull = Path()
      ..moveTo(width * .5, height * .045)
      ..cubicTo(
        width * .67,
        height * .052,
        width * .81,
        height * .105,
        width * .855,
        height * .185,
      )
      ..lineTo(width * .86, height * .815)
      ..quadraticBezierTo(
        width * .86,
        height * .905,
        width * .78,
        height * .925,
      )
      ..lineTo(width * .22, height * .925)
      ..quadraticBezierTo(
        width * .14,
        height * .905,
        width * .14,
        height * .815,
      )
      ..lineTo(width * .145, height * .185)
      ..cubicTo(
        width * .19,
        height * .105,
        width * .33,
        height * .052,
        width * .5,
        height * .045,
      )
      ..close();

    final deck = Path()
      ..moveTo(width * .5, height * .071)
      ..cubicTo(
        width * .66,
        height * .078,
        width * .78,
        height * .125,
        width * .82,
        height * .195,
      )
      ..lineTo(width * .825, height * .81)
      ..quadraticBezierTo(
        width * .825,
        height * .878,
        width * .765,
        height * .895,
      )
      ..lineTo(width * .235, height * .895)
      ..quadraticBezierTo(
        width * .175,
        height * .878,
        width * .175,
        height * .81,
      )
      ..lineTo(width * .18, height * .195)
      ..cubicTo(
        width * .22,
        height * .125,
        width * .34,
        height * .078,
        width * .5,
        height * .071,
      )
      ..close();

    canvas.save();
    canvas.translate(0, 6);
    canvas.drawPath(
      hull,
      Paint()
        ..color = const Color(0xFF001416).withValues(alpha: .84)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 12),
    );
    canvas.restore();

    canvas.drawPath(
      hull,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFF3F5EF), Color(0xFFAEBAB4), Color(0xFF64736F)],
          stops: [0, .45, 1],
        ).createShader(bounds),
    );
    canvas.drawPath(
      deck,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xFF8A887F), Color(0xFF68675F), Color(0xFF4B5452)],
          stops: [0, .47, 1],
        ).createShader(bounds),
    );
    canvas.drawPath(
      hull,
      Paint()
        ..color = const Color(0xFFE9F0E9)
        ..strokeWidth = 1.8
        ..style = PaintingStyle.stroke,
    );
    canvas.drawPath(
      hull,
      Paint()
        ..color = const Color(0xFF536462).withValues(alpha: .92)
        ..strokeWidth = 4
        ..style = PaintingStyle.stroke,
    );
    canvas.drawPath(
      hull,
      Paint()
        ..color = const Color(0xFFE4EBE4).withValues(alpha: .95)
        ..strokeWidth = 1.3
        ..style = PaintingStyle.stroke,
    );
    canvas.drawPath(
      deck,
      Paint()
        ..color = const Color(0xFFD9E1D8).withValues(alpha: .68)
        ..strokeWidth = 1.1
        ..style = PaintingStyle.stroke,
    );

    final leftRail = Path()
      ..moveTo(width * .5, height * .06)
      ..cubicTo(
        width * .30,
        height * .075,
        width * .20,
        height * .13,
        width * .185,
        height * .205,
      )
      ..lineTo(width * .19, height * .805)
      ..quadraticBezierTo(
        width * .19,
        height * .865,
        width * .265,
        height * .88,
      );
    final rightRail = Path()
      ..moveTo(width * .5, height * .06)
      ..cubicTo(
        width * .70,
        height * .075,
        width * .80,
        height * .13,
        width * .815,
        height * .205,
      )
      ..lineTo(width * .81, height * .805)
      ..quadraticBezierTo(
        width * .81,
        height * .865,
        width * .735,
        height * .88,
      );
    canvas.drawPath(
      leftRail,
      Paint()
        ..color = const Color(0xFF374645)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 4.5
        ..strokeCap = StrokeCap.round,
    );
    canvas.drawPath(
      rightRail,
      Paint()
        ..color = const Color(0xFF374645)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 4.5
        ..strokeCap = StrokeCap.round,
    );
    canvas.drawPath(
      leftRail,
      Paint()
        ..color = const Color(0xFFFFFFFF).withValues(alpha: .9)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.1
        ..strokeCap = StrokeCap.round,
    );
    canvas.drawPath(
      rightRail,
      Paint()
        ..color = const Color(0xFFFFFFFF).withValues(alpha: .9)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.1
        ..strokeCap = StrokeCap.round,
    );

    canvas.save();
    canvas.clipPath(deck);
    for (var index = 0; index < 16; index++) {
      final x = width * (.225 + index * .0365);
      canvas.drawLine(
        Offset(x, height * .15),
        Offset(x, height * .865),
        Paint()
          ..color = const Color(0xFFE8DED0).withValues(alpha: .12)
          ..strokeWidth = 1,
      );
    }
    for (final y in [.335, .615]) {
      canvas.drawLine(
        Offset(width * .205, height * y),
        Offset(width * .795, height * y),
        Paint()
          ..color = const Color(0xFF263A39).withValues(alpha: .62)
          ..strokeWidth = 2.1,
      );
      canvas.drawLine(
        Offset(width * .205, height * (y + .006)),
        Offset(width * .795, height * (y + .006)),
        Paint()
          ..color = const Color(0xFFD1D6CB).withValues(alpha: .28)
          ..strokeWidth = .8,
      );
    }
    for (final side in [-1, 1]) {
      for (final y in [.225, .33, .62, .73, .835]) {
        final center = Offset(width * (.5 + side * .324), height * y);
        canvas.drawCircle(
          center,
          4.2,
          Paint()..color = const Color(0xFF253432),
        );
        canvas.drawCircle(
          center,
          2.5,
          Paint()..color = const Color(0xFFDAE1D9),
        );
        canvas.drawCircle(center, 1, Paint()..color = const Color(0xFF75827C));
      }
    }
    canvas.restore();

    final cabin = RRect.fromRectAndRadius(
      Rect.fromLTWH(width * .38, height * .30, width * .24, height * .30),
      const Radius.circular(12),
    );
    canvas.drawRRect(
      cabin.shift(const Offset(0, 7)),
      Paint()
        ..color = const Color(0xFF061314).withValues(alpha: .78)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 8),
    );
    canvas.drawRRect(
      cabin,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFE8EBE1), Color(0xFF87938E), Color(0xFF596866)],
        ).createShader(cabin.outerRect),
    );
    final cabinInner = RRect.fromRectAndRadius(
      Rect.fromLTWH(width * .392, height * .312, width * .216, height * .275),
      const Radius.circular(9),
    );
    canvas.drawRRect(
      cabinInner,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xFFD8DBD1), Color(0xFFAAB2AB), Color(0xFF23474A)],
          stops: [0, .52, 1],
        ).createShader(cabinInner.outerRect),
    );
    canvas.drawRRect(
      cabin,
      Paint()
        ..color = const Color(0xFFFCFDF7)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.4,
    );

    final roof = RRect.fromRectAndRadius(
      Rect.fromLTWH(width * .405, height * .325, width * .19, height * .145),
      const Radius.circular(8),
    );
    canvas.drawRRect(
      roof,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFF6F6F0), Color(0xFFD1D4CC), Color(0xFF9BA59F)],
        ).createShader(roof.outerRect),
    );
    canvas.drawRRect(
      roof,
      Paint()
        ..color = const Color(0xFFFFFFFF).withValues(alpha: .86)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1,
    );
    for (final x in [.435, .50, .565]) {
      canvas.drawLine(
        Offset(width * x, height * .34),
        Offset(width * x, height * .452),
        Paint()
          ..color = const Color(0xFF7F8A84).withValues(alpha: .32)
          ..strokeWidth = .8,
      );
    }

    final windshield = RRect.fromRectAndRadius(
      Rect.fromLTWH(width * .402, height * .475, width * .196, height * .052),
      const Radius.circular(4),
    );
    canvas.drawRRect(
      windshield,
      Paint()
        ..shader = const LinearGradient(
          colors: [Color(0xFF18383A), Color(0xFF071B1D)],
        ).createShader(windshield.outerRect),
    );
    for (final x in [.45, .50, .55]) {
      canvas.drawLine(
        Offset(width * x, height * .478),
        Offset(width * x, height * .525),
        Paint()
          ..color = const Color(0xFFB8C5BE).withValues(alpha: .5)
          ..strokeWidth = 1,
      );
    }
    final aftCabinWall = Rect.fromLTWH(
      width * .402,
      height * .535,
      width * .196,
      height * .052,
    );
    canvas.drawRect(
      aftCabinWall,
      Paint()
        ..shader = const LinearGradient(
          colors: [Color(0xFF0A2629), Color(0xFF174346)],
        ).createShader(aftCabinWall),
    );

    final aftDoor = RRect.fromRectAndRadius(
      Rect.fromLTWH(width * .462, height * .578, width * .076, height * .052),
      const Radius.circular(3),
    );
    canvas.drawRRect(
      aftDoor,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.centerLeft,
          end: Alignment.centerRight,
          colors: [Color(0xFFBCC5BB), Color(0xFF687571), Color(0xFFDCE0D6)],
        ).createShader(aftDoor.outerRect),
    );
    canvas.drawRRect(
      aftDoor,
      Paint()
        ..color = const Color(0xFFF5F4EA)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1,
    );
    canvas.drawLine(
      Offset(width * .47, height * .581),
      Offset(width * .47, height * .626),
      Paint()
        ..color = const Color(0xFF31403D)
        ..strokeWidth = 1.2,
    );
    canvas.drawCircle(
      Offset(width * .526, height * .601),
      1.4,
      Paint()..color = const Color(0xFF1A2726),
    );
  }

  @override
  bool shouldRepaint(covariant _BoatHullPainter oldDelegate) => false;
}

class _SideLabel extends StatelessWidget {
  const _SideLabel(this.label, {this.left = false, this.showArrow = true});
  final String label;
  final bool left;
  final bool showArrow;

  @override
  Widget build(BuildContext context) => Center(
    child: Row(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (showArrow && !left)
          const Icon(
            Icons.arrow_right_rounded,
            color: Color(0xFFE1EEEA),
            size: 14,
          ),
        Text(
          label,
          style: const TextStyle(
            color: Color(0xFFE1EEEA),
            fontSize: 9,
            fontWeight: FontWeight.w800,
            letterSpacing: .6,
          ),
        ),
        if (showArrow && left)
          const Icon(
            Icons.arrow_left_rounded,
            color: Color(0xFFE1EEEA),
            size: 14,
          ),
      ],
    ),
  );
}

class _AisleSchematic extends StatelessWidget {
  const _AisleSchematic();

  @override
  Widget build(BuildContext context) => const Center(
    child: RotatedBox(
      quarterTurns: 3,
      child: Text(
        '过道',
        maxLines: 1,
        style: TextStyle(
          color: Color(0xFFC0DEC8),
          fontSize: 8,
          fontWeight: FontWeight.w800,
          letterSpacing: 1,
        ),
      ),
    ),
  );
}

class _CabinSchematic extends StatelessWidget {
  const _CabinSchematic();

  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    label: '驾驶舱；船尾侧有通向后甲板的后门。位置示意，非等比例。',
    child: const Center(
      child: Text(
        '驾驶舱',
        textAlign: TextAlign.center,
        style: TextStyle(
          color: Color(0xFFF0F7F1),
          fontSize: 10,
          height: 1.1,
          fontWeight: FontWeight.w800,
          letterSpacing: 1,
          shadows: [
            Shadow(
              color: Color(0x88030A06),
              blurRadius: 4,
              offset: Offset(0, 1),
            ),
          ],
        ),
      ),
    ),
  );
}

class _EngineSchematic extends StatelessWidget {
  const _EngineSchematic();

  @override
  Widget build(BuildContext context) => Material(
    elevation: 8,
    shadowColor: const Color(0xCC010503),
    borderRadius: BorderRadius.circular(6),
    child: Container(
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xFF668174), Color(0xFF253F32), Color(0xFF15291F)],
        ),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(
          color: const Color(0xFFC2DBCA).withValues(alpha: .76),
        ),
      ),
      child: const Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.settings_input_component_rounded,
            size: 11,
            color: Color(0xFFCFE2D3),
          ),
          SizedBox(width: 3),
          Text(
            '发动机',
            style: TextStyle(
              color: Color(0xFFE2EFE5),
              fontSize: 8,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    ),
  );
}

class _SeatTile extends StatelessWidget {
  const _SeatTile({
    required this.seat,
    required this.selected,
    required this.onTap,
  });
  final Map<String, dynamic> seat;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final status = '${seat['status']}';
    final available = status == 'available';
    final premium = seat['isPremium'] == true;
    final statusLabel = selected ? '已选' : _seatStatus(status);
    final color = selected
        ? const Color(0xFFBCEB75)
        : status == 'sold'
        ? const Color(0xFF475553)
        : status == 'locked'
        ? const Color(0xFF5A5D58)
        : status == 'blocked'
        ? const Color(0xFF514B48)
        : premium
        ? const Color(0xFF262B2B)
        : const Color(0xFFC4C8BF);
    final outline = selected
        ? const Color(0xFFD6F69A)
        : premium
        ? const Color(0xFFF0BE61)
        : const Color(0xFFE9ECE5).withValues(alpha: .88);
    return Semantics(
      key: ValueKey('seat-${seat['number']}'),
      button: available,
      label:
          '钓位 ${seat['number']}，$statusLabel${premium ? '，船尾加价位，每位${_money(_number(seat['priceFen']))}' : ''}',
      child: Material(
        color: Colors.transparent,
        elevation: selected ? 9 : 6,
        shadowColor: const Color(0xD9001518),
        borderRadius: BorderRadius.circular(10),
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Positioned.fill(
              child: InkWell(
                onTap: available ? onTap : null,
                borderRadius: BorderRadius.circular(10),
                child: Ink(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: selected
                          ? const [
                              Color(0xFFE7F8AD),
                              Color(0xFFB9E54D),
                              Color(0xFF8DB52F),
                            ]
                          : [
                              Color.lerp(color, Colors.white, .20)!,
                              color,
                              Color.lerp(color, Colors.black, .24)!,
                            ],
                    ),
                    border: Border.all(
                      color: outline,
                      width: selected ? 1.8 : 1.15,
                    ),
                    borderRadius: BorderRadius.circular(10),
                    boxShadow: [
                      BoxShadow(
                        color: const Color(
                          0xFFE6EEE5,
                        ).withValues(alpha: selected ? .22 : .12),
                        offset: const Offset(-1, -1),
                        blurRadius: 2,
                      ),
                    ],
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        '${seat['number']}',
                        style: TextStyle(
                          fontSize: 18,
                          height: 1,
                          fontWeight: FontWeight.w900,
                          color: selected
                              ? const Color(0xFF172316)
                              : status == 'available' && !premium
                              ? const Color(0xFF182322)
                              : FishingTokens.ink,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            _seatStatusIcon(status, selected),
                            size: 10,
                            color: selected
                                ? const Color(0xFF26331F)
                                : status == 'available' && !premium
                                ? const Color(0xFF354340)
                                : const Color(0xFFDCE5E1),
                          ),
                          const SizedBox(width: 2),
                          Text(
                            statusLabel,
                            style: TextStyle(
                              fontSize: 8,
                              height: 1,
                              fontWeight: FontWeight.w800,
                              color: selected
                                  ? const Color(0xFF26331F)
                                  : status == 'available' && !premium
                                  ? const Color(0xFF354340)
                                  : const Color(0xFFE0EAE1),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
            if (premium)
              Positioned(
                right: -4,
                top: -5,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [Color(0xFFFFD77A), Color(0xFFD99A31)],
                    ),
                    shape: BoxShape.circle,
                    border: Border.all(color: const Color(0xFFFFE6AA)),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0xA8001113),
                        blurRadius: 3,
                        offset: Offset(1, 2),
                      ),
                    ],
                  ),
                  child: const Padding(
                    padding: EdgeInsets.all(2),
                    child: Icon(
                      Icons.star_rounded,
                      color: Color(0xFF342712),
                      size: 11,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

IconData _seatStatusIcon(String status, bool selected) => selected
    ? Icons.check_circle_rounded
    : status == 'sold'
    ? Icons.person_off_outlined
    : status == 'locked' || status == 'held-by-me'
    ? Icons.lock_outline_rounded
    : status == 'blocked'
    ? Icons.block_outlined
    : Icons.radio_button_unchecked_rounded;

class _SelectedSeatBadge extends StatelessWidget {
  const _SelectedSeatBadge({required this.seats, required this.selectedIds});
  final List<Map<String, dynamic>> seats;
  final Set<String> selectedIds;

  @override
  Widget build(BuildContext context) {
    final selected = seats
        .where((seat) => selectedIds.contains('${seat['id']}'))
        .toList();
    final containsPremium = selected.any((seat) => seat['isPremium'] == true);
    final label = selected.isEmpty
        ? '—'
        : selected.length == 1
        ? selected.single['number'].toString()
        : selected.length.toString();
    return SizedBox(
      width: 52,
      height: 60,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: selected.isEmpty
                    ? const LinearGradient(
                        colors: [Color(0xFF687A73), Color(0xFF354742)],
                      )
                    : const LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [
                          Color(0xFFE5F8AC),
                          Color(0xFFB7E34F),
                          Color(0xFF81A82B),
                        ],
                      ),
                borderRadius: BorderRadius.circular(11),
                border: Border.all(color: const Color(0xFFDDF89A), width: 1.5),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x99000C0E),
                    blurRadius: 6,
                    offset: Offset(0, 4),
                  ),
                ],
              ),
              child: Center(
                child: Text(
                  label,
                  style: const TextStyle(
                    color: Color(0xFF14251B),
                    fontSize: 24,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ),
          ),
          if (containsPremium)
            const Positioned(
              right: -4,
              top: -5,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: Color(0xFFE8AD43),
                  shape: BoxShape.circle,
                  border: Border.fromBorderSide(
                    BorderSide(color: Color(0xFFFFE7AA), width: 1.2),
                  ),
                ),
                child: Padding(
                  padding: EdgeInsets.all(2),
                  child: Icon(
                    Icons.star_rounded,
                    color: Color(0xFF382912),
                    size: 12,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _SeatLegend extends StatelessWidget {
  const _SeatLegend();

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: const Color(0xFF082D30).withValues(alpha: .88),
      borderRadius: BorderRadius.circular(18),
      border: Border.all(color: const Color(0xFF8EB8B0).withValues(alpha: .36)),
    ),
    child: const Padding(
      padding: EdgeInsets.symmetric(horizontal: 11, vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          _LegendItem(icon: Icons.radio_button_unchecked_rounded, label: '可选'),
          _LegendItem(icon: Icons.person_off_outlined, label: '已售'),
          _LegendItem(icon: Icons.lock_outline_rounded, label: '已锁'),
          _LegendItem(icon: Icons.check_circle_outline_rounded, label: '已选'),
          _LegendItem(icon: Icons.star_rounded, label: '加价'),
        ],
      ),
    ),
  );
}

class _LegendItem extends StatelessWidget {
  const _LegendItem({required this.icon, required this.label});
  final IconData icon;
  final String label;
  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(
        icon,
        color: label == '加价'
            ? const Color(0xFFFFC66D)
            : const Color(0xFFD4E1DD),
        size: 13,
      ),
      const SizedBox(width: 3),
      Text(
        label,
        style: const TextStyle(
          color: FishingTokens.secondary,
          fontSize: 10,
          height: 1,
        ),
      ),
    ],
  );
}

class _OrderCard extends StatelessWidget {
  const _OrderCard({required this.item, required this.onTap});
  final Map<String, dynamic> item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: _Panel(
      child: InkWell(
        onTap: onTap,
        child: Row(
          children: [
            const CircleAvatar(
              backgroundColor: FishingTokens.surfaceTint,
              child: Icon(
                Icons.directions_boat_outlined,
                color: FishingTokens.brand,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${item['boatName'] ?? '海上班次'}', style: _sectionStyle),
                  Text(
                    '${item['departureAt'] ?? ''} · ${item['seatCount']} 位',
                    style: _noteStyle,
                  ),
                  Text('${item['orderNumber']}', style: _noteStyle),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(_money(_number(item['totalFen'])), style: _priceStyle),
                Text(_orderStatus('${item['status']}'), style: _noteStyle),
              ],
            ),
          ],
        ),
      ),
    ),
  );
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({
    required this.label,
    required this.value,
    this.highlight = false,
  });
  final String label;
  final String value;
  final bool highlight;
  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      SizedBox(width: 96, child: Text(label, style: _noteStyle)),
      Expanded(
        child: Text(
          value,
          style: TextStyle(
            color: highlight ? FishingTokens.brand : FishingTokens.ink,
            fontWeight: highlight ? FontWeight.w800 : FontWeight.w500,
          ),
        ),
      ),
    ],
  );
}

class _Panel extends StatelessWidget {
  const _Panel({required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: FishingTokens.surface,
      border: Border.all(color: FishingTokens.line),
      borderRadius: BorderRadius.circular(18),
    ),
    child: child,
  );
}

class _ErrorCard extends StatelessWidget {
  const _ErrorCard({required this.message, this.onRetry});
  final String message;
  final VoidCallback? onRetry;
  @override
  Widget build(BuildContext context) => _Panel(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(message, style: const TextStyle(color: Color(0xFFE3A39A))),
        if (onRetry != null)
          TextButton(onPressed: onRetry, child: const Text('重试')),
      ],
    ),
  );
}

class _Step3Message extends StatelessWidget {
  const _Step3Message({
    required this.title,
    required this.body,
    this.action,
    this.onAction,
  });
  final String title;
  final String body;
  final String? action;
  final VoidCallback? onAction;
  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.sailing_outlined,
            color: FishingTokens.secondary,
            size: 40,
          ),
          const SizedBox(height: 10),
          Text(title, style: _sectionStyle),
          const SizedBox(height: 4),
          Text(body, style: _bodyStyle, textAlign: TextAlign.center),
          if (action != null)
            TextButton(onPressed: onAction, child: Text(action!)),
        ],
      ),
    ),
  );
}

class _OutcomeButton extends StatelessWidget {
  const _OutcomeButton({
    required this.label,
    required this.icon,
    required this.onPressed,
  });
  final String label;
  final IconData icon;
  final VoidCallback? onPressed;
  @override
  Widget build(BuildContext context) => FilledButton.icon(
    onPressed: onPressed,
    icon: Icon(icon),
    label: Text(label),
  );
}

class _Eyebrow extends StatelessWidget {
  const _Eyebrow(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Text(
    text,
    style: const TextStyle(
      color: FishingTokens.brand,
      fontSize: 11,
      letterSpacing: 1.2,
      fontWeight: FontWeight.w800,
    ),
  );
}

const _titleStyle = TextStyle(
  color: FishingTokens.ink,
  fontSize: 25,
  fontWeight: FontWeight.w900,
);
const _sectionStyle = TextStyle(
  color: FishingTokens.ink,
  fontSize: 15,
  fontWeight: FontWeight.w800,
);
const _priceStyle = TextStyle(
  color: FishingTokens.brand,
  fontSize: 22,
  fontWeight: FontWeight.w900,
);
const _bodyStyle = TextStyle(
  color: FishingTokens.secondary,
  fontSize: 13,
  height: 1.5,
);
const _noteStyle = TextStyle(
  color: FishingTokens.muted,
  fontSize: 11,
  height: 1.45,
);

List<Map<String, dynamic>> _maps(dynamic value) => value is List
    ? value
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList()
    : <Map<String, dynamic>>[];

Map<String, dynamic> _map(dynamic value) =>
    value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};

int _number(dynamic value) =>
    value is num ? value.toInt() : int.tryParse('$value') ?? 0;

String _money(int fen) => '¥${(fen / 100).toStringAsFixed(2)}';

String _selectedSeatSummary(
  List<Map<String, dynamic>> seats,
  Set<String> selectedIds,
) {
  final selectedSeats =
      seats.where((seat) => selectedIds.contains('${seat['id']}')).toList()
        ..sort(
          (left, right) =>
              _number(left['number']).compareTo(_number(right['number'])),
        );
  if (selectedSeats.isEmpty) return '请选择座位';
  if (selectedSeats.length == 1) {
    final seat = selectedSeats.single;
    final side = seat['side'] == 'port' ? '左舷' : '右舷';
    final section = switch ('${seat['section']}') {
      'bow' => '船头',
      'mid' => '中段',
      'stern' => '船尾',
      _ => '位置待核对',
    };
    return '${_number(seat['number'])}号位（$side · $section）';
  }
  final numbers = selectedSeats.map((seat) => _number(seat['number']));
  return '${numbers.join('、')}号位 · ${selectedSeats.length}个';
}

String _passengerLabel(
  List<Map<String, dynamic>> passengers,
  Map<String, dynamic> seat,
) {
  final seatNumber = _number(seat['number']);
  for (final passenger in passengers) {
    if (_number(passenger['seatNumber']) == seatNumber) {
      return '${passenger['name']} · ${passenger['identityNumber']}';
    }
  }
  return '待填写';
}

String _seatStatus(String status) => switch (status) {
  'locked' => '已锁定',
  'held-by-me' => '我已锁定',
  'sold' => '已售',
  'blocked' => '不可用',
  _ => '可选',
};

String _orderStatus(String status) => switch (status) {
  'paid' => '已支付',
  'cancelled' => '已取消',
  'refunded' => '已退款',
  'completed' => '已完成',
  _ => '待支付',
};

String _insuranceStatus(String status) => switch (status) {
  'checkout_started' => '已生成沙盒投保入口，等待模拟保险机构回传。',
  'issued' => '已收到沙盒投保成功回传。',
  'failed' => '沙盒投保未完成。',
  _ => '尚未开始；请通过持牌保险机构入口独立投保。',
};

String _passengerInsuranceStatus(String status, String? failureReason) =>
    switch (status) {
      'effective' => '保险机构回查已核实生效',
      'pending_verification' => '等待保险机构核实，暂不能登船',
      'failed' => '未生效 · ${_insuranceFailureReason(failureReason)}',
      _ => '尚未投保，暂不能登船',
    };

String _insuranceFailureReason(String? reason) => switch (reason) {
  'platform_supplier_fault' => '平台或供应商故障',
  'data_error' => '资料有误',
  'insurer_rejected' => '保险机构拒保',
  'payment_failed' => '保费支付失败',
  _ => '失败原因待核实',
};

String _newIdempotencyKey() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  return 'app-${bytes.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join()}';
}
