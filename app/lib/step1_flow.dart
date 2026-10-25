import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import 'api_client.dart';
import 'fishing_tokens.dart';
import 'step5_flow.dart';

class Step1Workspace extends StatefulWidget {
  const Step1Workspace({
    required this.roleLabel,
    required this.tabLabel,
    required this.token,
    required this.onTokenChanged,
    required this.onOpenProfile,
    super.key,
  });

  final String roleLabel;
  final String tabLabel;
  final String? token;
  final ValueChanged<String?> onTokenChanged;
  final VoidCallback onOpenProfile;

  @override
  State<Step1Workspace> createState() => _Step1WorkspaceState();
}

class _Step1WorkspaceState extends State<Step1Workspace> {
  Map<String, dynamic>? _user;
  Map<String, dynamic>? _application;
  bool _loading = false;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  @override
  void didUpdateWidget(covariant Step1Workspace oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.token != widget.token ||
        oldWidget.roleLabel != widget.roleLabel) {
      _user = null;
      _application = null;
      _refresh();
    }
  }

  Future<void> _refresh() async {
    final token = widget.token;
    if (token == null) {
      if (mounted) {
        setState(() {
          _user = null;
          _application = null;
        });
      }
      return;
    }
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final me = await Step1Api.get('/account/me', token: token);
      Map<String, dynamic>? application;
      if (widget.roleLabel == '船长端') {
        final result = await Step1Api.get('/captain/application', token: token);
        final value = result['application'];
        application = value is Map<String, dynamic> ? value : null;
      }
      if (!mounted) return;
      setState(() {
        _user = me['user'] as Map<String, dynamic>;
        _application = application;
      });
    } catch (error) {
      if (!mounted) return;
      setState(
        () => _loadError = error.toString().replaceFirst('Exception: ', ''),
      );
      if (_loadError!.contains('登录已过期')) widget.onTokenChanged(null);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _logout() async {
    final token = widget.token;
    if (token == null) return;
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      await Step1Api.post('/auth/logout', const {}, token: token);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loadError = error.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
      return;
    }
    if (!mounted) return;
    widget.onTokenChanged(null);
    setState(() {
      _user = null;
      _application = null;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final isProfile = widget.tabLabel == '我的';
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 30),
      children: [
        _Eyebrow(
          label: isProfile ? 'ACCOUNT / PROFILE' : 'STEP 01 · ACCOUNT & BOAT',
        ),
        const SizedBox(height: 8),
        Text(
          isProfile
              ? '账号与入驻'
              : (widget.roleLabel == '船长端' ? '船长资料先建好' : '和靠谱船长一起出海'),
          style: const TextStyle(
            fontSize: 25,
            fontWeight: FontWeight.w900,
            color: FishingTokens.ink,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          isProfile ? '完成实名后，可提交船长资质与船档案。' : '手机号登录、实名核验与船档案审核，都在这里完成。',
          style: const TextStyle(fontSize: 13, color: FishingTokens.secondary),
        ),
        const SizedBox(height: 20),
        if (!isProfile && widget.tabLabel != '首页')
          _InfoCard(
            icon: Icons.anchor_outlined,
            title: '${widget.tabLabel} · 第 2 步开放',
            body: '现在可以先完成账号与船长档案。活动、发班和交易会在后续步骤接入。',
            action: OutlinedButton.icon(
              onPressed: widget.onOpenProfile,
              icon: const Icon(Icons.person_outline),
              label: const Text('前往账号与入驻'),
            ),
          )
        else if (widget.token == null)
          _LoginCard(
            onLogin: (token, user) {
              _user = user;
              widget.onTokenChanged(token);
              _refresh();
            },
          )
        else if (_loading && _user == null)
          const Center(
            child: Padding(
              padding: EdgeInsets.all(36),
              child: CircularProgressIndicator(),
            ),
          )
        else if (_loadError != null && _user == null)
          _InfoCard(
            icon: Icons.cloud_off_outlined,
            title: '暂时无法读取账号',
            body: _loadError!,
            action: FilledButton(onPressed: _refresh, child: const Text('重试')),
          )
        else if (_user != null) ...[
          _AccountCard(user: _user!, onLogout: _logout),
          const SizedBox(height: 14),
          if (_user!['identityStatus'] != 'verified')
            _IdentityCard(
              status: _user!['identityStatus'] as String? ?? 'not_submitted',
              rejectionReason: _user!['identityRejectionReason'] as String?,
              token: widget.token!,
              onSubmitted: _refresh,
            )
          else if (widget.roleLabel == '船长端')
            _captainContent()
          else
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const _InfoCard(
                  icon: Icons.verified_user_outlined,
                  title: '实名已验证',
                  body: '账号已完成沙盒核验。切换到船长端可继续提交入驻资料。',
                  action: Text(
                    '实名认证状态已同步',
                    style: TextStyle(
                      color: FishingTokens.success,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => Step5FishAtlasPage(token: widget.token!),
                    ),
                  ),
                  icon: const Icon(Icons.phishing_outlined),
                  label: const Text('我的鱼种图鉴'),
                ),
              ],
            ),
        ],
        if (_loadError != null && _user != null) ...[
          const SizedBox(height: 10),
          Text(_loadError!, style: const TextStyle(color: Color(0xFFE17E70))),
        ],
        if (_user != null && _loading)
          const LinearProgressIndicator(minHeight: 2),
      ],
    );
  }

  Widget _captainContent() {
    if (_loadError != null) {
      return _InfoCard(
        icon: Icons.cloud_off_outlined,
        title: '暂时无法读取船档案状态',
        body: _loadError!,
        action: OutlinedButton.icon(
          onPressed: _refresh,
          icon: const Icon(Icons.refresh),
          label: const Text('刷新审核状态'),
        ),
      );
    }
    if (_application == null || _application!['status'] == 'rejected') {
      return _CaptainApplicationForm(
        token: widget.token!,
        rejectionReason: _application?['rejectionReason'] as String?,
        onSubmitted: _refresh,
      );
    }
    final boat = _application!['boat'] as Map<String, dynamic>? ?? {};
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _ApplicationStatusCard(
          application: _application!,
          onRefresh: _refresh,
          isRefreshing: _loading,
        ),
        if (_application!['status'] == 'approved' && boat['id'] != null) ...[
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => Step5BoatFactsPage(boatId: '${boat['id']}'),
              ),
            ),
            icon: const Icon(Icons.directions_boat_outlined),
            label: const Text('查看船况事实'),
          ),
        ],
      ],
    );
  }
}

class _LoginCard extends StatefulWidget {
  const _LoginCard({required this.onLogin});
  final void Function(String token, Map<String, dynamic> user) onLogin;

  @override
  State<_LoginCard> createState() => _LoginCardState();
}

class _LoginCardState extends State<_LoginCard> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  bool _busy = false;
  String? _hint;
  String? _error;

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _sendCode() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await Step1Api.post('/auth/code', {
        'phone': _phone.text.trim(),
      });
      final code = result['sandboxCode'] as String?;
      if (code != null) _code.text = code;
      setState(
        () =>
            _hint = code == null ? '验证码已发送，5 分钟内有效。' : '本地沙盒验证码：$code（仅开发环境显示）',
      );
    } catch (error) {
      setState(() => _error = error.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _login() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await Step1Api.post('/auth/register', {
        'phone': _phone.text.trim(),
        'code': _code.text.trim(),
      });
      widget.onLogin(
        result['token'] as String,
        result['user'] as Map<String, dynamic>,
      );
    } catch (error) {
      setState(() => _error = error.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => _Panel(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _CardHeading(
          icon: Icons.phone_iphone,
          title: '手机号登录 / 注册',
          tag: '01',
        ),
        const SizedBox(height: 16),
        TextField(
          controller: _phone,
          keyboardType: TextInputType.phone,
          decoration: const InputDecoration(
            labelText: '手机号',
            hintText: '本地沙盒：16600000xxx',
          ),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _code,
                keyboardType: TextInputType.number,
                maxLength: 6,
                decoration: const InputDecoration(
                  labelText: '短信验证码',
                  counterText: '',
                ),
              ),
            ),
            const SizedBox(width: 10),
            OutlinedButton(
              onPressed: _busy ? null : _sendCode,
              child: const Text('获取验证码'),
            ),
          ],
        ),
        if (_hint != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              _hint!,
              style: const TextStyle(
                color: FishingTokens.success,
                fontSize: 12,
              ),
            ),
          ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              _error!,
              style: const TextStyle(color: Color(0xFFE17E70), fontSize: 12),
            ),
          ),
        const SizedBox(height: 14),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed: _busy ? null : _login,
            child: Text(_busy ? '请稍候…' : '登录并创建账号'),
          ),
        ),
        const SizedBox(height: 8),
        const Text(
          '此演示只接受专用测试手机号，验证码不会发送到真实手机。',
          style: TextStyle(color: FishingTokens.muted, fontSize: 11),
        ),
      ],
    ),
  );
}

class _AccountCard extends StatelessWidget {
  const _AccountCard({required this.user, required this.onLogout});
  final Map<String, dynamic> user;
  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) => _Panel(
    child: Row(
      children: [
        Container(
          width: 46,
          height: 46,
          decoration: const BoxDecoration(
            color: FishingTokens.surfaceTint,
            shape: BoxShape.circle,
          ),
          child: const Icon(Icons.person_outline, color: FishingTokens.brand),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                user['displayName'] as String? ?? '钓友',
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                ),
              ),
              Text(
                '账号已登录 · ${_identityLabel(user['identityStatus'] as String?)}',
                style: const TextStyle(
                  color: FishingTokens.secondary,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),
        IconButton(
          tooltip: '退出登录',
          onPressed: onLogout,
          icon: const Icon(
            Icons.logout_outlined,
            size: 19,
            color: FishingTokens.secondary,
          ),
        ),
      ],
    ),
  );
}

class _IdentityCard extends StatefulWidget {
  const _IdentityCard({
    required this.status,
    required this.rejectionReason,
    required this.token,
    required this.onSubmitted,
  });
  final String status;
  final String? rejectionReason;
  final String token;
  final VoidCallback onSubmitted;

  @override
  State<_IdentityCard> createState() => _IdentityCardState();
}

class _IdentityCardState extends State<_IdentityCard> {
  final _name = TextEditingController();
  final _identity = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _identity.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await Step1Api.post('/identity', {
        'legalName': _name.text.trim(),
        'identityNumber': _identity.text.trim(),
      }, token: widget.token);
      widget.onSubmitted();
    } catch (error) {
      setState(() => _error = error.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => _Panel(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _CardHeading(
          icon: Icons.verified_user_outlined,
          title: '实名认证',
          tag: _identityLabel(widget.status),
        ),
        const SizedBox(height: 7),
        Text(
          _identityCopy(widget.status),
          style: const TextStyle(color: FishingTokens.secondary, fontSize: 12),
        ),
        if (widget.rejectionReason != null)
          Padding(
            padding: const EdgeInsets.only(top: 7),
            child: Text(
              widget.rejectionReason!,
              style: const TextStyle(color: Color(0xFFE9A08F), fontSize: 12),
            ),
          ),
        const SizedBox(height: 12),
        TextField(
          controller: _name,
          textCapitalization: TextCapitalization.words,
          decoration: const InputDecoration(labelText: '真实姓名'),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _identity,
          textCapitalization: TextCapitalization.characters,
          decoration: const InputDecoration(
            labelText: '身份证号',
            hintText: '仅接受 990000 开头的沙盒号段',
          ),
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              _error!,
              style: const TextStyle(color: Color(0xFFE17E70), fontSize: 12),
            ),
          ),
        const SizedBox(height: 12),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed: _busy ? null : _submit,
            child: Text(_busy ? '核验中…' : '提交实名核验'),
          ),
        ),
        const SizedBox(height: 6),
        const Text(
          '姓名与证件号使用 AES-256-GCM 加密存储；测试身份资料不对应真实人员。',
          style: TextStyle(color: FishingTokens.muted, fontSize: 11),
        ),
      ],
    ),
  );
}

class _CaptainApplicationForm extends StatefulWidget {
  const _CaptainApplicationForm({
    required this.token,
    required this.rejectionReason,
    required this.onSubmitted,
  });
  final String token;
  final String? rejectionReason;
  final VoidCallback onSubmitted;

  @override
  State<_CaptainApplicationForm> createState() =>
      _CaptainApplicationFormState();
}

class _CaptainApplicationFormState extends State<_CaptainApplicationForm> {
  static const _photoLabels = {
    'exterior': '船只外观',
    'deck': '甲板',
    'cabin': '船舱',
    'toilet': '厕所',
    'certificate': '船长资质证件',
  };
  static const _facilityLabels = {
    'toilet': '厕所',
    'cabin': '船舱',
    'live_fish_well': '活鱼舱',
    'fish_finder': '鱼探',
    'air_conditioning': '空调',
    'night_fishing_lights': '夜钓灯',
  };
  static const _marinas = {
    'xiaogang': '小港',
    'jimiya': '积米崖',
    'shazikou': '沙子口',
    'tianheng': '田横',
    'hongdao': '红岛',
    'zhonggang': '中港',
  };
  final _picker = ImagePicker();
  final _captainName = TextEditingController();
  final _licenseNumber = TextEditingController();
  final _boatName = TextEditingController();
  final _length = TextEditingController(text: '1300');
  final _registration = TextEditingController();
  final Map<String, XFile> _picked = {};
  final Map<String, String> _uploaded = {};
  final Set<String> _facilities = {};
  String _marina = 'xiaogang';
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _captainName.dispose();
    _licenseNumber.dispose();
    _boatName.dispose();
    _length.dispose();
    _registration.dispose();
    super.dispose();
  }

  String _contentType(XFile file) {
    final type = file.mimeType?.toLowerCase();
    if (type == 'image/jpeg' || type == 'image/png' || type == 'image/webp') {
      return type!;
    }
    final name = file.name.toLowerCase();
    if (name.endsWith('.png')) return 'image/png';
    if (name.endsWith('.webp')) return 'image/webp';
    return 'image/jpeg';
  }

  Future<void> _choose(String kind) async {
    try {
      final file = await _picker.pickImage(
        source: ImageSource.gallery,
        imageQuality: 90,
        maxWidth: 2400,
      );
      if (file == null) return;
      if (await file.length() > 5 * 1024 * 1024) {
        throw Exception('请选用 5 MB 以内的图片');
      }
      setState(() {
        _picked[kind] = file;
        _uploaded.remove(kind);
        _error = null;
      });
      final bytes = await file.readAsBytes();
      final result = await Step1Api.post('/uploads', {
        'kind': kind,
        'contentType': _contentType(file),
        'base64': base64Encode(bytes),
      }, token: widget.token);
      if (!mounted) return;
      setState(() => _uploaded[kind] = result['objectUri'] as String);
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = error.toString().replaceFirst('Exception: ', ''),
        );
      }
    }
  }

  Future<void> _submit() async {
    final requiredPhotos = [
      'exterior',
      'deck',
      'cabin',
      'toilet',
      'certificate',
    ];
    if (!requiredPhotos.every(_uploaded.containsKey)) {
      setState(() => _error = '请先完成四类船照和船长资质照片上传');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final response = await Step1Api.post('/captain/application', {
        'captainName': _captainName.text.trim(),
        'licenseNumber': _licenseNumber.text.trim(),
        'boatName': _boatName.text.trim(),
        'lengthCm': int.tryParse(_length.text.trim()),
        'registrationNumber': _registration.text.trim(),
        'homeMarinaCode': _marina,
        'facilities': _facilities.toList(),
        'certificateUri': _uploaded['certificate'],
        'photos': {
          for (final kind in ['exterior', 'deck', 'cabin', 'toilet'])
            kind: _uploaded[kind],
        },
      }, token: widget.token);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            response['templateStatus'] == 'ready'
                ? '申请已提交 · 已生成 12 位钓位模板'
                : '申请已提交 · 钓位模板待人工核定',
          ),
        ),
      );
      widget.onSubmitted();
    } catch (error) {
      setState(() => _error = error.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => _Panel(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _CardHeading(
          icon: Icons.sailing_outlined,
          title: '船长入驻与船档案',
          tag: widget.rejectionReason == null ? '02 · 提交审核' : '补充后重提',
        ),
        if (widget.rejectionReason != null) ...[
          const SizedBox(height: 9),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFF3B211E),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              '上次驳回：${widget.rejectionReason}',
              style: const TextStyle(color: Color(0xFFFFB9A7), fontSize: 12),
            ),
          ),
        ],
        const SizedBox(height: 14),
        const _FieldCaption('船长资料'),
        const SizedBox(height: 6),
        TextField(
          controller: _captainName,
          decoration: const InputDecoration(labelText: '船长姓名（加密保存）'),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _licenseNumber,
          decoration: const InputDecoration(labelText: '船长资质编号（加密保存）'),
        ),
        const SizedBox(height: 13),
        const _FieldCaption('船只资料'),
        const SizedBox(height: 6),
        TextField(
          controller: _boatName,
          decoration: const InputDecoration(labelText: '船名'),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _length,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: '船长（厘米）'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: TextField(
                controller: _registration,
                decoration: const InputDecoration(labelText: '船舶登记号（加密保存）'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        DropdownButtonFormField<String>(
          initialValue: _marina,
          decoration: const InputDecoration(labelText: '默认集合码头'),
          items: _marinas.entries
              .map(
                (entry) => DropdownMenuItem(
                  value: entry.key,
                  child: Text(entry.value),
                ),
              )
              .toList(),
          onChanged: (value) {
            if (value != null) setState(() => _marina = value);
          },
        ),
        const SizedBox(height: 14),
        const _FieldCaption('船上设施 · 可多选'),
        const SizedBox(height: 8),
        Wrap(
          spacing: 7,
          runSpacing: 3,
          children: _facilityLabels.entries
              .map(
                (entry) => FilterChip(
                  label: Text(entry.value),
                  selected: _facilities.contains(entry.key),
                  onSelected: (selected) => setState(() {
                    selected
                        ? _facilities.add(entry.key)
                        : _facilities.remove(entry.key);
                  }),
                ),
              )
              .toList(),
        ),
        const SizedBox(height: 14),
        const _FieldCaption('照片上传 · 图片不超过 5 MB'),
        const SizedBox(height: 8),
        ..._photoLabels.entries.map(
          (entry) => _PhotoPickerRow(
            label: entry.value,
            file: _picked[entry.key],
            uploaded: _uploaded.containsKey(entry.key),
            onPick: () => _choose(entry.key),
          ),
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              _error!,
              style: const TextStyle(color: Color(0xFFE17E70), fontSize: 12),
            ),
          ),
        const SizedBox(height: 15),
        const Text(
          '提交后，平台自动生成适用船型的钓位模板并按船长估算舒适度。模板与舒适度不可手动编辑。',
          style: TextStyle(
            color: FishingTokens.muted,
            fontSize: 11,
            height: 1.5,
          ),
        ),
        const SizedBox(height: 12),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed: _busy ? null : _submit,
            child: Text(_busy ? '提交中…' : '提交资质与船档案'),
          ),
        ),
      ],
    ),
  );
}

class _ApplicationStatusCard extends StatelessWidget {
  const _ApplicationStatusCard({
    required this.application,
    required this.onRefresh,
    required this.isRefreshing,
  });
  final Map<String, dynamic> application;
  final VoidCallback onRefresh;
  final bool isRefreshing;

  @override
  Widget build(BuildContext context) {
    final boat = application['boat'] as Map<String, dynamic>;
    final status = application['status'] as String? ?? 'pending';
    return _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _CardHeading(
            icon: status == 'approved'
                ? Icons.verified_outlined
                : Icons.hourglass_top,
            title: '我的船档案',
            tag: _applicationLabel(status),
          ),
          const SizedBox(height: 8),
          Text(
            '${boat['name']} · ${(boat['lengthCm'] as num) / 100} 米',
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 5),
          Text(
            '集合码头：${_marinaLabel(boat['homeMarinaCode'] as String?)}',
            style: const TextStyle(
              color: FishingTokens.secondary,
              fontSize: 12,
            ),
          ),
          if (status == 'pending')
            const Padding(
              padding: EdgeInsets.only(top: 12),
              child: Text(
                '平台正在审核船长资质与船舶资料。通过或驳回后会在此显示结果。',
                style: TextStyle(color: FishingTokens.secondary, fontSize: 12),
              ),
            ),
          if (status == 'approved') ...[
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: _Metric(
                    label: '钓位模板',
                    value: boat['seatCount'] == null
                        ? '待人工核定'
                        : '${boat['seatCount']} 位',
                  ),
                ),
                const SizedBox(width: 9),
                Expanded(
                  child: _Metric(
                    label: '舒适度',
                    value: _comfortLabel(boat['comfortLevel'] as String?),
                  ),
                ),
              ],
            ),
            if (boat['seatLayout'] is List) ...[
              const SizedBox(height: 13),
              SeatTemplateView(
                layout: (boat['seatLayout'] as List)
                    .cast<Map<String, dynamic>>(),
              ),
            ],
            const SizedBox(height: 9),
            Text(
              '间距估算 ${boat['estimatedSpacingCm'] ?? '—'} cm / 位 · 平台计算，只读',
              style: const TextStyle(color: FishingTokens.muted, fontSize: 11),
            ),
          ],
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: isRefreshing ? null : onRefresh,
            icon: const Icon(Icons.refresh, size: 17),
            label: Text(isRefreshing ? '正在刷新…' : '刷新审核状态'),
          ),
        ],
      ),
    );
  }
}

class SeatTemplateView extends StatelessWidget {
  const SeatTemplateView({required this.layout, super.key});
  final List<Map<String, dynamic>> layout;

  @override
  Widget build(BuildContext context) {
    final byNumber = {for (final seat in layout) seat['number'] as int: seat};
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 14),
      decoration: BoxDecoration(
        color: FishingTokens.deepSurface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: FishingTokens.line),
      ),
      child: Column(
        children: [
          const Text(
            '船头',
            style: TextStyle(
              color: FishingTokens.muted,
              fontSize: 10,
              letterSpacing: 1.1,
            ),
          ),
          const SizedBox(height: 8),
          ...List.generate(6, (row) {
            final portNumber = row + 1;
            final starboardNumber = 12 - row;
            return Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  _SeatBadge(
                    number: portNumber,
                    premium: byNumber[portNumber]?['premium'] == true,
                  ),
                  const SizedBox(width: 7),
                  Container(
                    width: 92,
                    height: 32,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: FishingTokens.surface,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: row == 0
                        ? const Text(
                            '船头区',
                            style: TextStyle(
                              color: FishingTokens.muted,
                              fontSize: 10,
                            ),
                          )
                        : row == 5
                        ? const Text(
                            '船尾区',
                            style: TextStyle(
                              color: FishingTokens.muted,
                              fontSize: 10,
                            ),
                          )
                        : const Text(
                            '过道区',
                            style: TextStyle(
                              color: FishingTokens.muted,
                              fontSize: 10,
                            ),
                          ),
                  ),
                  const SizedBox(width: 7),
                  _SeatBadge(
                    number: starboardNumber,
                    premium: byNumber[starboardNumber]?['premium'] == true,
                  ),
                ],
              ),
            );
          }),
          const SizedBox(height: 4),
          const Text(
            '船尾 · 5 / 6 / 7 / 8 为加价位',
            style: TextStyle(color: FishingTokens.secondary, fontSize: 10),
          ),
        ],
      ),
    );
  }
}

class _SeatBadge extends StatelessWidget {
  const _SeatBadge({required this.number, required this.premium});
  final int number;
  final bool premium;

  @override
  Widget build(BuildContext context) => Container(
    width: 35,
    height: 32,
    alignment: Alignment.center,
    decoration: BoxDecoration(
      color: premium ? FishingTokens.brand : FishingTokens.surfaceTint,
      borderRadius: BorderRadius.circular(8),
      border: Border.all(
        color: premium ? FishingTokens.brand : FishingTokens.line,
      ),
    ),
    child: Text(
      '$number',
      style: TextStyle(
        color: premium ? FishingTokens.background : FishingTokens.ink,
        fontSize: 12,
        fontWeight: FontWeight.w800,
      ),
    ),
  );
}

class _PhotoPickerRow extends StatelessWidget {
  const _PhotoPickerRow({
    required this.label,
    required this.file,
    required this.uploaded,
    required this.onPick,
  });
  final String label;
  final XFile? file;
  final bool uploaded;
  final VoidCallback onPick;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: InkWell(
      onTap: onPick,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        height: 64,
        padding: const EdgeInsets.symmetric(horizontal: 10),
        decoration: BoxDecoration(
          color: FishingTokens.deepSurface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: FishingTokens.line),
        ),
        child: Row(
          children: [
            Container(
              width: 42,
              height: 42,
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(
                color: FishingTokens.surface,
                borderRadius: BorderRadius.circular(8),
              ),
              child: file == null
                  ? const Icon(
                      Icons.add_a_photo_outlined,
                      color: FishingTokens.muted,
                      size: 18,
                    )
                  : FutureBuilder<Uint8List>(
                      future: file!.readAsBytes(),
                      builder: (context, snapshot) => snapshot.hasData
                          ? Image.memory(snapshot.data!, fit: BoxFit.cover)
                          : const Icon(
                              Icons.image_outlined,
                              color: FishingTokens.muted,
                            ),
                    ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                label,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            Text(
              uploaded
                  ? '已上传'
                  : file == null
                  ? '选择照片'
                  : '上传中 / 点击重选',
              style: TextStyle(
                color: uploaded
                    ? FishingTokens.success
                    : FishingTokens.secondary,
                fontSize: 11,
              ),
            ),
            const SizedBox(width: 7),
            Icon(
              uploaded ? Icons.check_circle : Icons.chevron_right,
              size: 17,
              color: uploaded ? FishingTokens.success : FishingTokens.secondary,
            ),
          ],
        ),
      ),
    ),
  );
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({
    required this.icon,
    required this.title,
    required this.body,
    required this.action,
  });
  final IconData icon;
  final String title;
  final String body;
  final Widget action;

  @override
  Widget build(BuildContext context) => _Panel(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _CardHeading(icon: icon, title: title, tag: ''),
        const SizedBox(height: 8),
        Text(
          body,
          style: const TextStyle(
            color: FishingTokens.secondary,
            fontSize: 12,
            height: 1.5,
          ),
        ),
        const SizedBox(height: 10),
        action,
      ],
    ),
  );
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value});
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(11),
    decoration: BoxDecoration(
      color: FishingTokens.deepSurface,
      borderRadius: BorderRadius.circular(12),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(color: FishingTokens.muted, fontSize: 10),
        ),
        const SizedBox(height: 4),
        Text(
          value,
          style: const TextStyle(
            color: FishingTokens.brand,
            fontWeight: FontWeight.w800,
            fontSize: 14,
          ),
        ),
      ],
    ),
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
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: FishingTokens.line),
    ),
    child: child,
  );
}

class _Eyebrow extends StatelessWidget {
  const _Eyebrow({required this.label});
  final String label;
  @override
  Widget build(BuildContext context) => Text(
    label,
    style: const TextStyle(
      color: FishingTokens.brand,
      fontSize: 10,
      fontWeight: FontWeight.w800,
      letterSpacing: 1.5,
    ),
  );
}

class _CardHeading extends StatelessWidget {
  const _CardHeading({
    required this.icon,
    required this.title,
    required this.tag,
  });
  final IconData icon;
  final String title;
  final String tag;
  @override
  Widget build(BuildContext context) => Row(
    children: [
      Icon(icon, color: FishingTokens.brand, size: 19),
      const SizedBox(width: 8),
      Expanded(
        child: Text(
          title,
          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
        ),
      ),
      if (tag.isNotEmpty)
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
          decoration: BoxDecoration(
            color: FishingTokens.surfaceTint,
            borderRadius: BorderRadius.circular(99),
          ),
          child: Text(
            tag,
            style: const TextStyle(
              color: FishingTokens.brand,
              fontSize: 10,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
    ],
  );
}

class _FieldCaption extends StatelessWidget {
  const _FieldCaption(this.label);
  final String label;
  @override
  Widget build(BuildContext context) => Text(
    label,
    style: const TextStyle(
      color: FishingTokens.secondary,
      fontWeight: FontWeight.w700,
      fontSize: 12,
    ),
  );
}

String _identityLabel(String? status) => switch (status) {
  'pending' => '审核中',
  'verified' => '已验证',
  'rejected' => '需补充',
  _ => '未提交',
};
String _identityCopy(String status) => switch (status) {
  'pending' => '实名资料正在沙盒核验。',
  'rejected' => '资料未通过，请按提示更正后重新提交。',
  _ => '输入姓名与身份证号码。当前仅支持专用测试号段。',
};
String _applicationLabel(String status) => switch (status) {
  'approved' => '审核通过',
  'rejected' => '需修改后重提',
  _ => '审核中',
};
String _comfortLabel(String? value) => switch (value) {
  'spacious' => '宽松',
  'comfortable' => '舒适',
  'compact' => '紧凑',
  _ => '待人工核定',
};
String _marinaLabel(String? value) =>
    const {
      'xiaogang': '小港',
      'jimiya': '积米崖',
      'shazikou': '沙子口',
      'tianheng': '田横',
      'hongdao': '红岛',
      'zhonggang': '中港',
    }[value] ??
    '未设置';
