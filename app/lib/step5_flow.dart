import 'package:flutter/material.dart';

import 'api_client.dart';
import 'fishing_tokens.dart';
import 'live_status.dart';
import 'step6_certificate_flow.dart';

const _fishNames = <String, String>{
  'yellow_croaker': '小黄鱼',
  'sea_bass': '鲈鱼',
  'blackhead': '黑头（许氏平鲉）',
  'black_seabream': '黑鲷',
  'red_seabream': '真鲷',
  'olive_flounder': '牙鲆',
  'hairtail': '带鱼',
  'spanish_mackerel': '鲅鱼',
  'chub_mackerel': '鲐鱼',
  'cuttlefish': '墨鱼（金乌贼）',
  'octopus': '八带（章鱼）',
  'greenling': '六线鱼',
  'mullet': '梭鱼',
  'needlefish': '针良鱼（鄂针鱼）',
  'conger_eel': '鳗鱼（海鳗）',
  'rockfish': '石九公（褐菖鲉）',
  'yellowtail_amberjack': '黄条鰤',
};

const _captainTagLabels = <String, String>{
  'on_time': '准时守约',
  'clear_guidance': '指引清楚',
  'transparent_fees': '费用清楚',
  'safety_briefing': '安全说明到位',
};
const _boatTagLabels = <String, String>{
  'clean_deck': '甲板整洁',
  'facilities_match': '设施与介绍相符',
  'comfortable_space': '空间舒适',
};

Map<String, dynamic> _map(Object? value) =>
    value is Map<String, dynamic> ? value : <String, dynamic>{};
List<Map<String, dynamic>> _maps(Object? value) => value is List
    ? value.whereType<Map<String, dynamic>>().toList()
    : <Map<String, dynamic>>[];

class Step5CaptainCatchSheet extends StatefulWidget {
  const Step5CaptainCatchSheet({
    required this.departureId,
    required this.token,
    super.key,
  });
  final String departureId;
  final String token;

  @override
  State<Step5CaptainCatchSheet> createState() => _Step5CaptainCatchSheetState();
}

class _Step5CaptainCatchSheetState extends State<Step5CaptainCatchSheet> {
  List<Map<String, dynamic>> _catalog = [];
  final List<Map<String, dynamic>> _items = [];
  bool _zeroCatch = false;
  bool _loading = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final result = await Step1Api.get('/step5/fish-catalog');
      if (!mounted) return;
      setState(() {
        _catalog = _maps(result['items']);
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  void _addItem() {
    final available = _catalog
        .where(
          (fish) => !_items.any((item) => item['fishCode'] == fish['code']),
        )
        .toList();
    if (available.isEmpty) return;
    setState(() {
      _zeroCatch = false;
      _items.add({
        'fishCode': available.first['code'],
        'quantity': 1,
        'totalWeightGrams': null,
        'maxIndividualWeightGrams': null,
        'maxLengthMm': null,
      });
    });
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await Step1Api.post(
        '/step5/departures/${widget.departureId}/captain-catch',
        {
          'outcome': _zeroCatch ? 'zero_catch' : 'caught',
          'items': _zeroCatch ? <Map<String, dynamic>>[] : _items,
        },
        token: widget.token,
      );
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = error.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  @override
  Widget build(BuildContext context) => SafeArea(
    child: Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
      child: _loading
          ? const SizedBox(
              height: 240,
              child: Center(child: CircularProgressIndicator()),
            )
          : ListView(
              shrinkWrap: true,
              children: [
                const Text(
                  '回填本航渔获',
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 6),
                const Text(
                  '提交后保留为船长原始记录，乘客可独立确认或补充。',
                  style: TextStyle(
                    color: FishingTokens.secondary,
                    height: 1.45,
                  ),
                ),
                const SizedBox(height: 14),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  value: _zeroCatch,
                  onChanged: _saving
                      ? null
                      : (value) => setState(() => _zeroCatch = value),
                  title: const Text('本航零渔获'),
                  subtitle: const Text('明确记录空军；未回填会单独显示。'),
                ),
                if (!_zeroCatch) ...[
                  ..._items.asMap().entries.map(
                    (entry) => _CatchItemEditor(
                      key: ValueKey('captain-catch-${entry.key}'),
                      item: entry.value,
                      catalog: _catalog,
                      captain: true,
                      onChanged: (updated) =>
                          setState(() => _items[entry.key] = updated),
                      onRemove: () =>
                          setState(() => _items.removeAt(entry.key)),
                    ),
                  ),
                  OutlinedButton.icon(
                    onPressed: _saving ? null : _addItem,
                    icon: const Icon(Icons.add),
                    label: const Text('添加鱼种'),
                  ),
                ],
                if (_error != null) _Step5Error(_error!),
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: _saving ? null : _save,
                  child: Text(_saving ? '保存中…' : '提交航次记录'),
                ),
              ],
            ),
    ),
  );
}

class _CatchItemEditor extends StatelessWidget {
  const _CatchItemEditor({
    required this.item,
    required this.catalog,
    required this.captain,
    required this.onChanged,
    required this.onRemove,
    super.key,
  });
  final Map<String, dynamic> item;
  final List<Map<String, dynamic>> catalog;
  final bool captain;
  final ValueChanged<Map<String, dynamic>> onChanged;
  final VoidCallback onRemove;

  int? _intValue(String? value) => int.tryParse(value ?? '');

  @override
  Widget build(BuildContext context) {
    final selected = item['fishCode'] as String?;
    final options = catalog;
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    key: ValueKey('fish-$selected'),
                    initialValue: selected,
                    decoration: const InputDecoration(labelText: '鱼种'),
                    items: options
                        .map(
                          (fish) => DropdownMenuItem<String>(
                            value: fish['code'] as String,
                            child: Text(fish['name'] as String),
                          ),
                        )
                        .toList(),
                    onChanged: (value) {
                      if (value != null) {
                        onChanged({...item, 'fishCode': value});
                      }
                    },
                  ),
                ),
                IconButton(
                  onPressed: onRemove,
                  icon: const Icon(Icons.remove_circle_outline),
                ),
              ],
            ),
            TextFormField(
              initialValue: '${item['quantity'] ?? 1}',
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: '数量（尾）'),
              onChanged: (value) =>
                  onChanged({...item, 'quantity': _intValue(value) ?? 0}),
            ),
            if (captain)
              TextFormField(
                initialValue: item['totalWeightGrams']?.toString(),
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: '本鱼种总重（克，可选）'),
                onChanged: (value) =>
                    onChanged({...item, 'totalWeightGrams': _intValue(value)}),
              ),
            TextFormField(
              initialValue: item['maxIndividualWeightGrams']?.toString(),
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: '最大个体重（克，可选）'),
              onChanged: (value) => onChanged({
                ...item,
                'maxIndividualWeightGrams': _intValue(value),
              }),
            ),
            TextFormField(
              initialValue: item['maxLengthMm'] == null
                  ? null
                  : '${(item['maxLengthMm'] as int) / 10}',
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(labelText: '最大个体长度（厘米，可选）'),
              onChanged: (value) {
                final parsed = double.tryParse(value);
                onChanged({
                  ...item,
                  'maxLengthMm': parsed == null ? null : (parsed * 10).round(),
                });
              },
            ),
          ],
        ),
      ),
    );
  }
}

class Step5AnglerReportPage extends StatefulWidget {
  const Step5AnglerReportPage({
    required this.departureId,
    required this.orderId,
    required this.token,
    super.key,
  });
  final String departureId;
  final String orderId;
  final String token;

  @override
  State<Step5AnglerReportPage> createState() => _Step5AnglerReportPageState();
}

class _Step5AnglerReportPageState extends State<Step5AnglerReportPage> {
  Map<String, dynamic> _trip = {};
  List<Map<String, dynamic>> _catalog = [];
  final List<Map<String, dynamic>> _ownItems = [];
  final List<Map<String, dynamic>> _supplementItems = [];
  final Set<String> _captainTags = {};
  final Set<String> _boatTags = {};
  final _reviewController = TextEditingController();
  bool _loading = true;
  bool _saving = false;
  bool _reviewSaved = false;
  bool _reportOwnCatch = false;
  bool _zeroCatch = false;
  String _response = 'none';
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _reviewController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        Step1Api.get(
          '/step5/departures/${widget.departureId}/me',
          token: widget.token,
        ),
        Step1Api.get('/step5/fish-catalog'),
      ]);
      if (!mounted) return;
      final trip = results.first;
      final own = _map(trip['ownReport']);
      setState(() {
        _trip = trip;
        _catalog = _maps(results.last['items']);
        _reviewSaved = trip['review'] != null;
        if (own.isNotEmpty) {
          _reportOwnCatch = true;
          _zeroCatch = own['outcome'] == 'zero_catch';
          _ownItems
            ..clear()
            ..addAll(
              _maps(own['items']).map(
                (item) => {
                  'fishCode': item['fishCode'],
                  'quantity': item['quantity'],
                  'maxIndividualWeightGrams': item['maxIndividualWeightGrams'],
                  'maxLengthMm': item['maxLengthMm'],
                },
              ),
            );
        }
        final response = _map(trip['captainResponse']);
        if (response.isNotEmpty) {
          _response = '${response['action']}';
          _supplementItems
            ..clear()
            ..addAll(
              _maps(response['items']).map(
                (item) => {
                  'fishCode': item['fishCode'],
                  'quantity': item['quantity'],
                  'maxIndividualWeightGrams': item['maxIndividualWeightGrams'],
                  'maxLengthMm': item['maxLengthMm'],
                },
              ),
            );
        }
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  void _addItem(List<Map<String, dynamic>> target) {
    final available = _catalog
        .where((fish) => !target.any((row) => row['fishCode'] == fish['code']))
        .toList();
    if (available.isEmpty) return;
    setState(
      () => target.add({'fishCode': available.first['code'], 'quantity': 1}),
    );
  }

  Future<void> _saveSources() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final payload = <String, dynamic>{};
      final ownReportExists = _map(_trip['ownReport']).isNotEmpty;
      final captainResponseExists = _map(_trip['captainResponse']).isNotEmpty;
      if (_reportOwnCatch && !ownReportExists) {
        payload['catchReport'] = {
          'outcome': _zeroCatch ? 'zero_catch' : 'caught',
          'items': _zeroCatch ? <Map<String, dynamic>>[] : _ownItems,
        };
      }
      if (_response != 'none' && !captainResponseExists) {
        payload['captainResponse'] = {
          'action': _response,
          'items': _response == 'supplement'
              ? _supplementItems
              : <Map<String, dynamic>>[],
        };
      }
      await Step1Api.post(
        '/step5/departures/${widget.departureId}/passenger-catch',
        payload,
        token: widget.token,
      );
      await _load();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = error.toString().replaceFirst('Exception: ', '');
      });
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _saveReview() async {
    if (_reviewSaved) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await Step1Api.post('/step5/orders/${widget.orderId}/review', {
        'captainTags': _captainTags.toList(),
        'boatTags': _boatTags.toList(),
        'body': _reviewController.text.trim(),
      }, token: widget.token);
      if (mounted) {
        setState(() {
          _reviewSaved = true;
          _error = '评价已记录；它只作为事实与原文保存。';
        });
      }
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _itemsEditor(
    List<Map<String, dynamic>> items, {
    required bool captain,
  }) => Column(
    children: [
      ...items.asMap().entries.map(
        (entry) => _CatchItemEditor(
          key: ValueKey(
            'angler-${captain ? 'supplement' : 'own'}-${entry.key}',
          ),
          item: entry.value,
          catalog: _catalog,
          captain: false,
          onChanged: (value) => setState(() => items[entry.key] = value),
          onRemove: () => setState(() => items.removeAt(entry.key)),
        ),
      ),
      OutlinedButton.icon(
        onPressed: _saving ? null : () => _addItem(items),
        icon: const Icon(Icons.add),
        label: const Text('添加鱼种'),
      ),
    ],
  );

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('返港记录与评价'),
      actions: [
        IconButton(
          tooltip: '预览本航渔获证书',
          icon: const Icon(Icons.workspace_premium_outlined),
          onPressed: () => Navigator.of(context).push<void>(
            MaterialPageRoute<void>(
              builder: (_) => Step6CertificatePreviewPage(
                departureId: widget.departureId,
                token: widget.token,
              ),
            ),
          ),
        ),
      ],
    ),
    body: _loading
        ? const Center(child: CircularProgressIndicator())
        : ListView(
            padding: const EdgeInsets.fromLTRB(18, 8, 18, 32),
            children: [
              const Text(
                '本航记录',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 5),
              const Text(
                '船长记录与本人记录分别保留；有分歧时标记待核对，不覆盖原文。',
                style: TextStyle(color: FishingTokens.secondary, height: 1.45),
              ),
              const SizedBox(height: 14),
              _ReportSummary(
                report: _map(_trip['captainReport']),
                title: '船长本航渔获',
              ),
              if (_trip['reconciliation'] != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    '交叉状态：${_reconciliationLabel('${_trip['reconciliation']}')}',
                    style: const TextStyle(
                      color: FishingTokens.brand,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              const SizedBox(height: 10),
              if (_trip['ownReport'] == null) ...[
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  value: _reportOwnCatch,
                  onChanged: (value) => setState(() => _reportOwnCatch = value),
                  title: const Text('填写本人实际渔获'),
                  subtitle: const Text('不填写表示尚未回填；如无渔获请明确选“零渔获”。'),
                ),
                if (_reportOwnCatch) ...[
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    value: _zeroCatch,
                    onChanged: (value) => setState(() => _zeroCatch = value),
                    title: const Text('本人零渔获'),
                  ),
                  if (!_zeroCatch) _itemsEditor(_ownItems, captain: false),
                ],
              ] else
                _ReportSummary(
                  report: _map(_trip['ownReport']),
                  title: '本人已提交记录',
                ),
              if (_trip['captainReport'] != null &&
                  _trip['captainResponse'] == null) ...[
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  initialValue: _response,
                  decoration: const InputDecoration(labelText: '回应船长记录（可选）'),
                  items: const [
                    DropdownMenuItem(value: 'none', child: Text('稍后回应')),
                    DropdownMenuItem(value: 'confirm', child: Text('确认船长记录')),
                    DropdownMenuItem(value: 'dispute', child: Text('有异议，待核对')),
                    DropdownMenuItem(
                      value: 'supplement',
                      child: Text('补充本人看到的渔获'),
                    ),
                  ],
                  onChanged: (value) =>
                      setState(() => _response = value ?? 'none'),
                ),
                if (_response == 'supplement')
                  _itemsEditor(_supplementItems, captain: false),
              ],
              if (_trip['captainResponse'] != null)
                Text(
                  '已提交回应：${_responseLabel('${_map(_trip['captainResponse'])['action']}')}（原回应保留）',
                  style: const TextStyle(color: FishingTokens.secondary),
                ),
              if ((_trip['ownReport'] == null && _reportOwnCatch) ||
                  (_response != 'none' &&
                      _trip['captainResponse'] == null)) ...[
                const SizedBox(height: 8),
                FilledButton(
                  onPressed: _saving ? null : _saveSources,
                  child: Text(_saving ? '提交中…' : '提交渔获与回应'),
                ),
              ],
              const SizedBox(height: 24),
              const Text(
                '返港评价',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 5),
              const Text(
                '分别记录船长服务和船况，不计算星级或综合分。',
                style: TextStyle(color: FishingTokens.secondary),
              ),
              const SizedBox(height: 12),
              _TagPicker(
                title: '船长服务',
                tags: _captainTagLabels,
                selected: _captainTags,
                onChanged: (value) =>
                    setState(() => _captainTags.toggle(value)),
              ),
              const SizedBox(height: 10),
              _TagPicker(
                title: '船况体验',
                tags: _boatTagLabels,
                selected: _boatTags,
                onChanged: (value) => setState(() => _boatTags.toggle(value)),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _reviewController,
                maxLength: 1000,
                maxLines: 4,
                decoration: const InputDecoration(
                  labelText: '补充文字（可选）',
                  border: OutlineInputBorder(),
                ),
              ),
              if (_reviewSaved)
                const Text(
                  '该订单评价已提交，原始评价保留。',
                  style: TextStyle(color: FishingTokens.success),
                )
              else
                FilledButton.tonal(
                  onPressed: _saving ? null : _saveReview,
                  child: Text(_saving ? '保存中…' : '提交返港评价'),
                ),
              if (_error != null) ...[
                const SizedBox(height: 8),
                _Step5Error(_error!),
              ],
            ],
          ),
  );
}

class _TagPicker extends StatelessWidget {
  const _TagPicker({
    required this.title,
    required this.tags,
    required this.selected,
    required this.onChanged,
  });
  final String title;
  final Map<String, String> tags;
  final Set<String> selected;
  final ValueChanged<String> onChanged;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
      const SizedBox(height: 4),
      Wrap(
        spacing: 5,
        children: tags.entries
            .map(
              (entry) => FilterChip(
                label: Text(entry.value),
                selected: selected.contains(entry.key),
                onSelected: (_) => onChanged(entry.key),
              ),
            )
            .toList(),
      ),
    ],
  );
}

class _ReportSummary extends StatelessWidget {
  const _ReportSummary({required this.report, required this.title});
  final Map<String, dynamic> report;
  final String title;
  @override
  Widget build(BuildContext context) {
    if (report.isEmpty) return _Step5Card(title: title, body: '尚未回填');
    final items = _maps(report['items']);
    return _Step5Card(
      title: title,
      body: report['outcome'] == 'zero_catch'
          ? '已明确记录：本航零渔获'
          : items
                .map(
                  (item) =>
                      '${item['fishName'] ?? _fishNames[item['fishCode']]} × ${item['quantity']}',
                )
                .join('、'),
    );
  }
}

String _reconciliationLabel(String value) => switch (value) {
  'confirmed' => '已确认',
  'supplemented' => '已补充',
  'pending_review' => '待核对',
  _ => '等待乘客回应',
};
String _responseLabel(String value) => switch (value) {
  'confirm' => '已确认',
  'dispute' => '有异议',
  'supplement' => '已补充',
  _ => '未回应',
};

class Step5CaptainFactsCard extends StatefulWidget {
  const Step5CaptainFactsCard({this.token, this.captainId, super.key})
    : assert(token != null || captainId != null);
  final String? token;
  final String? captainId;
  @override
  State<Step5CaptainFactsCard> createState() => _Step5CaptainFactsCardState();
}

class _Step5CaptainFactsCardState extends State<Step5CaptainFactsCard> {
  Map<String, dynamic> _facts = {};
  bool _loading = true;
  String? _error;
  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant Step5CaptainFactsCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.token != widget.token) _load();
  }

  Future<void> _load() async {
    try {
      final result = await Step1Api.get(
        widget.token == null
            ? '/step5/captains/${widget.captainId}/facts'
            : '/step5/me/captain-facts',
        token: widget.token,
      );
      if (mounted) {
        setState(() {
          _facts = result;
          _loading = false;
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = error.toString().replaceFirst('Exception: ', '');
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 12),
        child: LinearProgressIndicator(),
      );
    }
    if (_error != null) return _Step5Card(title: '船长事实', body: _error!);
    final catchFacts = _map(_facts['catchReports']);
    final repeat = _map(_facts['repeatBookings']);
    final service = _map(_facts['serviceReviews']);
    final checks = _map(_facts['crossSourceChecks']);
    final activeLive = _map(_facts['activeLive']);
    final liveBadgeFacts = _maps(_facts['liveBadgeFacts']);
    final serviceTags = _maps(service['tagCounts'])
        .map(
          (row) =>
              '${_captainTagLabels['${row['tag']}'] ?? row['tag']} · ${row['count']} 次',
        )
        .join('、');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _Step5Card(
          title: '船长口碑事实 · 最近 12 个月',
          body:
              '累计完成 ${_facts['completedTripCount'] ?? 0} 航次\n'
              '渔获回填 ${catchFacts['reportedTripCount'] ?? 0} 航；未回填 ${catchFacts['missingReportCount'] ?? 0} 航\n'
              '已回填航次零渔获率 ${catchFacts['zeroCatchRatePercent'] == null ? '暂无样本' : '${catchFacts['zeroCatchRatePercent']}%'}\n'
              '复订事实 ${repeat['repeatPassengerCount'] ?? 0}/${repeat['cohortPassengerCount'] ?? 0} 位成熟观察乘客\n'
              '船长服务评价 ${service['sampleCount'] ?? 0} 条${serviceTags.isEmpty ? '' : ' · $serviceTags'}\n'
              '待核对 ${checks['pendingReviewCount'] ?? 0}/${checks['sampleCount'] ?? 0} 条乘客交叉记录',
          footnote:
              '复订率 ${repeat['repeatRatePercent'] == null ? '暂无成熟样本' : '${repeat['repeatRatePercent']}%'}；'
              '渔获、评价和交叉核对按最近 12 个月统计；复订率仅纳入首次完成航次满 90 天的乘客。未回填航次不进入零渔获率分母。',
        ),
        if (activeLive['active'] == true) ...[
          const SizedBox(height: 8),
          LiveStatusLinkButton(profileUrl: activeLive['profileUrl'] as String?),
        ],
        if (liveBadgeFacts.isNotEmpty) ...[
          const SizedBox(height: 10),
          _Step5Card(
            title: '直播标记核实记录',
            body: liveBadgeFacts
                .map(
                  (fact) =>
                      '${fact['date']} · 航次 ${fact['departureId']} · 平台核实直播标记不实',
                )
                .join('\n'),
            footnote: '只展示日期、航次与核实结果；不生成评分或排名。',
          ),
        ],
      ],
    );
  }
}

class Step5BoatFactsPage extends StatefulWidget {
  const Step5BoatFactsPage({required this.boatId, super.key});
  final String boatId;
  @override
  State<Step5BoatFactsPage> createState() => _Step5BoatFactsPageState();
}

class _Step5BoatFactsPageState extends State<Step5BoatFactsPage> {
  Map<String, dynamic> _facts = {};
  bool _loading = true;
  String? _error;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final result = await Step1Api.get('/step5/boats/${widget.boatId}/facts');
      if (mounted) {
        setState(() {
          _facts = result;
          _loading = false;
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = error.toString().replaceFirst('Exception: ', '');
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('船况事实')),
    body: _loading
        ? const Center(child: CircularProgressIndicator())
        : ListView(
            padding: const EdgeInsets.all(18),
            children: [
              if (_error != null) _Step5Card(title: '暂时无法读取', body: _error!),
              if (_error == null) ...[
                _Step5Card(
                  title: '船况与记录核对',
                  body:
                      '近 12 个月返港评价 ${_facts['reviewCount'] ?? 0} 条；'
                      '待核对 ${_map(_facts['crossSourceChecks'])['pendingReviewCount'] ?? 0}/'
                      '${_map(_facts['crossSourceChecks'])['sampleCount'] ?? 0} 条乘客交叉记录。',
                  footnote: '船况事实归船档案；交叉分歧只显示待核对状态，不修改任何一方原始记录。',
                ),
                const SizedBox(height: 10),
                _Step5Card(
                  title: '船况标签',
                  body:
                      (_maps(_facts['conditionTagCounts']).isEmpty
                              ? ['暂无评价样本']
                              : _maps(_facts['conditionTagCounts'])
                                    .map(
                                      (row) =>
                                          '${_boatTagLabels['${row['tag']}'] ?? row['tag']} · ${row['count']} 次',
                                    )
                                    .toList())
                          .join('\n'),
                  footnote: '船况评价按最近 12 个月计样本；船况记录与船长能力分开统计，不做星级和排名。',
                ),
                const SizedBox(height: 12),
                ..._maps(_facts['recentCatchReports']).map(
                  (report) => _ReportSummary(
                    report: report,
                    title: report['outcome'] == 'zero_catch'
                        ? '船长记录 · 零渔获'
                        : '船长渔获记录',
                  ),
                ),
              ],
            ],
          ),
  );
}

class Step5FishAtlasPage extends StatefulWidget {
  const Step5FishAtlasPage({required this.token, super.key});
  final String token;
  @override
  State<Step5FishAtlasPage> createState() => _Step5FishAtlasPageState();
}

class _Step5FishAtlasPageState extends State<Step5FishAtlasPage> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  String? _error;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final result = await Step1Api.get(
        '/step5/me/fish-atlas',
        token: widget.token,
      );
      if (mounted) {
        setState(() {
          _items = _maps(result['items']);
          _loading = false;
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = error.toString().replaceFirst('Exception: ', '');
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('我的鱼种图鉴')),
    body: _loading
        ? const Center(child: CircularProgressIndicator())
        : ListView(
            padding: const EdgeInsets.all(18),
            children: [
              const Text(
                '由本人记录点亮',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 5),
              const Text(
                '本人渔获、本人补充或本人确认的船长记录会点亮；船长单方记录不会计入。',
                style: TextStyle(color: FishingTokens.secondary, height: 1.45),
              ),
              const SizedBox(height: 16),
              if (_error != null) _Step5Card(title: '暂时无法读取', body: _error!),
              if (_error == null && _items.isEmpty)
                const _Step5Card(
                  title: '还没有点亮鱼种',
                  body: '完成一次返港渔获回填后，会在这里展示个人收集。',
                ),
              if (_error == null)
                Wrap(
                  spacing: 9,
                  runSpacing: 9,
                  children: _fishNames.entries.map((fish) {
                    final matches = _items.where(
                      (item) => item['fishCode'] == fish.key,
                    );
                    final caught = matches.isEmpty ? null : matches.first;
                    return Container(
                      width: 155,
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: FishingTokens.surface,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: FishingTokens.line),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(
                            caught == null
                                ? Icons.lock_outline
                                : Icons.phishing_outlined,
                            color: caught == null
                                ? FishingTokens.muted
                                : FishingTokens.brand,
                          ),
                          const SizedBox(height: 8),
                          Text(
                            fish.value,
                            style: const TextStyle(fontWeight: FontWeight.w800),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            caught == null ? '待点亮' : '已记录',
                            style: const TextStyle(
                              fontSize: 11,
                              color: FishingTokens.secondary,
                            ),
                          ),
                        ],
                      ),
                    );
                  }).toList(),
                ),
            ],
          ),
  );
}

class _Step5Card extends StatelessWidget {
  const _Step5Card({required this.title, required this.body, this.footnote});
  final String title;
  final String body;
  final String? footnote;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(15),
    decoration: BoxDecoration(
      color: FishingTokens.surface,
      borderRadius: BorderRadius.circular(18),
      border: Border.all(color: FishingTokens.line),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(
            fontWeight: FontWeight.w800,
            color: FishingTokens.ink,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          body.isEmpty ? '暂无记录' : body,
          style: const TextStyle(color: FishingTokens.secondary, height: 1.55),
        ),
        if (footnote != null) ...[
          const SizedBox(height: 8),
          Text(
            footnote!,
            style: const TextStyle(
              fontSize: 11,
              color: FishingTokens.muted,
              height: 1.45,
            ),
          ),
        ],
      ],
    ),
  );
}

class _Step5Error extends StatelessWidget {
  const _Step5Error(this.message);
  final String message;
  @override
  Widget build(BuildContext context) => Text(
    message,
    style: const TextStyle(color: Color(0xFFE17E70), height: 1.4),
  );
}

extension _ToggleSet<T> on Set<T> {
  void toggle(T value) {
    if (!remove(value)) add(value);
  }
}

class Step5FishLeaderboardPage extends StatefulWidget {
  const Step5FishLeaderboardPage({required this.token, super.key});
  final String token;

  @override
  State<Step5FishLeaderboardPage> createState() =>
      _Step5FishLeaderboardPageState();
}

class _Step5FishLeaderboardPageState extends State<Step5FishLeaderboardPage> {
  String? _month;
  List<String> _months = [];
  List<Map<String, dynamic>> _boards = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({String? month}) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final query = month == null
          ? ''
          : '?month=${Uri.encodeQueryComponent(month)}';
      final result = await Step1Api.get(
        '/step5/fish-leaderboard$query',
        token: widget.token,
      );
      if (!mounted) return;
      setState(() {
        _month = '${result['month'] ?? month ?? ''}';
        _months = (result['availableMonths'] as List? ?? const [])
            .map((value) => '$value')
            .toList();
        _boards = _maps(result['boards']);
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  String _monthLabel(String value) {
    final parts = value.split('-');
    return parts.length == 2
        ? '${parts[0]} 年 ${int.tryParse(parts[1]) ?? parts[1]} 月'
        : value;
  }

  String _dateLabel(Object? value) {
    final text = '$value';
    if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(text)) return '日期待补';
    return text.replaceAll('-', '.');
  }

  String _weightLabel(Object? value) {
    final grams = int.tryParse('$value') ?? 0;
    if (grams >= 1000) return '${(grams / 1000).toStringAsFixed(2)} kg';
    return '$grams g';
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: FishingTokens.background,
    appBar: AppBar(
      title: const Text('大鱼榜'),
      backgroundColor: FishingTokens.background,
      foregroundColor: FishingTokens.ink,
    ),
    body: RefreshIndicator(
      onRefresh: () => _load(month: _month),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(18, 10, 18, 30),
        children: [
          const _Step5Card(
            title: '每一次好手气，都值得被看见',
            body: '每航次每鱼种仅展示最大一条，按返航月份和鱼种分榜，每榜前 20 名。',
            footnote: '数据来自船长与钓友的渔获回填，不代表平台称重认证。',
          ),
          const SizedBox(height: 14),
          if (_months.isNotEmpty)
            DropdownButtonFormField<String>(
              key: ValueKey(_month),
              initialValue: _months.contains(_month) ? _month : _months.first,
              dropdownColor: FishingTokens.surface,
              decoration: const InputDecoration(labelText: '返航月份'),
              items: _months
                  .map(
                    (value) => DropdownMenuItem(
                      value: value,
                      child: Text(_monthLabel(value)),
                    ),
                  )
                  .toList(),
              onChanged: _loading
                  ? null
                  : (value) {
                      if (value != null) _load(month: value);
                    },
            ),
          if (_loading) ...[
            const SizedBox(height: 18),
            const LinearProgressIndicator(minHeight: 2),
          ],
          if (_error != null) ...[
            const SizedBox(height: 16),
            _Step5Card(title: '暂时无法读取', body: _error!),
            TextButton.icon(
              onPressed: () => _load(month: _month),
              icon: const Icon(Icons.refresh),
              label: const Text('重试'),
            ),
          ],
          if (!_loading && _error == null && _boards.isEmpty) ...[
            const SizedBox(height: 18),
            const _Step5Card(
              title: '这个月还没有上榜渔获',
              body: '完成返航后，船长或钓友回填了最大个体重量的渔获会出现在这里。',
            ),
          ],
          if (!_loading && _error == null)
            ..._boards.map(
              (board) => Padding(
                padding: const EdgeInsets.only(top: 13),
                child: _LeaderboardFishCard(
                  board: board,
                  dateLabel: _dateLabel,
                  weightLabel: _weightLabel,
                ),
              ),
            ),
          const SizedBox(height: 14),
          const Text(
            '排名按最大个体重量排序，同重量按先记录者优先。每航次每鱼种仅展示最大一条，不对船长或钓友排名。',
            style: TextStyle(
              color: FishingTokens.muted,
              fontSize: 11,
              height: 1.5,
            ),
          ),
        ],
      ),
    ),
  );
}

class _LeaderboardFishCard extends StatelessWidget {
  const _LeaderboardFishCard({
    required this.board,
    required this.dateLabel,
    required this.weightLabel,
  });
  final Map<String, dynamic> board;
  final String Function(Object?) dateLabel;
  final String Function(Object?) weightLabel;

  @override
  Widget build(BuildContext context) {
    final items = _maps(board['items']);
    return Container(
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: FishingTokens.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: FishingTokens.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.phishing_outlined,
                color: FishingTokens.brand,
                size: 19,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '${board['fishName'] ?? '鱼种'}',
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 16,
                  ),
                ),
              ),
              Text(
                '${items.length} 条',
                style: const TextStyle(
                  color: FishingTokens.secondary,
                  fontSize: 11,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          ...items.map((item) {
            final rank = int.tryParse('${item['rank']}') ?? 0;
            return Container(
              margin: const EdgeInsets.only(top: 7),
              padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 10),
              decoration: BoxDecoration(
                color: FishingTokens.deepSurface,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  SizedBox(
                    width: 24,
                    child: Text(
                      '$rank',
                      style: TextStyle(
                        color: rank == 1
                            ? FishingTokens.brand
                            : FishingTokens.secondary,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${item['catcherName'] ?? '船长整船回填'}',
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 13,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          '${item['captainName'] ?? '船长'} · ${dateLabel(item['departureDate'])}',
                          style: const TextStyle(
                            color: FishingTokens.muted,
                            fontSize: 10,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    weightLabel(item['maxIndividualWeightGrams']),
                    style: const TextStyle(
                      color: FishingTokens.brand,
                      fontWeight: FontWeight.w900,
                      fontSize: 15,
                    ),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }
}
