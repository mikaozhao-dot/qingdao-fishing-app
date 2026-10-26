import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';

import 'api_client.dart';
import 'fishing_tokens.dart';

String? promotionVisitorTokenFromUri(Uri uri) {
  if (uri.scheme != 'yuediaozhe' || uri.host != 'promotion') return null;
  final token = uri.queryParameters['ref'];
  if (token == null || token.length > 100) return null;
  final parts = token.split('.');
  if (parts.length != 2 ||
      !RegExp(r'^[A-Za-z0-9_-]{32}$').hasMatch(parts[0]) ||
      !RegExp(r'^[A-Za-z0-9_-]{43}$').hasMatch(parts[1])) {
    return null;
  }
  return token;
}

List<Map<String, dynamic>> _maps(dynamic value) => value is List
    ? value
          .whereType<Map>()
          .map((entry) => Map<String, dynamic>.from(entry))
          .toList()
    : <Map<String, dynamic>>[];

Map<String, dynamic> _map(dynamic value) =>
    value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};

String _channelLabel(String channel) => switch (channel) {
  'member' => '会员',
  'captain' => '船长',
  'creator' => '达人',
  'hotel' => '酒店 / 民宿',
  'travel_agency' => '旅行社',
  'marina' => '码头渠道',
  _ => '推广渠道',
};

String _commissionStatus(String status) => switch (status) {
  'frozen' => '冻结中 · 行程未完成',
  'pending_unlock' => '待解冻',
  'available' => '可申请',
  'withdrawal_pending' => '提现审核中',
  'paid' => '已标记打款',
  'reversed' => '已回滚',
  _ => status,
};

String _attributionStatus(String status) => switch (status) {
  'pending' => '待完成实名与首单',
  'qualified' => '有效会员',
  'self_referral' => '自推排除',
  'existing_buyer' => '已有成交记录',
  'refunded' => '退款后无佣金',
  _ => status,
};

String _yuan(dynamic fen) => '¥${(num.tryParse('$fen') ?? 0) / 100.0}'
    .replaceFirst(RegExp(r'\.0$'), '')
    .replaceFirst(RegExp(r'(\.\d)0$'), r'$1');

class PromotionCenterPage extends StatefulWidget {
  const PromotionCenterPage({
    required this.token,
    this.onRequireLogin,
    super.key,
  });

  final String? token;
  final VoidCallback? onRequireLogin;

  @override
  State<PromotionCenterPage> createState() => _PromotionCenterPageState();
}

class _PromotionCenterPageState extends State<PromotionCenterPage> {
  Map<String, dynamic> _dashboard = {};
  bool _loading = true;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant PromotionCenterPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.token != widget.token) _load();
  }

  Future<void> _load() async {
    if (widget.token == null) {
      setState(() {
        _dashboard = {};
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
      final result = await Step1Api.get('/promotions/me', token: widget.token);
      if (!mounted) return;
      setState(() => _dashboard = result);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _requestCode(String channel) async {
    if (widget.token == null || _busy) return;
    setState(() => _busy = true);
    try {
      final result = await Step1Api.post('/promotions/codes', {
        'channel': channel,
      }, token: widget.token);
      final code = _map(result['code']);
      if (mounted) {
        final status = code['status'] == 'pending'
            ? '已提交审核，审核通过后可生成海报'
            : '推广码已准备好';
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(status)));
      }
      await _load();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error.toString().replaceFirst('Exception: ', '')),
        ),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _requestPayout() async {
    if (widget.token == null || _busy) return;
    final available = _maps(_dashboard['commissions'])
        .where((item) => item['status'] == 'available')
        .map((item) => item['id'].toString())
        .toList();
    if (available.isEmpty) return;
    setState(() => _busy = true);
    try {
      await Step1Api.post('/promotions/payout-requests', {
        'commissionLedgerIds': available,
      }, token: widget.token);
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('沙盒提现申请已提交')));
      }
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error.toString().replaceFirst('Exception: ', '')),
        ),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final totals = _map(_dashboard['totals']);
    final codes = _maps(_dashboard['codes']);
    final commissions = _maps(_dashboard['commissions']);
    final attributions = _maps(_dashboard['attributions']);
    final payouts = _maps(_dashboard['payouts']);
    final availableLedgers = commissions
        .where((item) => item['status'] == 'available')
        .toList();

    return Scaffold(
      appBar: AppBar(title: const Text('推广中心')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : widget.token == null
          ? _LoginPrompt(onTap: widget.onRequireLogin)
          : _error != null
          ? _ErrorPrompt(message: _error!, onRetry: _load)
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
                children: [
                  const _IntroCard(),
                  const SizedBox(height: 16),
                  _TotalsCard(totals: totals),
                  const SizedBox(height: 24),
                  _SectionHeading(
                    title: '我的推广码',
                    trailing: TextButton.icon(
                      onPressed: _busy ? null : () => _requestCode('creator'),
                      icon: const Icon(Icons.add, size: 18),
                      label: const Text('申请达人码'),
                    ),
                  ),
                  if (codes.isEmpty)
                    const _EmptyCard(text: '登录后会自动生成会员推广码。')
                  else
                    ...codes.map((code) => _PromotionCodeCard(code: code)),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      _ChannelChip(
                        label: '船长码',
                        onTap: () => _requestCode('captain'),
                        busy: _busy,
                      ),
                      _ChannelChip(
                        label: '酒店 / 民宿码',
                        onTap: () => _requestCode('hotel'),
                        busy: _busy,
                      ),
                      _ChannelChip(
                        label: '旅行社码',
                        onTap: () => _requestCode('travel_agency'),
                        busy: _busy,
                      ),
                    ],
                  ),
                  const SizedBox(height: 24),
                  _SectionHeading(
                    title: '归因明细',
                    trailing: Text('${attributions.length} 条'),
                  ),
                  if (attributions.isEmpty)
                    const _EmptyCard(text: '扫码记录会在被推广人完成注册后出现在这里。')
                  else
                    ...attributions.map((item) => _AttributionTile(item: item)),
                  const SizedBox(height: 24),
                  _SectionHeading(
                    title: '佣金明细',
                    trailing: TextButton(
                      onPressed: availableLedgers.isEmpty || _busy
                          ? null
                          : _requestPayout,
                      child: Text(
                        availableLedgers.isEmpty ? '暂无可申请' : '申请沙盒提现',
                      ),
                    ),
                  ),
                  if (commissions.isEmpty)
                    const _EmptyCard(text: '完成实名、首单支付并返航后，符合条件的佣金会显示在这里。')
                  else
                    ...commissions.map((item) => _CommissionTile(item: item)),
                  const SizedBox(height: 24),
                  const _SectionHeading(title: '提现记录', trailing: Text('沙盒状态')),
                  if (payouts.isEmpty)
                    const _EmptyCard(text: '提现申请只在沙盒内流转，不会触发真实打款。')
                  else
                    ...payouts.map((item) => _PayoutTile(item: item)),
                  const SizedBox(height: 20),
                  const Text(
                    '推广佣金为净票款的 5%。行程返航完成后进入 7 天解冻期；退款与资格按服务端记录计算。提现仅作沙盒演示。',
                    style: TextStyle(
                      color: FishingTokens.muted,
                      fontSize: 12,
                      height: 1.6,
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

class _IntroCard extends StatelessWidget {
  const _IntroCard();

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      borderRadius: BorderRadius.circular(22),
      gradient: const LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [Color(0xFF233A2B), Color(0xFF10241B), Color(0xFF13291D)],
      ),
      border: Border.all(color: FishingTokens.line),
      boxShadow: const [
        BoxShadow(
          color: Color(0x44000000),
          blurRadius: 24,
          offset: Offset(0, 12),
        ),
      ],
    ),
    child: const Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '约上同好，一起海钓。',
          style: TextStyle(
            color: FishingTokens.brand,
            fontSize: 12,
            letterSpacing: 1.2,
          ),
        ),
        SizedBox(height: 9),
        Text(
          '把下一次出海，分享给朋友',
          style: TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.w800,
            height: 1.3,
          ),
        ),
        SizedBox(height: 8),
        Text(
          '首单沙盒支付成功并完成实名，才进入推广资格核验。',
          style: TextStyle(color: FishingTokens.secondary, height: 1.5),
        ),
      ],
    ),
  );
}

class _TotalsCard extends StatelessWidget {
  const _TotalsCard({required this.totals});

  final Map<String, dynamic> totals;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: FishingTokens.surface,
      border: Border.all(color: FishingTokens.line),
      borderRadius: BorderRadius.circular(20),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          '推广收益',
          style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
        ),
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(
              child: _Metric(label: '累计佣金', value: _yuan(totals['total_fen'])),
            ),
            Expanded(
              child: _Metric(
                label: '可申请',
                value: _yuan(totals['available_fen']),
                highlight: true,
              ),
            ),
          ],
        ),
        const SizedBox(height: 14),
        Row(
          children: [
            Expanded(
              child: _Metric(
                label: '冻结 / 待解冻',
                value: _yuan(totals['frozen_fen']),
              ),
            ),
            Expanded(
              child: _Metric(label: '已标记打款', value: _yuan(totals['paid_fen'])),
            ),
          ],
        ),
        if ((totals['refund_exception_count'] as num? ?? 0) > 0) ...[
          const SizedBox(height: 12),
          Text(
            '有 ${totals['refund_exception_count']} 笔解冻后退款记录待核对',
            style: const TextStyle(color: Color(0xFFF0C37B), fontSize: 12),
          ),
        ],
      ],
    ),
  );
}

class _Metric extends StatelessWidget {
  const _Metric({
    required this.label,
    required this.value,
    this.highlight = false,
  });
  final String label;
  final String value;
  final bool highlight;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        label,
        style: const TextStyle(color: FishingTokens.secondary, fontSize: 11),
      ),
      const SizedBox(height: 6),
      Text(
        value,
        style: TextStyle(
          color: highlight ? FishingTokens.brand : FishingTokens.ink,
          fontSize: 16,
          fontWeight: FontWeight.w800,
        ),
      ),
    ],
  );
}

class _SectionHeading extends StatelessWidget {
  const _SectionHeading({required this.title, required this.trailing});
  final String title;
  final Widget trailing;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Row(
      children: [
        Expanded(
          child: Text(
            title,
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
          ),
        ),
        DefaultTextStyle.merge(
          style: const TextStyle(color: FishingTokens.secondary, fontSize: 12),
          child: trailing,
        ),
      ],
    ),
  );
}

class _PromotionCodeCard extends StatefulWidget {
  const _PromotionCodeCard({required this.code});
  final Map<String, dynamic> code;

  @override
  State<_PromotionCodeCard> createState() => _PromotionCodeCardState();
}

class _PromotionCodeCardState extends State<_PromotionCodeCard> {
  final GlobalKey _posterKey = GlobalKey();
  bool _sharing = false;

  Future<void> _sharePoster() async {
    final url = widget.code['landingUrl']?.toString();
    if (url == null || _sharing) return;
    setState(() => _sharing = true);
    try {
      await WidgetsBinding.instance.endOfFrame;
      final renderObject = _posterKey.currentContext?.findRenderObject();
      if (renderObject is! RenderRepaintBoundary) throw Exception('海报还在准备，请重试');
      final image = await renderObject.toImage(pixelRatio: 3);
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      image.dispose();
      if (bytes == null) throw Exception('海报生成失败');
      if (!mounted) return;
      final fileName = '约钓者-${widget.code['channel']}-推广海报.png';
      final box = context.findRenderObject() as RenderBox?;
      await SharePlus.instance.share(
        ShareParams(
          title: '约钓者推广海报',
          files: [
            XFile.fromData(
              Uint8List.view(
                bytes.buffer,
                bytes.offsetInBytes,
                bytes.lengthInBytes,
              ),
              mimeType: 'image/png',
              name: fileName,
            ),
          ],
          fileNameOverrides: [fileName],
          sharePositionOrigin: box == null
              ? null
              : box.localToGlobal(Offset.zero) & box.size,
        ),
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(error.toString().replaceFirst('Exception: ', '')),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _sharing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = widget.code['status']?.toString() ?? 'pending';
    final active = status == 'active';
    final url = widget.code['landingUrl']?.toString();
    final channel = widget.code['channel']?.toString() ?? '';
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    _channelLabel(channel),
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                _StatusPill(
                  label: active
                      ? '已启用'
                      : status == 'pending'
                      ? '待审核'
                      : '未启用',
                  positive: active,
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              widget.code['code']?.toString() ?? '',
              style: const TextStyle(
                color: FishingTokens.brand,
                fontSize: 18,
                letterSpacing: 1.6,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              '扫码 ${widget.code['scanCount'] ?? 0}  ·  归因 ${widget.code['attributionCount'] ?? 0}  ·  有效会员 ${widget.code['validMemberCount'] ?? 0}',
              style: const TextStyle(
                color: FishingTokens.secondary,
                fontSize: 12,
              ),
            ),
            if (!active && channel != 'member')
              const Padding(
                padding: EdgeInsets.only(top: 10),
                child: Text(
                  '渠道码审核通过后才会开放扫码归因。',
                  style: TextStyle(color: FishingTokens.muted, fontSize: 12),
                ),
              ),
            if (active && url != null) ...[
              const SizedBox(height: 14),
              Center(
                child: RepaintBoundary(
                  key: _posterKey,
                  child: _PromotionPoster(code: widget.code, url: url),
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: _sharing ? null : _sharePoster,
                  icon: const Icon(Icons.ios_share, size: 18),
                  label: Text(_sharing ? '海报生成中…' : '保存 / 分享海报'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _PromotionPoster extends StatelessWidget {
  const _PromotionPoster({required this.code, required this.url});
  final Map<String, dynamic> code;
  final String url;

  @override
  Widget build(BuildContext context) => Container(
    width: 280,
    padding: const EdgeInsets.all(18),
    decoration: BoxDecoration(
      borderRadius: BorderRadius.circular(24),
      gradient: const LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [Color(0xFF263D2D), Color(0xFF091912), Color(0xFF13271D)],
      ),
      border: Border.all(color: const Color(0xFF59734D)),
      boxShadow: const [
        BoxShadow(
          color: Color(0x66000000),
          blurRadius: 22,
          offset: Offset(0, 12),
        ),
      ],
    ),
    child: Column(
      children: [
        const Text(
          '约钓者',
          style: TextStyle(
            color: FishingTokens.brand,
            fontSize: 13,
            letterSpacing: 3,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 16),
        const Text(
          '约上同好，一起海钓。',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w800,
            height: 1.3,
          ),
        ),
        const SizedBox(height: 7),
        const Text(
          '从这里开始你的下一次出海',
          textAlign: TextAlign.center,
          style: TextStyle(color: FishingTokens.secondary, fontSize: 12),
        ),
        const SizedBox(height: 17),
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
          ),
          child: QrImageView(
            data: url,
            size: 142,
            backgroundColor: Colors.white,
            errorCorrectionLevel: QrErrorCorrectLevel.M,
          ),
        ),
        const SizedBox(height: 13),
        Text(
          '${_channelLabel(code['channel']?.toString() ?? '')}专属码',
          style: const TextStyle(color: FishingTokens.brand, fontSize: 12),
        ),
        const SizedBox(height: 5),
        Text(
          code['code']?.toString() ?? '',
          style: const TextStyle(
            letterSpacing: 2,
            fontSize: 13,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 10),
        const Text(
          '实名并完成首单沙盒支付后，系统核验推广资格。',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: FishingTokens.muted,
            fontSize: 10,
            height: 1.5,
          ),
        ),
      ],
    ),
  );
}

class _AttributionTile extends StatelessWidget {
  const _AttributionTile({required this.item});
  final Map<String, dynamic> item;

  @override
  Widget build(BuildContext context) => _DetailCard(
    icon: Icons.person_add_alt_1_outlined,
    title: _attributionStatus(item['status']?.toString() ?? ''),
    subtitle:
        '${item['promotionCode'] ?? ''} · ${_channelLabel(item['sourceChannel']?.toString() ?? '')}',
    trailing: item['orderNumber']?.toString() ?? '',
  );
}

class _CommissionTile extends StatelessWidget {
  const _CommissionTile({required this.item});
  final Map<String, dynamic> item;

  @override
  Widget build(BuildContext context) => _DetailCard(
    icon: Icons.savings_outlined,
    title:
        '${_yuan(item['amountFen'])}  ·  ${_commissionStatus(item['status']?.toString() ?? '')}',
    subtitle:
        '订单 ${item['orderNumber'] ?? '—'} · 净票款 ${_yuan(item['netTicketAmountFen'])}',
    trailing: item['releaseAt'] == null
        ? ''
        : '预计 ${_shortDate(item['releaseAt'])}',
    warning: item['refundAfterRelease'] == true,
  );
}

class _PayoutTile extends StatelessWidget {
  const _PayoutTile({required this.item});
  final Map<String, dynamic> item;

  @override
  Widget build(BuildContext context) => _DetailCard(
    icon: Icons.account_balance_wallet_outlined,
    title:
        '${_yuan(item['amountFen'])}  ·  ${_payoutStatus(item['status']?.toString() ?? '')}',
    subtitle: '沙盒提现申请',
    trailing: _shortDate(item['createdAt']),
  );
}

String _payoutStatus(String status) => switch (status) {
  'requested' => '待审核',
  'approved' => '审核通过',
  'paid_marked' => '已标记打款',
  'rejected' => '已驳回',
  _ => status,
};

String _shortDate(dynamic value) {
  final date = DateTime.tryParse('$value')?.toLocal();
  if (date == null) return '';
  return '${date.month}/${date.day}';
}

class _DetailCard extends StatelessWidget {
  const _DetailCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.trailing,
    this.warning = false,
  });
  final IconData icon;
  final String title;
  final String subtitle;
  final String trailing;
  final bool warning;

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 8),
    padding: const EdgeInsets.all(13),
    decoration: BoxDecoration(
      color: FishingTokens.surface,
      border: Border.all(color: FishingTokens.line),
      borderRadius: BorderRadius.circular(16),
    ),
    child: Row(
      children: [
        Icon(
          icon,
          color: warning ? const Color(0xFFF0C37B) : FishingTokens.brand,
          size: 20,
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                warning ? '$subtitle · 解冻后退款，待核对' : subtitle,
                style: const TextStyle(
                  color: FishingTokens.secondary,
                  fontSize: 11,
                ),
              ),
            ],
          ),
        ),
        if (trailing.isNotEmpty)
          Text(
            trailing,
            style: const TextStyle(color: FishingTokens.muted, fontSize: 10),
          ),
      ],
    ),
  );
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label, required this.positive});
  final String label;
  final bool positive;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
    decoration: BoxDecoration(
      color: positive ? const Color(0x263A5226) : const Color(0x252E3830),
      borderRadius: BorderRadius.circular(99),
    ),
    child: Text(
      label,
      style: TextStyle(
        color: positive ? FishingTokens.brand : FishingTokens.secondary,
        fontSize: 10,
      ),
    ),
  );
}

class _ChannelChip extends StatelessWidget {
  const _ChannelChip({
    required this.label,
    required this.onTap,
    required this.busy,
  });
  final String label;
  final VoidCallback onTap;
  final bool busy;

  @override
  Widget build(BuildContext context) => ActionChip(
    avatar: const Icon(Icons.add_circle_outline, size: 16),
    label: Text(label),
    onPressed: busy ? null : onTap,
    backgroundColor: FishingTokens.deepSurface,
    side: const BorderSide(color: FishingTokens.line),
    labelStyle: const TextStyle(color: FishingTokens.ink, fontSize: 12),
  );
}

class _EmptyCard extends StatelessWidget {
  const _EmptyCard({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(16),
    margin: const EdgeInsets.only(bottom: 8),
    decoration: BoxDecoration(
      color: FishingTokens.surface,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: FishingTokens.line),
    ),
    child: Text(
      text,
      style: const TextStyle(
        color: FishingTokens.secondary,
        fontSize: 12,
        height: 1.5,
      ),
    ),
  );
}

class _LoginPrompt extends StatelessWidget {
  const _LoginPrompt({this.onTap});
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.campaign_outlined,
            color: FishingTokens.brand,
            size: 40,
          ),
          const SizedBox(height: 14),
          const Text(
            '登录后开启推广中心',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          const Text(
            '会员推广码会自动生成，渠道码按要求审核。',
            textAlign: TextAlign.center,
            style: TextStyle(color: FishingTokens.secondary),
          ),
          const SizedBox(height: 18),
          FilledButton(onPressed: onTap, child: const Text('去登录')),
        ],
      ),
    ),
  );
}

class _ErrorPrompt extends StatelessWidget {
  const _ErrorPrompt({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.cloud_off_outlined,
            color: FishingTokens.secondary,
            size: 36,
          ),
          const SizedBox(height: 12),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(color: FishingTokens.secondary),
          ),
          const SizedBox(height: 14),
          OutlinedButton(onPressed: onRetry, child: const Text('重新加载')),
        ],
      ),
    ),
  );
}
