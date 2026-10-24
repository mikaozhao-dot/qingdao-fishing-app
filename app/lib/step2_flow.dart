import 'package:flutter/material.dart';

import 'api_client.dart';
import 'fishing_tokens.dart';
import 'step3_flow.dart';

class Step2Workspace extends StatefulWidget {
  const Step2Workspace({
    required this.roleLabel,
    required this.tabLabel,
    required this.token,
    required this.onTokenChanged,
    required this.onOpenProfile,
    required this.onSelectTab,
    super.key,
  });

  final String roleLabel;
  final String tabLabel;
  final String? token;
  final ValueChanged<String?> onTokenChanged;
  final VoidCallback onOpenProfile;
  final ValueChanged<int> onSelectTab;

  @override
  State<Step2Workspace> createState() => _Step2WorkspaceState();
}

class _Step2WorkspaceState extends State<Step2Workspace> {
  Map<String, dynamic>? _options;
  Map<String, dynamic>? _captainContext;
  List<Map<String, dynamic>> _items = [];
  bool _loading = false;
  String? _error;
  Map<String, String> _filters = {};

  bool get _isCaptain => widget.roleLabel == '船长端';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant Step2Workspace oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.token != widget.token ||
        oldWidget.roleLabel != widget.roleLabel ||
        oldWidget.tabLabel != widget.tabLabel) {
      _load();
    }
  }

  Future<void> _load() async {
    if (widget.token == null) {
      setState(() {
        _items = [];
        _captainContext = null;
        _options = null;
        _error = null;
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final token = widget.token!;
      final optionsResponse = await Step1Api.get(
        '/step2/options',
        token: token,
      );
      Map<String, dynamic>? captainContext;
      List<Map<String, dynamic>> items;
      if (_isCaptain) {
        captainContext = await Step1Api.get(
          '/captain/departure-context',
          token: token,
        );
        final response = await Step1Api.get(
          '/captain/departures',
          token: token,
        );
        items = _mapList(response['items']);
      } else {
        final response = await Step1Api.get(
          '/departures${_filterQuery()}',
          token: token,
        );
        items = _mapList(response['items']);
      }
      if (!mounted) return;
      setState(() {
        _options = optionsResponse;
        _captainContext = captainContext;
        _items = items;
      });
    } catch (error) {
      if (!mounted) return;
      final message = error.toString().replaceFirst('Exception: ', '');
      setState(() => _error = message);
      if (message.contains('登录已过期')) widget.onTokenChanged(null);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _filterQuery() {
    final query = <String, String>{};
    for (final key in [
      'dateFrom',
      'dateTo',
      'timeSlot',
      'comfort',
      'boatSize',
      'marinaCode',
      'fishCode',
      'targetAreaCode',
      'minPriceFen',
      'maxPriceFen',
      'tripType',
      'status',
    ]) {
      final value = _filters[key];
      if (value != null && value.isNotEmpty && value != 'all') {
        query[key == 'comfort' ? 'comfortLevel' : key] = value;
      }
    }
    if (query.isEmpty) return '';
    return '?${query.entries.map((e) => '${Uri.encodeQueryComponent(e.key)}=${Uri.encodeQueryComponent(e.value)}').join('&')}';
  }

  @override
  Widget build(BuildContext context) {
    if (widget.token == null) {
      return _LoginPrompt(onOpenProfile: widget.onOpenProfile);
    }
    if (_loading && _options == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _options == null) {
      return _ErrorState(
        message: _error!,
        onRetry: _load,
        onOpenProfile: widget.onOpenProfile,
      );
    }
    if (_isCaptain) return _captainPage();
    return _anglerPage();
  }

  Widget _anglerPage() {
    if (widget.tabLabel == '首页') return _homePage();
    return _activitiesPage();
  }

  Widget _homePage() {
    final next = _items.isEmpty ? null : _items.first;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(18, 8, 18, 28),
        children: [
          const _SectionEyebrow('QINGDAO · SEA FISHING'),
          const SizedBox(height: 8),
          const Text('今天，去海上', style: _titleStyle),
          const SizedBox(height: 5),
          const Text('找一班合适的船，看看谁正准备出发。', style: _bodyStyle),
          const SizedBox(height: 20),
          _SearchLaunchCard(onTap: () => widget.onSelectTab(1)),
          const SizedBox(height: 20),
          _SectionHeading(
            title: '近期可拼班次',
            trailing: TextButton(
              onPressed: () => widget.onSelectTab(1),
              child: const Text('查看全部'),
            ),
          ),
          if (_loading) const LinearProgressIndicator(minHeight: 2),
          if (_error != null) _InlineError(message: _error!, onRetry: _load),
          if (next != null)
            _ActivityCard(
              item: next,
              token: widget.token,
              onTap: () => _openDetail(next),
            ),
          if (_items.length > 1) ...[
            const SizedBox(height: 12),
            _ActivityCard(
              item: _items[1],
              token: widget.token,
              onTap: () => _openDetail(_items[1]),
            ),
          ],
          if (next == null && !_loading && _error == null)
            const _EmptyState(
              icon: Icons.sailing_outlined,
              title: '暂时没有公开班次',
              body: '已发布的活动会出现在这里。',
            ),
          const SizedBox(height: 20),
          const _NoteCard(
            icon: Icons.waves_outlined,
            title: '先看班次，再看海况',
            body: '海况数据源待接入。这里不会展示未经核验的风、浪或潮汐数值。',
          ),
        ],
      ),
    );
  }

  Widget _activitiesPage() => RefreshIndicator(
    onRefresh: _load,
    child: ListView(
      padding: const EdgeInsets.fromLTRB(18, 8, 18, 28),
      children: [
        const _SectionEyebrow('OPEN DEPARTURES'),
        const SizedBox(height: 8),
        _SectionHeading(
          title: '青岛出海活动',
          trailing: IconButton(
            tooltip: '筛选活动',
            onPressed: _openFilters,
            icon: const Icon(Icons.tune_rounded),
          ),
        ),
        const Text('按出航时间排序 · 只展示报名中的班次', style: _bodyStyle),
        const SizedBox(height: 12),
        if (_filters.values.any((value) => value.isNotEmpty && value != 'all'))
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: () => setState(() => _filters = {}),
              icon: const Icon(Icons.close, size: 16),
              label: const Text('清除筛选'),
            ),
          ),
        if (_loading) const LinearProgressIndicator(minHeight: 2),
        if (_error != null) _InlineError(message: _error!, onRetry: _load),
        if (_items.isEmpty && !_loading && _error == null)
          const _EmptyState(
            icon: Icons.search_off_rounded,
            title: '没有匹配的班次',
            body: '调整筛选条件，或稍后再来看看。',
          ),
        ..._items.map(
          (item) => Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _ActivityCard(
              item: item,
              token: widget.token,
              onTap: () => _openDetail(item),
            ),
          ),
        ),
      ],
    ),
  );

  Widget _captainPage() {
    final tab = widget.tabLabel;
    if (_error != null && _captainContext == null) {
      return _ErrorState(
        message: _error!,
        onRetry: _load,
        onOpenProfile: widget.onOpenProfile,
      );
    }
    if (tab == '发班') {
      return _PublishDeparturePage(
        options: _options ?? {},
        boats: _mapList(_captainContext?['boats']),
        token: widget.token!,
        onPublished: _load,
      );
    }
    if (tab == '行程') {
      return _CaptainTripsPage(
        items: _items,
        loading: _loading,
        error: _error,
        token: widget.token!,
        onRefresh: _load,
        onChanged: _load,
        onOpenDetail: _openDetail,
      );
    }
    return _CaptainWorkbench(
      contextData: _captainContext ?? {},
      items: _items,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      onPublish: () => widget.onSelectTab(1),
      onTrips: () => widget.onSelectTab(2),
      onOpenDetail: _openDetail,
      onOpenProfile: widget.onOpenProfile,
      token: widget.token!,
    );
  }

  Future<void> _openDetail(Map<String, dynamic> item) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => DepartureDetailPage(
          id: '${item['id']}',
          token: widget.token!,
          allowBooking: !_isCaptain,
        ),
      ),
    );
  }

  Future<void> _openFilters() async {
    final result = await showModalBottomSheet<Map<String, String>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: FishingTokens.surface,
      builder: (_) =>
          _FilterSheet(options: _options ?? {}, initial: Map.of(_filters)),
    );
    if (result == null || !mounted) return;
    setState(() => _filters = result);
    await _load();
  }
}

class _PublishDeparturePage extends StatefulWidget {
  const _PublishDeparturePage({
    required this.options,
    required this.boats,
    required this.token,
    required this.onPublished,
  });
  final Map<String, dynamic> options;
  final List<Map<String, dynamic>> boats;
  final String token;
  final VoidCallback onPublished;

  @override
  State<_PublishDeparturePage> createState() => _PublishDeparturePageState();
}

class _PublishDeparturePageState extends State<_PublishDeparturePage> {
  final _formKey = GlobalKey<FormState>();
  final _price = TextEditingController(text: '500');
  final _surcharge = TextEditingController(text: '100');
  final _minimum = TextEditingController(text: '3000');
  final _platformQuota = TextEditingController(text: '12');
  final _offlineQuota = TextEditingController(text: '0');
  final _baitGrams = TextEditingController(text: '300');
  final _sinkerMin = TextEditingController(text: '80');
  final _sinkerMax = TextEditingController(text: '120');
  final _remarks = TextEditingController();
  String? _boatId;
  String _tripType = 'pro_fishing';
  String _departureDate = _dateAfter(3);
  String _meetingTime = '05:30';
  String _departureTime = '06:00';
  String _returnTime = '13:00';
  String _deadlineTime = '05:30';
  String _targetArea = 'qingdao_nearshore';
  String _marina = 'xiaogang';
  String _fishCode = 'sea_bass';
  final List<String> _fishCodes = ['sea_bass'];
  List<String> _baitTypes = ['antarctic_shrimp'];
  String _baitSupply = 'captain_provided';
  double _mainLinePe = 1.5;
  int _leaderNumber = 5;
  String _sinkerShape = 'long_bar';
  bool _submitting = false;
  bool _manualSupply = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    if (widget.boats.isNotEmpty) {
      _boatId = '${widget.boats.first['id']}';
      _marina = '${widget.boats.first['defaultMarinaCode'] ?? _marina}';
      _platformQuota.text = '${widget.boats.first['seatCount'] ?? 0}';
    }
    final fish = _fishOptions
        .where((entry) => entry['code'] == _fishCode)
        .firstOrNull;
    final preset = fish?['rigPreset'];
    if (preset is Map) {
      _baitTypes = List<String>.from(preset['baitTypes'] as List);
      _baitGrams.text = '${preset['baitGramsPerPerson']}';
      _baitSupply = '${preset['baitSupply']}';
      _mainLinePe = (preset['mainLinePe'] as num).toDouble();
      _leaderNumber = preset['leaderLineNumber'] as int;
      _sinkerShape = '${preset['sinkerShape']}';
      _sinkerMin.text = '${preset['sinkerMinGrams']}';
      _sinkerMax.text = '${preset['sinkerMaxGrams']}';
    }
  }

  @override
  void dispose() {
    _price.dispose();
    _surcharge.dispose();
    _minimum.dispose();
    _platformQuota.dispose();
    _offlineQuota.dispose();
    _baitGrams.dispose();
    _sinkerMin.dispose();
    _sinkerMax.dispose();
    _remarks.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> get _fishOptions =>
      _mapList(widget.options['fish']);
  List<Map<String, dynamic>> get _marinas =>
      _mapList(widget.options['marinas']);
  List<Map<String, dynamic>> get _areas =>
      _mapList(widget.options['targetAreas']);
  Map<String, dynamic>? get _selectedBoat =>
      widget.boats.where((boat) => '${boat['id']}' == _boatId).firstOrNull;

  void _applyFishPreset(String code) {
    final fish = _fishOptions
        .where((entry) => entry['code'] == code)
        .firstOrNull;
    final preset = fish?['rigPreset'];
    if (preset is! Map) return;
    setState(() {
      _baitTypes = List<String>.from(preset['baitTypes'] as List);
      _baitGrams.text = '${preset['baitGramsPerPerson']}';
      _baitSupply = '${preset['baitSupply']}';
      _mainLinePe = (preset['mainLinePe'] as num).toDouble();
      _leaderNumber = preset['leaderLineNumber'] as int;
      _sinkerShape = '${preset['sinkerShape']}';
      _sinkerMin.text = '${preset['sinkerMinGrams']}';
      _sinkerMax.text = '${preset['sinkerMaxGrams']}';
    });
  }

  Future<void> _chooseDate() async {
    final initial =
        DateTime.tryParse(_departureDate) ??
        DateTime.now().add(const Duration(days: 3));
    final picked = await showDatePicker(
      context: context,
      initialDate: initial.isBefore(DateTime.now()) ? DateTime.now() : initial,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365)),
      builder: (context, child) => Theme(
        data: Theme.of(context).copyWith(
          colorScheme: Theme.of(context).colorScheme.copyWith(
            primary: FishingTokens.brand,
            onPrimary: FishingTokens.background,
          ),
        ),
        child: child!,
      ),
    );
    if (picked != null) {
      setState(
        () => _departureDate =
            '${picked.year}-${_two(picked.month)}-${_two(picked.day)}',
      );
    }
  }

  Future<void> _chooseTime(String field) async {
    final value = switch (field) {
      'meeting' => _meetingTime,
      'departure' => _departureTime,
      'return' => _returnTime,
      _ => _deadlineTime,
    };
    final pieces = value.split(':').map(int.parse).toList();
    final picked = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(hour: pieces[0], minute: pieces[1]),
    );
    if (picked == null) return;
    final formatted = '${_two(picked.hour)}:${_two(picked.minute)}';
    setState(() {
      switch (field) {
        case 'meeting':
          _meetingTime = formatted;
        case 'departure':
          _departureTime = formatted;
        case 'return':
          _returnTime = formatted;
        case 'deadline':
          _deadlineTime = formatted;
      }
    });
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_boatId == null || _fishCodes.isEmpty) {
      setState(() => _error = _boatId == null ? '请选择可用船档案' : '至少选择一种目标鱼');
      return;
    }
    final boatSeatCount =
        int.tryParse('${_selectedBoat?['seatCount'] ?? ''}') ?? 0;
    final platformQuota = int.tryParse(_platformQuota.text);
    final offlineQuota = int.tryParse(_offlineQuota.text);
    if (!_manualSupply &&
        (platformQuota == null ||
            offlineQuota == null ||
            platformQuota < 1 ||
            offlineQuota < 0 ||
            platformQuota + offlineQuota > boatSeatCount)) {
      setState(() => _error = '平台席位需至少 1 位，平台与线下配额之和不能超过船只模板席位数');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final body = {
        'boatId': _boatId,
        'tripType': _tripType,
        'departureDate': _departureDate,
        'meetingTime': _meetingTime,
        'departureTime': _departureTime,
        'returnTime': _returnTime,
        'bookingDeadlineTime': _deadlineTime,
        'targetAreaCode': _targetArea,
        'marinaCode': _marina,
        'fishCodes': _fishCodes,
        'pricePerSeatFen': _yuanToFen(_price.text),
        'sternSurchargeFen': _yuanToFen(_surcharge.text),
        'minimumTotalFen': _yuanToFen(_minimum.text),
        if (_manualSupply)
          'manualSupply': true
        else ...{
          'manualSupply': false,
          'platformQuotaSeats': platformQuota!,
          'offlineQuotaSeats': offlineQuota!,
        },
        'remarks': _remarks.text.trim(),
        'rigConfig': {
          'baitTypes': _baitTypes,
          'baitGramsPerPerson': int.parse(_baitGrams.text),
          'baitSupply': _baitSupply,
          'mainLinePe': _mainLinePe,
          'leaderLineNumber': _leaderNumber,
          'sinkerShape': _sinkerShape,
          'sinkerMinGrams': int.parse(_sinkerMin.text),
          'sinkerMaxGrams': int.parse(_sinkerMax.text),
        },
      };
      await Step1Api.post('/captain/departures', body, token: widget.token);
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('班次已发布'),
          content: Text(
            _manualSupply
                ? '班次已按人工确认供给发布，没有开放平台即时订位。'
                : '班次已发布：平台专售 $platformQuota 位，线下 $offlineQuota 位。未分配席位不会进入平台库存。',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('知道了'),
            ),
          ],
        ),
      );
      _price.text = '500';
      _minimum.text = '3000';
      _remarks.clear();
      widget.onPublished();
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
  Widget build(BuildContext context) {
    return Form(
      key: _formKey,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(18, 8, 18, 34),
        children: [
          const _SectionEyebrow('CAPTAIN · NEW DEPARTURE'),
          const SizedBox(height: 8),
          const Text('发布一个班次', style: _titleStyle),
          const SizedBox(height: 5),
          const Text('关键内容都用标准选项，钓组可按鱼种预设后调整。', style: _bodyStyle),
          const SizedBox(height: 18),
          if (widget.boats.isEmpty)
            _NoteCard(
              icon: Icons.directions_boat_outlined,
              title: '暂无可发班船档案',
              body: '请先完成船长资质与船档案审核，再回来创建班次。',
              action: TextButton(
                onPressed: () => Navigator.of(context).maybePop(),
                child: const Text('查看船长资料'),
              ),
            )
          else ...[
            _FormSection(
              title: '出航信息',
              index: '01',
              children: [
                _DropdownField<String>(
                  label: '使用船只',
                  value: _boatId,
                  values: widget.boats
                      .map(
                        (boat) => DropdownMenuItem(
                          value: '${boat['id']}',
                          child: Text(
                            '${boat['name']} · ${_metres(boat['lengthCm'])} m',
                          ),
                        ),
                      )
                      .toList(),
                  onChanged: (value) => setState(() {
                    _boatId = value;
                    final boat = _selectedBoat;
                    if (boat != null) {
                      _marina = '${boat['defaultMarinaCode']}';
                      _platformQuota.text = '${boat['seatCount'] ?? 0}';
                      _offlineQuota.text = '0';
                    }
                  }),
                ),
                _OptionRow(
                  label: '班次类型',
                  child: _ChoiceChips(
                    items: _mapList(widget.options['tripTypes']),
                    value: _tripType,
                    onChanged: (value) => setState(() => _tripType = value),
                  ),
                ),
                _TapField(
                  label: '出航日期',
                  value: _departureDate,
                  icon: Icons.calendar_today_outlined,
                  onTap: _chooseDate,
                ),
                Row(
                  children: [
                    Expanded(
                      child: _TapField(
                        label: '集合',
                        value: _meetingTime,
                        icon: Icons.access_time,
                        onTap: () => _chooseTime('meeting'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _TapField(
                        label: '出航',
                        value: _departureTime,
                        icon: Icons.sailing_outlined,
                        onTap: () => _chooseTime('departure'),
                      ),
                    ),
                  ],
                ),
                Row(
                  children: [
                    Expanded(
                      child: _TapField(
                        label: '返港',
                        value: _returnTime,
                        icon: Icons.anchor_outlined,
                        onTap: () => _chooseTime('return'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _TapField(
                        label: '报名截止',
                        value: _deadlineTime,
                        icon: Icons.timer_outlined,
                        onTap: () => _chooseTime('deadline'),
                      ),
                    ),
                  ],
                ),
                _DropdownField<String>(
                  label: '集合码头',
                  value: _marina,
                  values: _marinas
                      .map(
                        (entry) => DropdownMenuItem(
                          value: '${entry['code']}',
                          child: Text('${entry['name']}'),
                        ),
                      )
                      .toList(),
                  onChanged: (value) =>
                      setState(() => _marina = value ?? _marina),
                ),
                _DropdownField<String>(
                  label: '目标海域',
                  value: _targetArea,
                  values: _areas
                      .map(
                        (entry) => DropdownMenuItem(
                          value: '${entry['code']}',
                          child: Text('${entry['name']}'),
                        ),
                      )
                      .toList(),
                  onChanged: (value) =>
                      setState(() => _targetArea = value ?? _targetArea),
                ),
              ],
            ),
            _FormSection(
              title: '目标鱼种与钓组',
              index: '02',
              children: [
                const Text('最多选 3 种，选择后自动带出常用钓组。', style: _bodyStyle),
                Wrap(
                  spacing: 7,
                  runSpacing: 2,
                  children: _fishOptions.map((fish) {
                    final code = '${fish['code']}';
                    return FilterChip(
                      label: Text(
                        '${fish['name']}${fish['inSeason'] == true ? ' · 当季' : ''}',
                      ),
                      selected: _fishCodes.contains(code),
                      onSelected: (selected) {
                        setState(() {
                          if (selected && _fishCodes.length < 3) {
                            _fishCodes.add(code);
                            _fishCode = code;
                          }
                          if (!selected) _fishCodes.remove(code);
                        });
                        if (selected) _applyFishPreset(code);
                      },
                    );
                  }).toList(),
                ),
                const SizedBox(height: 6),
                _OptionRow(
                  label: '当前预设',
                  child: _ChoiceChips(
                    items: _fishOptions
                        .where((fish) => _fishCodes.contains('${fish['code']}'))
                        .toList(),
                    value: _fishCode,
                    onChanged: (value) {
                      setState(() => _fishCode = value);
                      _applyFishPreset(value);
                    },
                  ),
                ),
                _MultiSelectChips(
                  label: '饵料种类',
                  options: _mapList(widget.options['baitTypes']),
                  selected: _baitTypes,
                  onChanged: (value) => setState(() => _baitTypes = value),
                ),
                Row(
                  children: [
                    Expanded(
                      child: _NumberField(
                        label: '每人饵料克数',
                        controller: _baitGrams,
                        suffix: 'g',
                        min: 0,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _DropdownField<String>(
                        label: '饵料供给',
                        value: _baitSupply,
                        values: _mapList(widget.options['baitSupplies'])
                            .map(
                              (entry) => DropdownMenuItem(
                                value: '${entry['code']}',
                                child: Text('${entry['name']}'),
                              ),
                            )
                            .toList(),
                        onChanged: (value) =>
                            setState(() => _baitSupply = value ?? _baitSupply),
                      ),
                    ),
                  ],
                ),
                Row(
                  children: [
                    Expanded(
                      child: _DropdownField<double>(
                        label: '主线 PE',
                        value: _mainLinePe,
                        values: _numberList(widget.options['mainLinePe'])
                            .map(
                              (value) => DropdownMenuItem(
                                value: value.toDouble(),
                                child: Text(
                                  'PE ${value.toStringAsFixed(value % 1 == 0 ? 0 : 1)}',
                                ),
                              ),
                            )
                            .toList(),
                        onChanged: (value) =>
                            setState(() => _mainLinePe = value ?? _mainLinePe),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _DropdownField<int>(
                        label: '前导线号',
                        value: _leaderNumber,
                        values: _numberList(widget.options['leaderLineNumbers'])
                            .map(
                              (value) => DropdownMenuItem<int>(
                                value: value.toInt(),
                                child: Text('${value.toInt()}号'),
                              ),
                            )
                            .toList(),
                        onChanged: (value) => setState(
                          () => _leaderNumber = value ?? _leaderNumber,
                        ),
                      ),
                    ),
                  ],
                ),
                Row(
                  children: [
                    Expanded(
                      child: _DropdownField<String>(
                        label: '铅坠形状',
                        value: _sinkerShape,
                        values: _mapList(widget.options['sinkerShapes'])
                            .map(
                              (entry) => DropdownMenuItem(
                                value: '${entry['code']}',
                                child: Text('${entry['name']}'),
                              ),
                            )
                            .toList(),
                        onChanged: (value) => setState(
                          () => _sinkerShape = value ?? _sinkerShape,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Row(
                        children: [
                          Expanded(
                            child: _NumberField(
                              label: '最轻',
                              controller: _sinkerMin,
                              suffix: 'g',
                              min: 1,
                            ),
                          ),
                          const Padding(
                            padding: EdgeInsets.only(top: 20),
                            child: Text('–'),
                          ),
                          Expanded(
                            child: _NumberField(
                              label: '最重',
                              controller: _sinkerMax,
                              suffix: 'g',
                              min: 1,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ),
            _FormSection(
              title: '席位配额',
              index: '03',
              children: [
                SwitchListTile.adaptive(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('人工确认供给'),
                  subtitle: const Text('不开放平台即时订位，由船长线下确认供给。'),
                  value: _manualSupply,
                  onChanged: (value) => setState(() => _manualSupply = value),
                ),
                if (!_manualSupply) ...[
                  Row(
                    children: [
                      Expanded(
                        child: TextFormField(
                          controller: _platformQuota,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            labelText: '平台专售',
                            suffixText: '位',
                          ),
                          validator: (value) =>
                              int.tryParse(value ?? '') == null ||
                                  int.parse(value!) < 0
                              ? '请输入整数'
                              : null,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: TextFormField(
                          controller: _offlineQuota,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            labelText: '线下专售',
                            suffixText: '位',
                          ),
                          validator: (value) =>
                              int.tryParse(value ?? '') == null ||
                                  int.parse(value!) < 0
                              ? '请输入整数'
                              : null,
                        ),
                      ),
                    ],
                  ),
                  const Text(
                    '平台与线下席位互不混卖；未分配的模板席位不会开放。已锁定或售出的席位不能调额。',
                    style: _smallNote,
                  ),
                ],
              ],
            ),
            _FormSection(
              title: '价格与说明',
              index: '04',
              children: [
                Row(
                  children: [
                    Expanded(
                      child: _NumberField(
                        label: '每位价格',
                        controller: _price,
                        suffix: '元',
                        min: 1,
                        decimal: true,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _NumberField(
                        label: '尾角位加价',
                        controller: _surcharge,
                        suffix: '元',
                        min: 0,
                        decimal: true,
                      ),
                    ),
                  ],
                ),
                _NumberField(
                  label: '最低成行总价',
                  controller: _minimum,
                  suffix: '元',
                  min: 1,
                  decimal: true,
                ),
                TextFormField(
                  controller: _remarks,
                  maxLength: 500,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: '出航提醒（选填）',
                    hintText: '例如：请提前准备防滑鞋和防晒用品',
                    alignLabelWithHint: true,
                  ),
                ),
              ],
            ),
            if (_error != null)
              _InlineError(
                message: _error!,
                onRetry: () async => setState(() => _error = null),
              ),
            FilledButton.icon(
              onPressed: _submitting ? null : _submit,
              icon: _submitting
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.publish_outlined),
              label: Text(_submitting ? '正在发布…' : '发布班次'),
            ),
            const SizedBox(height: 8),
            const Text(
              '此版本只发布和展示班次，不提供选位、锁位、下单或支付。',
              textAlign: TextAlign.center,
              style: TextStyle(color: FishingTokens.muted, fontSize: 11),
            ),
          ],
        ],
      ),
    );
  }
}

class _CaptainWorkbench extends StatelessWidget {
  const _CaptainWorkbench({
    required this.contextData,
    required this.items,
    required this.loading,
    required this.error,
    required this.onRefresh,
    required this.onPublish,
    required this.onTrips,
    required this.onOpenDetail,
    required this.onOpenProfile,
    required this.token,
  });
  final Map<String, dynamic> contextData;
  final List<Map<String, dynamic>> items;
  final bool loading;
  final String? error;
  final Future<void> Function() onRefresh;
  final VoidCallback onPublish;
  final VoidCallback onTrips;
  final ValueChanged<Map<String, dynamic>> onOpenDetail;
  final VoidCallback onOpenProfile;
  final String token;

  @override
  Widget build(BuildContext context) {
    final boats = _mapList(contextData['boats']);
    final openCount = items
        .where((item) => item['status'] == 'published')
        .length;
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(18, 8, 18, 28),
        children: [
          const _SectionEyebrow('CAPTAIN · WORKBENCH'),
          const SizedBox(height: 8),
          const Text('出海安排', style: _titleStyle),
          const SizedBox(height: 5),
          const Text('管理已审核船只的班次与活动信息。', style: _bodyStyle),
          const SizedBox(height: 18),
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: FishingTokens.surfaceTint,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: FishingTokens.line),
            ),
            child: Row(
              children: [
                Expanded(
                  child: _Metric(label: '报名中', value: '$openCount', unit: '班'),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: _Metric(
                    label: '可用船只',
                    value: '${boats.length}',
                    unit: '艘',
                  ),
                ),
                const SizedBox(width: 16),
                const Expanded(
                  child: _Metric(label: '当前版本', value: '只读', unit: '展示'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: boats.isEmpty ? onOpenProfile : onPublish,
            icon: Icon(
              boats.isEmpty ? Icons.verified_user_outlined : Icons.add,
            ),
            label: Text(boats.isEmpty ? '完善船长与船档案' : '创建新班次'),
          ),
          const SizedBox(height: 20),
          _SectionHeading(
            title: '我的船档案',
            trailing: TextButton(
              onPressed: onOpenProfile,
              child: const Text('管理'),
            ),
          ),
          if (boats.isEmpty)
            const _NoteCard(
              icon: Icons.directions_boat_outlined,
              title: '还没有可用船只',
              body: '完成资质和船档案审核后，即可发布班次。',
            )
          else
            ...boats.map((boat) => _BoatSummaryCard(boat: boat)),
          const SizedBox(height: 16),
          _SectionHeading(
            title: '最近班次',
            trailing: TextButton(onPressed: onTrips, child: const Text('全部')),
          ),
          if (loading) const LinearProgressIndicator(minHeight: 2),
          if (error != null) _InlineError(message: error!, onRetry: onRefresh),
          if (items.isEmpty && !loading)
            const _EmptyState(
              icon: Icons.event_note_outlined,
              title: '还没有发布班次',
              body: '创建班次后，钓友就能在活动列表里查看。',
            ),
          ...items
              .take(2)
              .map(
                (item) => Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _ActivityCard(
                    item: item,
                    token: token,
                    captain: true,
                    onTap: () => onOpenDetail(item),
                  ),
                ),
              ),
        ],
      ),
    );
  }
}

class _CaptainTripsPage extends StatelessWidget {
  const _CaptainTripsPage({
    required this.items,
    required this.loading,
    required this.error,
    required this.token,
    required this.onRefresh,
    required this.onChanged,
    required this.onOpenDetail,
  });
  final List<Map<String, dynamic>> items;
  final bool loading;
  final String? error;
  final String token;
  final Future<void> Function() onRefresh;
  final VoidCallback onChanged;
  final ValueChanged<Map<String, dynamic>> onOpenDetail;

  Future<void> _withdraw(
    BuildContext context,
    Map<String, dynamic> item,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('下架这个班次？'),
        content: const Text('下架后，钓友将无法在公开活动列表中看到。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('确认下架'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await Step1Api.post(
        '/captain/departures/${item['id']}/withdraw',
        const {},
        token: token,
      );
      onChanged();
    } catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(error.toString().replaceFirst('Exception: ', '')),
          ),
        );
      }
    }
  }

  Future<void> _republish(
    BuildContext context,
    Map<String, dynamic> item,
  ) async {
    final initial = DateTime.now().add(const Duration(days: 3));
    final date = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (date == null) return;
    final dateText = '${date.year}-${_two(date.month)}-${_two(date.day)}';
    try {
      await Step1Api.post('/captain/departures/${item['id']}/republish', {
        'departureDate': dateText,
      }, token: token);
      onChanged();
    } catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(error.toString().replaceFirst('Exception: ', '')),
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
    onRefresh: onRefresh,
    child: ListView(
      padding: const EdgeInsets.fromLTRB(18, 8, 18, 28),
      children: [
        const _SectionEyebrow('CAPTAIN · DEPARTURES'),
        const SizedBox(height: 8),
        const Text('我的班次', style: _titleStyle),
        const SizedBox(height: 5),
        const Text('查看状态、下架或复制历史班次。', style: _bodyStyle),
        const SizedBox(height: 16),
        if (loading) const LinearProgressIndicator(minHeight: 2),
        if (error != null) _InlineError(message: error!, onRetry: onRefresh),
        if (items.isEmpty && !loading)
          const _EmptyState(
            icon: Icons.event_note_outlined,
            title: '还没有班次',
            body: '发布后班次会显示在这里。',
          ),
        ...items.map(
          (item) => Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _TripManagementCard(
              item: item,
              token: token,
              onWithdraw: () => _withdraw(context, item),
              onRepublish: () => _republish(context, item),
              onOpen: () => onOpenDetail(item),
            ),
          ),
        ),
      ],
    ),
  );
}

class _DepartureDetailPageState extends State<DepartureDetailPage> {
  Map<String, dynamic>? _data;
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
      final result = await Step1Api.get(
        '/departures/${widget.id}',
        token: widget.token,
      );
      if (!mounted) return;
      setState(() => _data = result['departure'] as Map<String, dynamic>);
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

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('活动详情')),
    body: _loading
        ? const Center(child: CircularProgressIndicator())
        : _error != null
        ? _ErrorState(message: _error!, onRetry: _load)
        : _detailBody(),
  );

  Widget _detailBody() {
    final item = _data!;
    final boat = _asMap(item['boat']);
    final rig = _asMap(item['rigConfig']);
    final seats = _mapList(item['seats']);
    final fish = _mapList(item['fishTargets']);
    final photos = _asMap(boat['photoKinds']);
    final hasPhoto = photos['exterior'] == true;
    final baseUrl = Step1Api.baseUrl;
    final price = _money(item['pricePerSeatFen']);
    final premiumPrice = _money(item['premiumSeatPriceFen']);
    final booked = item['bookedSeatCount'] ?? 0;
    final total = item['totalSeatCount'] ?? seats.length;
    final platformQuota = item['platformQuotaSeats'] ?? total;
    final instantConfirmation =
        item['instantConfirmationAvailable'] != false &&
        item['manualSupply'] != true;
    return ListView(
      padding: const EdgeInsets.fromLTRB(18, 8, 18, 36),
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(20),
          child: AspectRatio(
            aspectRatio: 1.65,
            child: hasPhoto
                ? Image.network(
                    '$baseUrl/boats/${boat['id']}/photos/exterior',
                    headers: {'authorization': 'Bearer ${widget.token}'},
                    fit: BoxFit.cover,
                    errorBuilder: (_, _, _) => const _PhotoPlaceholder(),
                  )
                : const _PhotoPlaceholder(),
          ),
        ),
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(
              child: Text(
                '${boat['name'] ?? '海上班次'}',
                style: const TextStyle(
                  fontSize: 23,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            _StatusPill(
              label: _statusName(item['status']),
              active: item['status'] == 'published',
            ),
          ],
        ),
        const SizedBox(height: 6),
        Text(
          '${item['tripTypeLabel'] ?? '出海活动'} · 船长 ${item['captainName'] ?? '待确认'}',
          style: _bodyStyle,
        ),
        const SizedBox(height: 16),
        _PricePanel(
          price: price,
          premium: premiumPrice,
          seats: '$booked/$platformQuota',
        ),
        if (item['manualSupply'] == true)
          const Padding(
            padding: EdgeInsets.only(top: 12),
            child: _NoteCard(
              icon: Icons.support_agent_outlined,
              title: '人工确认供给',
              body: '席位需由船长线下确认；当前不支持在线锁位或支付。',
            ),
          ),
        const SizedBox(height: 14),
        _DetailSection(
          title: '出航安排',
          children: [
            _DetailRow(
              icon: Icons.calendar_month_outlined,
              label: '出航日期',
              value:
                  '${item['departureDate']}  ${item['departureTime']} – ${item['returnTime']}',
            ),
            _DetailRow(
              icon: Icons.access_time,
              label: '集合时间',
              value:
                  '${item['meetingTime'] ?? item['departureTime']} · 截止 ${_formatDeadline(item['bookingDeadline'])}',
            ),
            _DetailRow(
              icon: Icons.place_outlined,
              label: '集合码头',
              value: '${item['marinaName']}',
            ),
            _DetailRow(
              icon: Icons.waves_outlined,
              label: '目标海域',
              value: '${item['targetAreaName']}',
            ),
            _DetailRow(
              icon: Icons.phishing_outlined,
              label: '目标鱼种',
              value: fish.map((entry) => '${entry['name']}').join('、'),
            ),
          ],
        ),
        _DetailSection(
          title: '船只档案',
          children: [
            _DetailRow(
              icon: Icons.directions_boat_outlined,
              label: '船只规格',
              value:
                  '${_metres(boat['lengthCm'])} 米 · ${boat['seatCount']} 位 · ${boat['comfortLabel'] ?? '舒适度待核定'}',
            ),
            _DetailRow(
              icon: Icons.event_seat_outlined,
              label: '席位配额',
              value: item['manualSupply'] == true
                  ? '人工确认供给 · 平台未开放即时订位'
                  : '平台专售 $platformQuota 位 · 线下专售 ${item['offlineQuotaSeats'] ?? 0} 位',
            ),
            _DetailRow(
              icon: Icons.star_border_rounded,
              label: '船上设施',
              value: _facilityNames(boat['facilities']),
            ),
            const Text('钓位示意（只读）', style: _labelStyle),
            const SizedBox(height: 8),
            _SeatDiagram(
              seats: seats,
              manualSupply: item['manualSupply'] == true,
            ),
          ],
        ),
        _DetailSection(
          title: '钓组配置',
          children: [
            _DetailRow(
              icon: Icons.set_meal_outlined,
              label: '饵料',
              value:
                  '${_baitNames(rig['baitTypes'])} · ${rig['baitGramsPerPerson']} 克/人',
            ),
            _DetailRow(
              icon: Icons.inventory_2_outlined,
              label: '饵料供给',
              value: '${rig['baitSupplyName'] ?? '待确认'}',
            ),
            _DetailRow(
              icon: Icons.cable_outlined,
              label: '线组',
              value:
                  '主线 PE ${rig['mainLinePe']} · 前导 ${rig['leaderLineNumber']} 号',
            ),
            _DetailRow(
              icon: Icons.anchor_outlined,
              label: '铅坠',
              value:
                  '${rig['sinkerShapeName'] ?? rig['sinkerShape']} · ${rig['sinkerMinGrams']}–${rig['sinkerMaxGrams']} 克',
            ),
            if ('${item['remarks'] ?? ''}'.isNotEmpty)
              _DetailRow(
                icon: Icons.notes_rounded,
                label: '船长提醒',
                value: '${item['remarks']}',
              ),
          ],
        ),
        _DetailSection(
          title: '成行说明',
          children: [
            _DetailRow(
              icon: Icons.groups_outlined,
              label: '最低成行总价',
              value: _money(item['minimumTotalFen']),
            ),
            _DetailRow(
              icon: Icons.account_balance_wallet_outlined,
              label: '当前已订金额',
              value: _money(item['bookedAmountFen']),
            ),
            _DetailRow(
              icon: Icons.trending_up_rounded,
              label: '距成行金额',
              value: _money(item['remainingMinimumFen']),
            ),
            const Text('当前版本仅展示班次，尚未开放预订，因此已订人数与已订金额为 0。', style: _smallNote),
          ],
        ),
        const _DetailSection(
          title: '出行须知',
          children: [
            _DetailRow(
              icon: Icons.event_busy_outlined,
              label: '退改规则',
              value:
                  '出航前 72 小时外免费取消；72–24 小时扣 30%；24–6 小时扣 60%；6 小时内或爽约不退款。完整规则以正式订单页为准。',
            ),
            _DetailRow(
              icon: Icons.health_and_safety_outlined,
              label: '保险提示',
              value: '正式预订前需按平台规则完成保险投保。保险由持牌保险机构提供，本页不办理投保。',
            ),
          ],
        ),
        const _DetailSection(
          title: '海况参考',
          children: [
            _NoteCard(
              icon: Icons.cloud_sync_outlined,
              title: '数据源待接入',
              body: '当前不显示风速、风向、浪高或潮汐数值。出海决策请以船长和主管部门信息为准。',
            ),
          ],
        ),
        const _DetailSection(
          title: '船长口碑',
          children: [
            _EmptyState(
              icon: Icons.rate_review_outlined,
              title: '暂无评价',
              body: '完成真实订单后，钓友可分享出海体验。',
            ),
          ],
        ),
        const SizedBox(height: 12),
        if (widget.allowBooking && instantConfirmation)
          FilledButton.icon(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => SeatSelectionPage(
                  departureId: widget.id,
                  token: widget.token,
                ),
              ),
            ),
            icon: const Icon(Icons.event_seat_outlined),
            label: const Text('选择座位'),
          )
        else if (widget.allowBooking)
          const _NoteCard(
            icon: Icons.support_agent_outlined,
            title: '请联系船长确认席位',
            body: '该班次没有开放平台即时订位，当前不能在线锁位或支付。',
          )
        else
          const Text(
            '本阶段船长端只管理班次，不支持为自有班次订位。',
            textAlign: TextAlign.center,
            style: _smallNote,
          ),
      ],
    );
  }
}

class DepartureDetailPage extends StatefulWidget {
  const DepartureDetailPage({
    required this.id,
    required this.token,
    required this.allowBooking,
    super.key,
  });
  final String id;
  final String token;
  final bool allowBooking;
  @override
  State<DepartureDetailPage> createState() => _DepartureDetailPageState();
}

class _FilterSheet extends StatefulWidget {
  const _FilterSheet({required this.options, required this.initial});
  final Map<String, dynamic> options;
  final Map<String, String> initial;
  @override
  State<_FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends State<_FilterSheet> {
  late Map<String, String> values = Map.of(widget.initial);

  List<Map<String, dynamic>> get marinas => _mapList(widget.options['marinas']);
  List<Map<String, dynamic>> get fish => _mapList(widget.options['fish']);
  List<Map<String, dynamic>> get areas =>
      _mapList(widget.options['targetAreas']);

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final today = '${now.year}-${_two(now.month)}-${_two(now.day)}';
    final tomorrowDate = now.add(const Duration(days: 1));
    final tomorrow =
        '${tomorrowDate.year}-${_two(tomorrowDate.month)}-${_two(tomorrowDate.day)}';
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          18,
          12,
          18,
          18 + MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Expanded(
                    child: Text(
                      '筛选活动',
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
              const _FilterLabel('出航时间'),
              _ChoiceChips(
                items: const [
                  {'code': 'all', 'name': '不限'},
                  {'code': 'morning', 'name': '清晨'},
                  {'code': 'day', 'name': '白天'},
                  {'code': 'evening', 'name': '夜钓'},
                ],
                value: values['timeSlot'] ?? 'all',
                onChanged: (v) =>
                    setState(() => values['timeSlot'] = v == 'all' ? '' : v),
              ),
              const _FilterLabel('日期'),
              _ChoiceChips(
                items: [
                  {'code': 'all', 'name': '不限'},
                  {'code': today, 'name': '今天'},
                  {'code': tomorrow, 'name': '明天'},
                ],
                value: values['dateFrom'] ?? 'all',
                onChanged: (v) {
                  setState(() {
                    values['dateFrom'] = v == 'all' ? '' : v;
                    values['dateTo'] = v == 'all' ? '' : v;
                  });
                },
              ),
              const _FilterLabel('舒适度'),
              _ChoiceChips(
                items: const [
                  {'code': 'all', 'name': '不限'},
                  {'code': 'spacious', 'name': '宽松'},
                  {'code': 'comfortable', 'name': '舒适'},
                  {'code': 'compact', 'name': '紧凑'},
                ],
                value: values['comfort'] ?? 'all',
                onChanged: (v) => setState(() => values['comfort'] = v),
              ),
              const _FilterLabel('船只大小'),
              _ChoiceChips(
                items: const [
                  {'code': 'all', 'name': '不限'},
                  {'code': 'under_12', 'name': '12 米以下'},
                  {'code': '12_14', 'name': '12–14 米'},
                  {'code': '14_plus', 'name': '14 米以上'},
                ],
                value: values['boatSize'] ?? 'all',
                onChanged: (v) => setState(() => values['boatSize'] = v),
              ),
              const _FilterLabel('集合码头'),
              _ChoiceChips(
                items: [
                  {'code': 'all', 'name': '不限'},
                  ...marinas,
                ],
                value: values['marinaCode'] ?? 'all',
                onChanged: (v) => setState(() => values['marinaCode'] = v),
              ),
              const _FilterLabel('目标海域'),
              _ChoiceChips(
                items: [
                  {'code': 'all', 'name': '不限'},
                  ...areas,
                ],
                value: values['targetAreaCode'] ?? 'all',
                onChanged: (v) => setState(() => values['targetAreaCode'] = v),
              ),
              const _FilterLabel('目标鱼种'),
              _ChoiceChips(
                items: [
                  {'code': 'all', 'name': '不限'},
                  ...fish,
                ],
                value: values['fishCode'] ?? 'all',
                onChanged: (v) => setState(() => values['fishCode'] = v),
              ),
              const _FilterLabel('班次类型'),
              _ChoiceChips(
                items: [
                  {'code': 'all', 'name': '不限'},
                  ..._mapList(widget.options['tripTypes']),
                ],
                value: values['tripType'] ?? 'all',
                onChanged: (v) => setState(() => values['tripType'] = v),
              ),
              const _FilterLabel('价格区间（元/位）'),
              Row(
                children: [
                  Expanded(
                    child: _FilterInput(
                      label: '最低',
                      initial: _fenYuan(values['minPriceFen']),
                      onChanged: (v) => values['minPriceFen'] = v.isEmpty
                          ? ''
                          : '${_yuanToFen(v)}',
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _FilterInput(
                      label: '最高',
                      initial: _fenYuan(values['maxPriceFen']),
                      onChanged: (v) => values['maxPriceFen'] = v.isEmpty
                          ? ''
                          : '${_yuanToFen(v)}',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => setState(() => values.clear()),
                      child: const Text('重置'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton(
                      onPressed: () => Navigator.pop(context, values),
                      child: const Text('查看结果'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ActivityCard extends StatelessWidget {
  const _ActivityCard({
    required this.item,
    required this.onTap,
    this.captain = false,
    this.token,
  });
  final Map<String, dynamic> item;
  final VoidCallback onTap;
  final bool captain;
  final String? token;

  @override
  Widget build(BuildContext context) {
    final boat = _asMap(item['boat']);
    final photoKinds = _asMap(boat['photoKinds']);
    final showPhoto = photoKinds['exterior'] == true && token != null;
    final fish = _mapList(item['fishTargets']);
    return Material(
      color: FishingTokens.surface,
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Container(
          padding: const EdgeInsets.all(15),
          decoration: BoxDecoration(
            border: Border.all(color: FishingTokens.line),
            borderRadius: BorderRadius.circular(18),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      '${item['departureDate']}  ${item['departureTime']}',
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 15,
                      ),
                    ),
                  ),
                  _StatusPill(
                    label: _statusName(item['status']),
                    active: item['status'] == 'published',
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(14),
                    child: SizedBox(
                      width: 62,
                      height: 62,
                      child: showPhoto
                          ? Image.network(
                              '${Step1Api.baseUrl}/boats/${boat['id']}/photos/exterior',
                              headers: {'authorization': 'Bearer $token'},
                              fit: BoxFit.cover,
                              errorBuilder: (_, _, _) =>
                                  const _PhotoPlaceholder(),
                            )
                          : Container(
                              color: FishingTokens.surfaceTint,
                              child: const Icon(
                                Icons.directions_boat_filled_outlined,
                                color: FishingTokens.brand,
                                size: 28,
                              ),
                            ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${boat['name'] ?? '海上班次'}',
                          style: const TextStyle(
                            fontWeight: FontWeight.w800,
                            fontSize: 16,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '${item['captainName'] ?? '船长'} · ${boat['comfortLabel'] ?? '舒适度待核定'}',
                          style: _smallBody,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '${item['marinaName'] ?? ''} · ${item['targetAreaName'] ?? ''}',
                          style: _smallBody,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        _money(item['pricePerSeatFen']),
                        style: const TextStyle(
                          color: FishingTokens.brand,
                          fontSize: 18,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const Text(
                        '/位起',
                        style: TextStyle(
                          color: FishingTokens.muted,
                          fontSize: 10,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 6,
                runSpacing: 4,
                children: [
                  ...fish.map((target) => _Tag('${target['name']}')),
                  _Tag(
                    boat['lengthCm'] == null
                        ? '船'
                        : '${_metres(boat['lengthCm'])} 米船',
                  ),
                  _Tag(
                    '${item['bookedSeatCount'] ?? 0}/${item['platformQuotaSeats'] ?? item['totalSeatCount'] ?? 0} 平台位',
                  ),
                  if (item['manualSupply'] == true) const _Tag('人工确认供给'),
                  if (captain) _Tag(_tripTypeName(item['tripType'])),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      '最低成行 ${_money(item['minimumTotalFen'])} · 已订 ${item['bookedSeatCount'] ?? 0} 位',
                      style: _smallBody,
                    ),
                  ),
                  const Icon(
                    Icons.arrow_forward_ios_rounded,
                    size: 14,
                    color: FishingTokens.muted,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TripManagementCard extends StatelessWidget {
  const _TripManagementCard({
    required this.item,
    required this.onWithdraw,
    required this.onRepublish,
    required this.onOpen,
    required this.token,
  });
  final Map<String, dynamic> item;
  final VoidCallback onWithdraw;
  final VoidCallback onRepublish;
  final VoidCallback onOpen;
  final String token;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: FishingTokens.surface,
      border: Border.all(color: FishingTokens.line),
      borderRadius: BorderRadius.circular(18),
    ),
    child: Column(
      children: [
        _ActivityCard(item: item, token: token, onTap: onOpen, captain: true),
        const SizedBox(height: 10),
        Row(
          children: [
            if (item['status'] == 'published')
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: onWithdraw,
                  icon: const Icon(Icons.remove_circle_outline),
                  label: const Text('下架'),
                ),
              ),
            if (item['status'] == 'published') const SizedBox(width: 8),
            Expanded(
              child: FilledButton.tonalIcon(
                onPressed: onRepublish,
                icon: const Icon(Icons.copy_all_outlined),
                label: const Text('一键复发'),
              ),
            ),
          ],
        ),
      ],
    ),
  );
}

class _PricePanel extends StatelessWidget {
  const _PricePanel({
    required this.price,
    required this.premium,
    required this.seats,
  });
  final String price;
  final String premium;
  final String seats;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: FishingTokens.surfaceTint,
      borderRadius: BorderRadius.circular(18),
    ),
    child: Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('每位价格', style: _smallBody),
              const SizedBox(height: 3),
              Text(
                '$price / 位',
                maxLines: 1,
                softWrap: false,
                style: const TextStyle(
                  fontSize: 23,
                  fontWeight: FontWeight.w900,
                  color: FishingTokens.brand,
                ),
              ),
              Text('尾角位 $premium / 位', style: _smallBody),
            ],
          ),
        ),
        Container(width: 1, height: 48, color: FishingTokens.line),
        const SizedBox(width: 16),
        Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            const Text('平台专售席位', style: _smallBody),
            const SizedBox(height: 5),
            Text(
              '$seats 位',
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
            ),
            const Text(
              '暂无预订',
              style: TextStyle(fontSize: 11, color: FishingTokens.muted),
            ),
          ],
        ),
      ],
    ),
  );
}

class _SeatDiagram extends StatelessWidget {
  const _SeatDiagram({required this.seats, this.manualSupply = false});
  final List<Map<String, dynamic>> seats;
  final bool manualSupply;
  @override
  Widget build(BuildContext context) {
    if (seats.isEmpty) {
      return _NoteCard(
        icon: Icons.event_seat_outlined,
        title: manualSupply ? '平台未开放选位' : '钓位图待生成',
        body: manualSupply ? '本班次按人工确认供给，不提供在线选位。' : '本班次没有可展示的座位模板。',
      );
    }
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: FishingTokens.deepSurface,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        children: [
          const _Tag('船头 · BOW'),
          const SizedBox(height: 8),
          Wrap(
            alignment: WrapAlignment.center,
            spacing: 6,
            runSpacing: 6,
            children: seats
                .map(
                  (seat) => Container(
                    width: 48,
                    padding: const EdgeInsets.symmetric(vertical: 7),
                    decoration: BoxDecoration(
                      color: seat['premium'] == true
                          ? const Color(0xFF3C3524)
                          : FishingTokens.surface,
                      border: Border.all(
                        color: seat['premium'] == true
                            ? const Color(0xFFC49A53)
                            : FishingTokens.line,
                      ),
                      borderRadius: BorderRadius.circular(9),
                    ),
                    child: Column(
                      children: [
                        Text(
                          '${seat['number']}',
                          style: const TextStyle(fontWeight: FontWeight.w800),
                        ),
                        Text(
                          seat['premium'] == true ? '尾角' : '空位',
                          style: TextStyle(
                            fontSize: 9,
                            color: seat['premium'] == true
                                ? const Color(0xFFE1B96E)
                                : FishingTokens.muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                )
                .toList(),
          ),
          const SizedBox(height: 8),
          const Text(
            '船尾 · STERN   ·   尾角位价格可能不同',
            style: TextStyle(color: FishingTokens.muted, fontSize: 10),
          ),
        ],
      ),
    );
  }
}

class _DetailSection extends StatelessWidget {
  const _DetailSection({required this.title, required this.children});
  final String title;
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(top: 12),
    padding: const EdgeInsets.all(15),
    decoration: BoxDecoration(
      color: FishingTokens.surface,
      border: Border.all(color: FishingTokens.line),
      borderRadius: BorderRadius.circular(18),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 12),
        ...children
            .expand((child) => [child, const SizedBox(height: 10)])
            .toList()
          ..removeLast(),
      ],
    ),
  );
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({
    required this.icon,
    required this.label,
    required this.value,
  });
  final IconData icon;
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Icon(icon, size: 17, color: FishingTokens.brand),
      const SizedBox(width: 9),
      SizedBox(width: 88, child: Text(label, style: _smallBody)),
      Expanded(
        child: Text(
          value,
          style: const TextStyle(
            fontSize: 12,
            height: 1.45,
            color: FishingTokens.ink,
          ),
        ),
      ),
    ],
  );
}

class _BoatSummaryCard extends StatelessWidget {
  const _BoatSummaryCard({required this.boat});
  final Map<String, dynamic> boat;
  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 8),
    padding: const EdgeInsets.all(13),
    decoration: BoxDecoration(
      color: FishingTokens.surface,
      border: Border.all(color: FishingTokens.line),
      borderRadius: BorderRadius.circular(15),
    ),
    child: Row(
      children: [
        const CircleAvatar(
          backgroundColor: FishingTokens.surfaceTint,
          child: Icon(
            Icons.directions_boat_outlined,
            color: FishingTokens.brand,
          ),
        ),
        const SizedBox(width: 11),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${boat['name']}',
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
              Text(
                '${_metres(boat['lengthCm'])} 米 · ${boat['seatCount']} 位 · ${boat['comfortLabel']}',
                style: _smallBody,
              ),
            ],
          ),
        ),
        const Icon(
          Icons.verified_rounded,
          color: FishingTokens.success,
          size: 18,
        ),
      ],
    ),
  );
}

class _SearchLaunchCard extends StatelessWidget {
  const _SearchLaunchCard({required this.onTap});
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Material(
    color: FishingTokens.surfaceTint,
    borderRadius: BorderRadius.circular(20),
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: FishingTokens.line),
        ),
        child: Row(
          children: [
            Container(
              width: 46,
              height: 46,
              decoration: BoxDecoration(
                color: FishingTokens.brand,
                borderRadius: BorderRadius.circular(14),
              ),
              child: const Icon(
                Icons.search_rounded,
                color: FishingTokens.background,
              ),
            ),
            const SizedBox(width: 13),
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '找一班青岛出海活动',
                    style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
                  ),
                  SizedBox(height: 4),
                  Text('按鱼种、码头、船型和出发时间筛选', style: _smallBody),
                ],
              ),
            ),
            const Icon(
              Icons.arrow_forward_ios_rounded,
              size: 15,
              color: FishingTokens.secondary,
            ),
          ],
        ),
      ),
    ),
  );
}

class _FormSection extends StatelessWidget {
  const _FormSection({
    required this.title,
    required this.index,
    required this.children,
  });
  final String title, index;
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 12),
    padding: const EdgeInsets.all(15),
    decoration: BoxDecoration(
      color: FishingTokens.surface,
      border: Border.all(color: FishingTokens.line),
      borderRadius: BorderRadius.circular(18),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(
              index,
              style: const TextStyle(
                color: FishingTokens.brand,
                fontWeight: FontWeight.w800,
                fontSize: 12,
              ),
            ),
            const SizedBox(width: 9),
            Text(
              title,
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
            ),
          ],
        ),
        const SizedBox(height: 12),
        ...children
            .expand((child) => [child, const SizedBox(height: 9)])
            .toList()
          ..removeLast(),
      ],
    ),
  );
}

class _DropdownField<T> extends StatelessWidget {
  const _DropdownField({
    required this.label,
    required this.value,
    required this.values,
    required this.onChanged,
  });
  final String label;
  final T? value;
  final List<DropdownMenuItem<T>> values;
  final ValueChanged<T?> onChanged;
  @override
  Widget build(BuildContext context) => DropdownButtonFormField<T>(
    initialValue: values.any((item) => item.value == value) ? value : null,
    isExpanded: true,
    decoration: InputDecoration(labelText: label),
    items: values,
    onChanged: onChanged,
  );
}

class _OptionRow extends StatelessWidget {
  const _OptionRow({required this.label, required this.child});
  final String label;
  final Widget child;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label, style: _labelStyle),
      const SizedBox(height: 5),
      child,
    ],
  );
}

class _ChoiceChips extends StatelessWidget {
  const _ChoiceChips({
    required this.items,
    required this.value,
    required this.onChanged,
  });
  final List<Map<String, dynamic>> items;
  final String value;
  final ValueChanged<String> onChanged;
  @override
  Widget build(BuildContext context) => Wrap(
    spacing: 7,
    runSpacing: 2,
    children: items.map((item) {
      final code = '${item['code']}';
      return ChoiceChip(
        label: Text('${item['name']}'),
        selected: code == value,
        onSelected: (_) => onChanged(code),
      );
    }).toList(),
  );
}

class _MultiSelectChips extends StatelessWidget {
  const _MultiSelectChips({
    required this.label,
    required this.options,
    required this.selected,
    required this.onChanged,
  });
  final String label;
  final List<Map<String, dynamic>> options;
  final List<String> selected;
  final ValueChanged<List<String>> onChanged;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label, style: _labelStyle),
      const SizedBox(height: 5),
      Wrap(
        spacing: 6,
        children: options.map((entry) {
          final code = '${entry['code']}';
          return FilterChip(
            label: Text('${entry['name']}'),
            selected: selected.contains(code),
            onSelected: (checked) {
              final next = [...selected];
              checked ? next.add(code) : next.remove(code);
              onChanged(next);
            },
          );
        }).toList(),
      ),
    ],
  );
}

class _NumberField extends StatelessWidget {
  const _NumberField({
    required this.label,
    required this.controller,
    required this.suffix,
    required this.min,
    this.decimal = false,
  });
  final String label, suffix;
  final TextEditingController controller;
  final int min;
  final bool decimal;
  @override
  Widget build(BuildContext context) => TextFormField(
    controller: controller,
    keyboardType: TextInputType.numberWithOptions(decimal: decimal),
    decoration: InputDecoration(labelText: label, suffixText: suffix),
    validator: (value) {
      final parsed = num.tryParse(value ?? '');
      return parsed == null || parsed < min ? '请输入有效数值' : null;
    },
  );
}

class _TapField extends StatelessWidget {
  const _TapField({
    required this.label,
    required this.value,
    required this.icon,
    required this.onTap,
  });
  final String label, value;
  final IconData icon;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(12),
    child: InputDecorator(
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: Icon(icon, size: 18),
      ),
      child: Text(value, style: const TextStyle(fontWeight: FontWeight.w700)),
    ),
  );
}

class _FilterInput extends StatelessWidget {
  const _FilterInput({
    required this.label,
    required this.initial,
    required this.onChanged,
  });
  final String label, initial;
  final ValueChanged<String> onChanged;
  @override
  Widget build(BuildContext context) => TextFormField(
    initialValue: initial,
    keyboardType: const TextInputType.numberWithOptions(decimal: true),
    onChanged: onChanged,
    decoration: InputDecoration(labelText: label, prefixText: '¥ '),
  );
}

class _FilterLabel extends StatelessWidget {
  const _FilterLabel(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 13, bottom: 3),
    child: Text(text, style: _labelStyle),
  );
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label, required this.active});
  final String label;
  final bool active;
  @override
  Widget build(BuildContext context) {
    final color = active ? FishingTokens.success : FishingTokens.secondary;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .1),
        borderRadius: BorderRadius.circular(30),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _Tag extends StatelessWidget {
  const _Tag(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
    decoration: BoxDecoration(
      color: FishingTokens.surfaceTint,
      borderRadius: BorderRadius.circular(30),
    ),
    child: Text(
      text,
      style: const TextStyle(
        color: FishingTokens.secondary,
        fontSize: 10,
        fontWeight: FontWeight.w600,
      ),
    ),
  );
}

class _SectionEyebrow extends StatelessWidget {
  const _SectionEyebrow(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Text(
    text,
    style: const TextStyle(
      color: FishingTokens.brand,
      letterSpacing: 1.4,
      fontSize: 10,
      fontWeight: FontWeight.w800,
    ),
  );
}

class _SectionHeading extends StatelessWidget {
  const _SectionHeading({required this.title, this.trailing});
  final String title;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: Text(
          title,
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
        ),
      ),
      ?trailing,
    ],
  );
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value, required this.unit});
  final String label, value, unit;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label, style: _smallBody),
      const SizedBox(height: 5),
      Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(
            value,
            style: const TextStyle(
              fontSize: 21,
              fontWeight: FontWeight.w900,
              color: FishingTokens.ink,
            ),
          ),
          const SizedBox(width: 3),
          Padding(
            padding: const EdgeInsets.only(bottom: 3),
            child: Text(
              unit,
              style: const TextStyle(
                fontSize: 10,
                color: FishingTokens.secondary,
              ),
            ),
          ),
        ],
      ),
    ],
  );
}

class _NoteCard extends StatelessWidget {
  const _NoteCard({
    required this.icon,
    required this.title,
    required this.body,
    this.action,
  });
  final IconData icon;
  final String title, body;
  final Widget? action;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: FishingTokens.deepSurface,
      border: Border.all(color: FishingTokens.line),
      borderRadius: BorderRadius.circular(15),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, color: FishingTokens.brand, size: 19),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 13,
                ),
              ),
              const SizedBox(height: 4),
              Text(body, style: _smallBody),
              ?action,
            ],
          ),
        ),
      ],
    ),
  );
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({
    required this.icon,
    required this.title,
    required this.body,
  });
  final IconData icon;
  final String title, body;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(vertical: 23, horizontal: 16),
    decoration: BoxDecoration(
      color: FishingTokens.surface,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: FishingTokens.line),
    ),
    child: Column(
      children: [
        Icon(icon, color: FishingTokens.muted, size: 25),
        const SizedBox(height: 7),
        Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
        const SizedBox(height: 4),
        Text(body, textAlign: TextAlign.center, style: _smallBody),
      ],
    ),
  );
}

class _InlineError extends StatelessWidget {
  const _InlineError({required this.message, required this.onRetry});
  final String message;
  final Future<void> Function() onRetry;
  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(top: 8, bottom: 10),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: const Color(0xFF35211D),
      borderRadius: BorderRadius.circular(12),
    ),
    child: Row(
      children: [
        Expanded(
          child: Text(
            message,
            style: const TextStyle(color: Color(0xFFFFB2A4), fontSize: 12),
          ),
        ),
        TextButton(onPressed: onRetry, child: const Text('重试')),
      ],
    ),
  );
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({
    required this.message,
    required this.onRetry,
    this.onOpenProfile,
  });
  final String message;
  final Future<void> Function() onRetry;
  final VoidCallback? onOpenProfile;
  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.cloud_off_outlined,
            size: 32,
            color: FishingTokens.secondary,
          ),
          const SizedBox(height: 10),
          const Text(
            '暂时无法载入',
            style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 6),
          Text(message, textAlign: TextAlign.center, style: _bodyStyle),
          const SizedBox(height: 12),
          FilledButton.tonal(onPressed: onRetry, child: const Text('重试')),
          if (onOpenProfile != null)
            TextButton(onPressed: onOpenProfile, child: const Text('前往船长资料')),
        ],
      ),
    ),
  );
}

class _LoginPrompt extends StatelessWidget {
  const _LoginPrompt({required this.onOpenProfile});
  final VoidCallback onOpenProfile;
  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(26),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.sailing_outlined,
            size: 40,
            color: FishingTokens.brand,
          ),
          const SizedBox(height: 12),
          const Text(
            '登录后查看出海活动',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 6),
          const Text(
            '先完成手机号登录，才能浏览活动或发布班次。',
            textAlign: TextAlign.center,
            style: _bodyStyle,
          ),
          const SizedBox(height: 16),
          FilledButton(onPressed: onOpenProfile, child: const Text('前往登录与入驻')),
        ],
      ),
    ),
  );
}

class _PhotoPlaceholder extends StatelessWidget {
  const _PhotoPlaceholder();
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final compact = constraints.maxHeight < 90;
      return Container(
        color: FishingTokens.surfaceTint,
        child: compact
            ? const Center(
                child: Icon(
                  Icons.directions_boat_outlined,
                  size: 25,
                  color: FishingTokens.brand,
                ),
              )
            : const Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.directions_boat_outlined,
                    size: 34,
                    color: FishingTokens.brand,
                  ),
                  SizedBox(height: 7),
                  Text(
                    '船只实拍待补充',
                    style: TextStyle(
                      color: FishingTokens.secondary,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
      );
    },
  );
}

const _titleStyle = TextStyle(
  fontSize: 26,
  height: 1.1,
  fontWeight: FontWeight.w900,
  color: FishingTokens.ink,
);
const _bodyStyle = TextStyle(
  fontSize: 12,
  height: 1.45,
  color: FishingTokens.secondary,
);
const _smallBody = TextStyle(
  fontSize: 11,
  height: 1.4,
  color: FishingTokens.secondary,
);
const _labelStyle = TextStyle(
  fontSize: 11,
  color: FishingTokens.secondary,
  fontWeight: FontWeight.w600,
);
const _smallNote = TextStyle(
  fontSize: 10,
  height: 1.4,
  color: FishingTokens.muted,
);

List<Map<String, dynamic>> _mapList(dynamic value) => value is List
    ? value
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList()
    : <Map<String, dynamic>>[];
Map<String, dynamic> _asMap(dynamic value) =>
    value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
List<num> _numberList(dynamic value) =>
    value is List ? value.whereType<num>().toList() : <num>[];
String _money(dynamic fen) =>
    '¥${((fen is num ? fen : num.tryParse('$fen') ?? 0) / 100).toStringAsFixed(2)}';
int _yuanToFen(String value) =>
    ((double.tryParse(value.trim()) ?? 0) * 100).round();
String _fenYuan(String? fen) => fen == null || fen.isEmpty
    ? ''
    : ((int.tryParse(fen) ?? 0) / 100).toStringAsFixed(2);
String _metres(dynamic cm) =>
    cm is num ? (cm / 100).toStringAsFixed(cm % 100 == 0 ? 0 : 1) : '—';
String _two(int value) => value.toString().padLeft(2, '0');
String _dateAfter(int days) {
  final date = DateTime.now().add(Duration(days: days));
  return '${date.year}-${_two(date.month)}-${_two(date.day)}';
}

String _statusName(dynamic value) => switch (value) {
  'published' => '报名中',
  'withdrawn' => '已下架',
  'ended' => '已结束',
  _ => '待发布',
};
String _tripTypeName(dynamic value) => value == 'experience' ? '体验班' : '专业拼船';
String _facilityNames(dynamic value) =>
    value is List && value.isNotEmpty ? value.join('、') : '船档案未填写';
String _baitNames(dynamic value) => value is List
    ? value.map((item) => item is Map ? item['name'] : item).join('、')
    : '—';
String _formatDeadline(dynamic value) {
  final parsed = DateTime.tryParse('$value');
  final chinaTime = parsed?.toUtc().add(const Duration(hours: 8));
  return parsed == null
      ? '出航前'
      : '${_two(chinaTime!.hour)}:${_two(chinaTime.minute)}';
}
