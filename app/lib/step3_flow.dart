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
            !_seatSectionBands.containsKey('$section');
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
    appBar: AppBar(title: const Text('选择座位')),
    body: _loading
        ? const Center(child: CircularProgressIndicator())
        : _error != null
        ? _ErrorCard(message: _error!, onRetry: _load)
        : ListView(
            padding: const EdgeInsets.fromLTRB(18, 8, 18, 20),
            children: [
              const _Eyebrow('SEAT MAP'),
              const SizedBox(height: 8),
              const Text('挑选同行座位', style: _titleStyle),
              const SizedBox(height: 6),
              const Text('最多 6 位 · 锁位成功后保留 10 分钟', style: _bodyStyle),
              const SizedBox(height: 14),
              const _SeatLegend(),
              const SizedBox(height: 12),
              _SeatMap(
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
                        const SnackBar(content: Text('同一订单最多选择 6 个座位')),
                      );
                    }
                  });
                },
              ),
            ],
          ),
    bottomNavigationBar: _loading || _error != null
        ? null
        : SafeArea(
            top: false,
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.fromLTRB(18, 10, 18, 10),
              decoration: const BoxDecoration(
                color: FishingTokens.background,
                border: Border(top: BorderSide(color: FishingTokens.line)),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              _selectedSeatSummary(_seats, _selected),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: _sectionStyle,
                            ),
                            Text(
                              '共 ${_selected.length} 位 · 合计 ${_money(_totalFen)}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: _noteStyle,
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed:
                          _selected.isEmpty ||
                              _submitting ||
                              _layoutError != null
                          ? null
                          : _holdSeats,
                      icon: _submitting
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.lock_clock_outlined),
                      label: Text(
                        _submitting
                            ? '正在锁位…'
                            : '锁定 ${_selected.length} 位 · ${_money(_totalFen)}',
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
                          '钓位 ${seat['number']}${seat['isPremium'] == true ? ' · 尾角位' : ''}',
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
  Widget build(BuildContext context) => _Panel(
    child: layoutError != null
        ? Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('座位位置待核对', style: _sectionStyle),
              const SizedBox(height: 6),
              Text(layoutError!, style: _bodyStyle),
            ],
          )
        : Column(
            children: [
              const Row(
                children: [
                  Expanded(child: Text('左舷 · PORT', style: _noteStyle)),
                  Icon(
                    Icons.arrow_upward_rounded,
                    color: FishingTokens.secondary,
                    size: 14,
                  ),
                  SizedBox(width: 4),
                  Text('船头', style: _noteStyle),
                  Expanded(
                    child: Align(
                      alignment: Alignment.centerRight,
                      child: Text('右舷 · STARBOARD', style: _noteStyle),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              const Text('位置示意 · 非等比例船型图', style: _noteStyle),
              const SizedBox(height: 10),
              LayoutBuilder(
                builder: (context, constraints) {
                  final width = constraints.maxWidth;
                  final tileWidth = min(80.0, max(58.0, width * .225));
                  const tileHeight = 52.0;
                  final mapHeight = _seatMapHeight(seats);
                  final positions = _deriveSeatPositions(seats);
                  return SizedBox(
                    width: width,
                    height: mapHeight,
                    child: Stack(
                      clipBehavior: Clip.none,
                      children: [
                        Positioned.fill(
                          child: CustomPaint(painter: _BoatHullPainter()),
                        ),
                        Positioned(
                          left: width * .355,
                          top: mapHeight * .44,
                          width: width * .29,
                          height: mapHeight * .12,
                          child: const _CabinSchematic(),
                        ),
                        for (final section in _seatSectionBands.keys)
                          Positioned(
                            left: width * .5 - 37,
                            top:
                                mapHeight * _sectionLabelPosition(section) - 11,
                            width: 74,
                            height: 22,
                            child: _SectionLabel(
                              label: _seatSectionLabel(section),
                            ),
                          ),
                        for (final position in positions)
                          Positioned(
                            left: width * position.x - tileWidth / 2,
                            top: mapHeight * position.y - tileHeight / 2,
                            width: tileWidth,
                            height: tileHeight,
                            child: _SeatTile(
                              seat: position.seat,
                              selected: selectedIds.contains(
                                '${position.seat['id']}',
                              ),
                              onTap: () => onTap(position.seat),
                            ),
                          ),
                      ],
                    ),
                  );
                },
              ),
            ],
          ),
  );
}

const _seatSectionBands = <String, (double, double)>{
  'bow': (.04, .31),
  'mid': (.365, .635),
  'stern': (.69, .96),
};

class _SeatPosition {
  const _SeatPosition({required this.seat, required this.x, required this.y});
  final Map<String, dynamic> seat;
  final double x;
  final double y;
}

List<_SeatPosition> _deriveSeatPositions(List<Map<String, dynamic>> seats) {
  final groups = <String, List<Map<String, dynamic>>>{};
  for (final seat in seats) {
    final side = '${seat['side']}';
    final section = '${seat['section']}';
    if ((side != 'port' && side != 'starboard') ||
        !_seatSectionBands.containsKey(section)) {
      continue;
    }
    groups.putIfAbsent('$side:$section', () => []).add(seat);
  }

  final positions = <_SeatPosition>[];
  for (final entry in groups.entries) {
    final parts = entry.key.split(':');
    final side = parts[0];
    final section = parts[1];
    final band = _seatSectionBands[section]!;
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
          x: side == 'port' ? .18 : .82,
          y: band.$1 + (index + .5) * (band.$2 - band.$1) / group.length,
        ),
      );
    }
  }
  return positions;
}

double _seatMapHeight(List<Map<String, dynamic>> seats) {
  final groupCounts = <String, int>{};
  for (final seat in seats) {
    final side = '${seat['side']}';
    final section = '${seat['section']}';
    if ((side != 'port' && side != 'starboard') ||
        !_seatSectionBands.containsKey(section)) {
      continue;
    }
    final key = '$side:$section';
    groupCounts.update(key, (count) => count + 1, ifAbsent: () => 1);
  }
  var requiredHeight = 410.0;
  for (final entry in groupCounts.entries) {
    final section = entry.key.split(':')[1];
    final band = _seatSectionBands[section]!;
    requiredHeight = max(
      requiredHeight,
      60 * entry.value / (band.$2 - band.$1),
    );
  }
  return requiredHeight;
}

double _sectionCenter(String section) {
  final band = _seatSectionBands[section]!;
  return (band.$1 + band.$2) / 2;
}

double _sectionLabelPosition(String section) {
  if (section == 'mid') return _seatSectionBands[section]!.$1;
  return _sectionCenter(section);
}

String _seatSectionLabel(String section) => switch (section) {
  'bow' => '船头',
  'mid' => '过道',
  'stern' => '船尾',
  _ => '',
};

class _BoatHullPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final width = size.width;
    final height = size.height;
    final hull = Path()
      ..moveTo(width * .5, height * .02)
      ..cubicTo(
        width * .76,
        height * .02,
        width * .94,
        height * .065,
        width * .97,
        height * .16,
      )
      ..lineTo(width * .97, height * .88)
      ..quadraticBezierTo(width * .97, height * .98, width * .86, height * .98)
      ..lineTo(width * .14, height * .98)
      ..quadraticBezierTo(width * .03, height * .98, width * .03, height * .88)
      ..lineTo(width * .03, height * .16)
      ..cubicTo(
        width * .06,
        height * .065,
        width * .24,
        height * .02,
        width * .5,
        height * .02,
      )
      ..close();

    canvas.drawPath(
      hull,
      Paint()
        ..color = FishingTokens.surfaceTint.withValues(alpha: .28)
        ..style = PaintingStyle.fill,
    );
    canvas.drawPath(
      hull,
      Paint()
        ..color = FishingTokens.secondary.withValues(alpha: .78)
        ..strokeWidth = 1.6
        ..style = PaintingStyle.stroke,
    );

    final detailPaint = Paint()
      ..color = FishingTokens.line
      ..strokeWidth = 1;
    for (final y in [.3375, .6625]) {
      canvas.drawLine(
        Offset(width * .34, height * y),
        Offset(width * .66, height * y),
        detailPaint,
      );
    }
    for (var y = height * .075; y < height * .94; y += 13) {
      canvas.drawLine(
        Offset(width * .5, y),
        Offset(width * .5, min(y + 5, height * .94)),
        detailPaint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _BoatHullPainter oldDelegate) => false;
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) => Center(
    child: DecoratedBox(
      decoration: BoxDecoration(
        color: FishingTokens.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: FishingTokens.line),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        child: Text(
          label,
          style: const TextStyle(
            color: FishingTokens.secondary,
            fontSize: 9,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    ),
  );
}

class _CabinSchematic extends StatelessWidget {
  const _CabinSchematic();

  @override
  Widget build(BuildContext context) => Semantics(
    label: '中央船舱与通道位置示意，非等比例，不代表真实尺寸与结构',
    child: DecoratedBox(
      decoration: BoxDecoration(
        color: FishingTokens.surface.withValues(alpha: .94),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: FishingTokens.secondary.withValues(alpha: .8),
        ),
      ),
      child: const Center(
        child: Text(
          '船舱\n通道',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: FishingTokens.secondary,
            fontSize: 9,
            height: 1.1,
            fontWeight: FontWeight.w700,
          ),
        ),
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
    final stateIcon = selected
        ? Icons.check_circle
        : status == 'sold'
        ? Icons.person_off_outlined
        : status == 'locked' || status == 'held-by-me'
        ? Icons.lock_outline
        : status == 'blocked'
        ? Icons.block_outlined
        : Icons.radio_button_unchecked;
    final color = selected
        ? FishingTokens.brand
        : status == 'sold'
        ? const Color(0xFF5D6961)
        : status == 'locked'
        ? const Color(0xFF78694E)
        : status == 'blocked'
        ? const Color(0xFF503F3C)
        : FishingTokens.surfaceTint;
    return Semantics(
      button: available,
      label:
          '钓位 ${seat['number']}，$statusLabel${premium ? '，尾角加价位，${_money(_number(seat['priceFen']))}每位' : ''}',
      child: InkWell(
        onTap: available ? onTap : null,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 3),
          decoration: BoxDecoration(
            color: color.withValues(alpha: selected ? .95 : .7),
            border: Border.all(
              color: selected || premium
                  ? FishingTokens.brand
                  : FishingTokens.line,
              width: selected ? 2 : 1,
            ),
            borderRadius: BorderRadius.circular(14),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    '${seat['number']}',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w900,
                      color: selected
                          ? FishingTokens.background
                          : FishingTokens.ink,
                    ),
                  ),
                  if (selected) ...[
                    const SizedBox(width: 2),
                    const Icon(
                      Icons.check_circle,
                      size: 11,
                      color: FishingTokens.background,
                    ),
                  ],
                  if (premium) ...[
                    const SizedBox(width: 2),
                    Icon(
                      Icons.star_rounded,
                      size: 11,
                      color: selected
                          ? FishingTokens.background
                          : FishingTokens.brand,
                    ),
                  ],
                ],
              ),
              FittedBox(
                fit: BoxFit.scaleDown,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      stateIcon,
                      size: 9,
                      color: selected
                          ? FishingTokens.background
                          : FishingTokens.secondary,
                    ),
                    const SizedBox(width: 2),
                    Text(
                      premium ? '加价位 · $statusLabel' : statusLabel,
                      style: TextStyle(
                        fontSize: 8,
                        fontWeight: FontWeight.w700,
                        color: selected
                            ? FishingTokens.background
                            : FishingTokens.secondary,
                      ),
                    ),
                  ],
                ),
              ),
              FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(
                  '${_money(_number(seat['priceFen']))}/位',
                  style: TextStyle(
                    fontSize: 9,
                    fontWeight: FontWeight.w700,
                    color: selected
                        ? FishingTokens.background
                        : FishingTokens.ink,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SeatLegend extends StatelessWidget {
  const _SeatLegend();

  @override
  Widget build(BuildContext context) => const Wrap(
    spacing: 12,
    runSpacing: 8,
    children: [
      _LegendItem(icon: Icons.radio_button_unchecked, label: '可选'),
      _LegendItem(icon: Icons.person_off_outlined, label: '已售'),
      _LegendItem(icon: Icons.lock_outline, label: '已锁'),
      _LegendItem(icon: Icons.check_circle_outline, label: '已选'),
      _LegendItem(icon: Icons.star_outline, label: '尾角加价'),
    ],
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
        color: label == '尾角加价' ? FishingTokens.brand : FishingTokens.secondary,
        size: 13,
      ),
      const SizedBox(width: 5),
      Text(label, style: _noteStyle),
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
  final numbers =
      seats
          .where((seat) => selectedIds.contains('${seat['id']}'))
          .map((seat) => _number(seat['number']))
          .toList()
        ..sort();
  return numbers.isEmpty ? '未选择座位' : '钓位 ${numbers.join('、')}';
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
