import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';

import 'api_client.dart';
import 'fishing_tokens.dart';

Map<String, dynamic> _certificateMap(Object? value) =>
    value is Map<String, dynamic> ? value : <String, dynamic>{};

List<Map<String, dynamic>> _certificateMaps(Object? value) => value is List
    ? value.whereType<Map<String, dynamic>>().toList()
    : <Map<String, dynamic>>[];

class Step6CertificateCenterPage extends StatefulWidget {
  const Step6CertificateCenterPage({
    required this.token,
    required this.onRequireLogin,
    this.shareImage,
    this.imageEncoder,
    super.key,
  });

  final String? token;
  final VoidCallback onRequireLogin;
  final Future<void> Function(ShareParams params)? shareImage;
  final Future<Uint8List?> Function(RenderRepaintBoundary boundary)?
  imageEncoder;

  @override
  State<Step6CertificateCenterPage> createState() =>
      _Step6CertificateCenterPageState();
}

class _Step6CertificateCenterPageState
    extends State<Step6CertificateCenterPage> {
  List<Map<String, dynamic>> _certificates = [];
  List<Map<String, dynamic>> _eligible = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant Step6CertificateCenterPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.token != widget.token) _load();
  }

  Future<void> _load() async {
    final token = widget.token;
    if (token == null) {
      if (mounted) {
        setState(() {
          _certificates = [];
          _eligible = [];
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
      final result = await Step1Api.get('/step6/certificates/me', token: token);
      if (!mounted) return;
      setState(() {
        _certificates = _certificateMaps(result['certificates']);
        _eligible = _certificateMaps(result['eligibleDepartures']);
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

  Future<void> _openPreview(Map<String, dynamic> trip) async {
    final token = widget.token;
    if (token == null) return widget.onRequireLogin();
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute<bool>(
        builder: (_) => Step6CertificatePreviewPage(
          departureId: '${trip['departureId']}',
          token: token,
          shareImage: widget.shareImage,
          imageEncoder: widget.imageEncoder,
        ),
      ),
    );
    if (changed == true) _load();
  }

  Future<void> _openCertificate(Map<String, dynamic> certificate) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => Step6CertificatePreviewPage(
          token: widget.token ?? '',
          departureId: '',
          initialCertificate: certificate,
        ),
      ),
    );
  }

  Future<void> _hideCertificate(Map<String, dynamic> certificate) async {
    final token = widget.token;
    if (token == null) return;
    try {
      await Step1Api.delete(
        '/step6/certificates/${certificate['id']}',
        token: token,
      );
      if (mounted) _load();
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
    return Scaffold(
      appBar: AppBar(title: const Text('我的证书')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : widget.token == null
          ? _CertificateEmptyState(
              icon: Icons.lock_outline,
              title: '登录后查看渔获证书',
              detail: '证书只属于本人已完成航次的实名乘客账号。',
              action: '去登录',
              onPressed: widget.onRequireLogin,
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(18, 10, 18, 28),
                children: [
                  const Text(
                    '渔获纪念证',
                    style: TextStyle(fontSize: 26, fontWeight: FontWeight.w900),
                  ),
                  const SizedBox(height: 5),
                  const Text(
                    '只从已完成航次的渔获事实生成，核对中的记录不会进入证书。',
                    style: TextStyle(
                      color: FishingTokens.secondary,
                      height: 1.5,
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    _CertificateNotice(text: _error!),
                  ],
                  const SizedBox(height: 22),
                  const _CertificateSectionTitle(title: '可生成的航次'),
                  const SizedBox(height: 10),
                  if (_eligible.isEmpty)
                    const _CertificateEmptyCard(
                      title: '暂时没有可生成的证书',
                      detail: '完成航次并有可用的本人渔获记录后，会显示在这里。',
                    )
                  else
                    ..._eligible.map(
                      (trip) => Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: _EligibleTripCard(
                          trip: trip,
                          onPressed: () => _openPreview(trip),
                        ),
                      ),
                    ),
                  const SizedBox(height: 14),
                  const _CertificateSectionTitle(title: '已生成'),
                  const SizedBox(height: 10),
                  if (_certificates.isEmpty)
                    const _CertificateEmptyCard(
                      title: '还没有证书',
                      detail: '生成后可在这里查看冻结的证书快照。',
                    )
                  else
                    ..._certificates.map(
                      (certificate) => Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: _SavedCertificateCard(
                          certificate: certificate,
                          onOpen: () => _openCertificate(certificate),
                          onHide: () => _hideCertificate(certificate),
                        ),
                      ),
                    ),
                ],
              ),
            ),
    );
  }
}

class Step6CertificatePreviewPage extends StatefulWidget {
  const Step6CertificatePreviewPage({
    required this.departureId,
    required this.token,
    this.initialCertificate,
    this.shareImage,
    this.imageEncoder,
    super.key,
  });

  final String departureId;
  final String token;
  final Map<String, dynamic>? initialCertificate;
  final Future<void> Function(ShareParams params)? shareImage;
  final Future<Uint8List?> Function(RenderRepaintBoundary boundary)?
  imageEncoder;

  @override
  State<Step6CertificatePreviewPage> createState() =>
      _Step6CertificatePreviewPageState();
}

class _Step6CertificatePreviewPageState
    extends State<Step6CertificatePreviewPage> {
  final GlobalKey _certificateKey = GlobalKey();
  Map<String, dynamic> _snapshot = {};
  String? _certificateId;
  bool _loading = true;
  bool _generating = false;
  bool _sharing = false;
  bool _createdCertificate = false;
  bool _allowGeneratedCertificatePop = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final initial = widget.initialCertificate;
    if (initial != null) {
      _certificateId = initial['id']?.toString();
      _snapshot = _certificateMap(initial['snapshot']);
      _loading = false;
    } else {
      _load();
    }
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await Step1Api.get(
        '/step6/certificates/departures/${widget.departureId}/preview',
        token: widget.token,
      );
      final certificate = _certificateMap(result['certificate']);
      if (!mounted) return;
      setState(() {
        _certificateId = certificate['id']?.toString();
        _snapshot = _certificateMap(
          result['preview'] ?? certificate['snapshot'],
        );
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

  Future<void> _generate() async {
    if (_generating || _certificateId != null) return;
    setState(() {
      _generating = true;
      _error = null;
    });
    try {
      final result = await Step1Api.post('/step6/certificates', {
        'departureId': widget.departureId,
      }, token: widget.token);
      final certificate = _certificateMap(result['certificate']);
      if (!mounted) return;
      setState(() {
        _certificateId = certificate['id']?.toString();
        _snapshot = _certificateMap(certificate['snapshot']);
        _createdCertificate = _certificateId != null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _generating = false);
    }
  }

  Future<Uint8List?> _encode(RenderRepaintBoundary boundary) async {
    final image = await boundary.toImage(pixelRatio: 3);
    try {
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      if (bytes == null) return null;
      return Uint8List.view(
        bytes.buffer,
        bytes.offsetInBytes,
        bytes.lengthInBytes,
      );
    } finally {
      image.dispose();
    }
  }

  Future<void> _share() async {
    if (_certificateId == null || _sharing) return;
    setState(() => _sharing = true);
    try {
      await WidgetsBinding.instance.endOfFrame;
      final renderObject = _certificateKey.currentContext?.findRenderObject();
      if (renderObject is! RenderRepaintBoundary) {
        throw Exception('证书图片还在准备，请稍后重试');
      }
      final bytes = widget.imageEncoder == null
          ? await _encode(renderObject)
          : await widget.imageEncoder!(renderObject);
      if (bytes == null) throw Exception('证书图片生成失败');
      if (!mounted) return;
      final fileName =
          '约钓者-渔获证书-${_snapshot['promotionCode'] ?? 'certificate'}.png';
      final box = context.findRenderObject() as RenderBox?;
      final params = ShareParams(
        title: '约钓者渔获证书',
        text: '我的海钓渔获纪念证',
        files: [XFile.fromData(bytes, mimeType: 'image/png', name: fileName)],
        fileNameOverrides: [fileName],
        sharePositionOrigin: box == null
            ? null
            : box.localToGlobal(Offset.zero) & box.size,
      );
      if (widget.shareImage == null) {
        await SharePlus.instance.share(params);
      } else {
        await widget.shareImage!(params);
      }
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
    return PopScope<bool>(
      canPop: !_createdCertificate || _allowGeneratedCertificatePop,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop || !_createdCertificate || _allowGeneratedCertificatePop) {
          return;
        }
        setState(() => _allowGeneratedCertificatePop = true);
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) Navigator.of(context).pop(true);
        });
      },
      child: Scaffold(
        appBar: AppBar(title: const Text('证书预览')),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null && _snapshot.isEmpty
            ? Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: _CertificateEmptyState(
                    icon: Icons.info_outline,
                    title: '暂时不能生成',
                    detail: _error!,
                    action: '返回重试',
                    onPressed: () => Navigator.pop(context),
                  ),
                ),
              )
            : ListView(
                padding: const EdgeInsets.fromLTRB(14, 10, 14, 30),
                children: [
                  const Padding(
                    padding: EdgeInsets.fromLTRB(4, 0, 4, 12),
                    child: Text(
                      '以下内容由已确认的航次记录拼装，生成后会冻结为证书快照。',
                      style: TextStyle(
                        color: FishingTokens.secondary,
                        height: 1.45,
                      ),
                    ),
                  ),
                  Center(
                    child: RepaintBoundary(
                      key: _certificateKey,
                      child: CertificateArtwork(snapshot: _snapshot),
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    _CertificateNotice(text: _error!),
                  ],
                  const SizedBox(height: 18),
                  if (_certificateId == null)
                    FilledButton.icon(
                      onPressed: _generating ? null : _generate,
                      icon: const Icon(Icons.verified_outlined),
                      label: Text(_generating ? '生成中…' : '生成并保存证书快照'),
                    )
                  else
                    FilledButton.icon(
                      onPressed: _sharing ? null : _share,
                      icon: const Icon(Icons.ios_share_rounded),
                      label: Text(_sharing ? '准备图片…' : '保存或分享图片'),
                    ),
                  if (_certificateId != null)
                    const Padding(
                      padding: EdgeInsets.only(top: 8),
                      child: Text(
                        '将通过系统分享面板导出 PNG 图片，可选择保存到设备或发送给朋友。',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: FishingTokens.secondary,
                          fontSize: 12,
                        ),
                      ),
                    ),
                ],
              ),
      ),
    );
  }
}

class CertificateArtwork extends StatelessWidget {
  const CertificateArtwork({required this.snapshot, super.key});

  final Map<String, dynamic> snapshot;

  @override
  Widget build(BuildContext context) {
    final fishItems = _certificateMaps(snapshot['fishItems']);
    final date = _shortDate(snapshot['departureAt']);
    return Container(
      width: 360,
      height: 552,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(24),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF0B3C55), Color(0xFF062C4A), Color(0xFF041F36)],
        ),
        border: Border.all(
          color: const Color(0xFF8CC4CB).withValues(alpha: .45),
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x44000000),
            blurRadius: 28,
            offset: Offset(0, 14),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned(
            top: -72,
            right: -52,
            child: Container(
              width: 205,
              height: 205,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: Colors.white.withValues(alpha: .07),
                  width: 1.4,
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(25, 22, 25, 20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Image.asset(
                      'assets/brand/wordmark-fishing-mate-lockup-reference.png',
                      width: 63,
                      height: 46,
                      fit: BoxFit.contain,
                    ),
                    const SizedBox(width: 10),
                    const Text(
                      '约钓者',
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 1.5,
                      ),
                    ),
                    const Spacer(),
                    const Text(
                      'CERTIFICATE',
                      style: TextStyle(
                        color: Color(0xFF9CC9D0),
                        fontSize: 9,
                        letterSpacing: 1.3,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 13),
                const Text(
                  '渔获纪念证',
                  style: TextStyle(
                    fontSize: 27,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1.1,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '$date · ${snapshot['boatName'] ?? '海上航次'}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFFB6CED2),
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 17),
                Container(
                  height: 1,
                  color: const Color(0xFF7EA7AE).withValues(alpha: .36),
                ),
                const SizedBox(height: 15),
                Row(
                  children: [
                    Expanded(
                      child: _CertificatePerson(
                        label: '钓友',
                        value: '${snapshot['displayName'] ?? '钓友'}',
                      ),
                    ),
                    const SizedBox(width: 22),
                    Expanded(
                      child: _CertificatePerson(
                        label: '船长',
                        value: '${snapshot['captainName'] ?? '—'}',
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                const Text(
                  '本航渔获记录',
                  style: TextStyle(
                    color: Color(0xFFB8F500),
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 8),
                Expanded(
                  child: Container(
                    width: double.infinity,
                    padding: const EdgeInsets.fromLTRB(13, 8, 13, 8),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: .055),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(
                        color: Colors.white.withValues(alpha: .1),
                      ),
                    ),
                    child: fishItems.isEmpty
                        ? const Center(
                            child: Text(
                              '暂无渔获',
                              style: TextStyle(color: Color(0xFFB6CED2)),
                            ),
                          )
                        : ListView.separated(
                            padding: EdgeInsets.zero,
                            physics: const NeverScrollableScrollPhysics(),
                            itemCount: fishItems.length > 4
                                ? 4
                                : fishItems.length,
                            separatorBuilder: (_, _) => Divider(
                              height: 1,
                              color: Colors.white.withValues(alpha: .08),
                            ),
                            itemBuilder: (context, index) {
                              final item = fishItems[index];
                              final detail = _sizeDetail(item);
                              return Padding(
                                padding: const EdgeInsets.symmetric(
                                  vertical: 7,
                                ),
                                child: Row(
                                  children: [
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            '${item['fishName'] ?? item['fishCode'] ?? '渔获'}',
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: const TextStyle(
                                              fontSize: 14,
                                              fontWeight: FontWeight.w800,
                                            ),
                                          ),
                                          Text(
                                            '${item['source'] ?? '本人记录'}${detail.isEmpty ? '' : ' · $detail'}',
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: const TextStyle(
                                              color: Color(0xFF9CB9BF),
                                              fontSize: 9,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                    Text(
                                      '× ${item['quantity'] ?? 0}',
                                      style: const TextStyle(
                                        color: Color(0xFFB8F500),
                                        fontSize: 18,
                                        fontWeight: FontWeight.w900,
                                      ),
                                    ),
                                  ],
                                ),
                              );
                            },
                          ),
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            '专属推广码',
                            style: TextStyle(
                              color: Color(0xFF9CB9BF),
                              fontSize: 10,
                            ),
                          ),
                          const SizedBox(height: 3),
                          Text(
                            '${snapshot['promotionCode'] ?? ''}',
                            style: const TextStyle(
                              color: Color(0xFFB8F500),
                              fontSize: 18,
                              fontWeight: FontWeight.w900,
                              letterSpacing: 1.5,
                            ),
                          ),
                          const SizedBox(height: 3),
                          const Text(
                            '扫码进入约钓者',
                            style: TextStyle(
                              color: Color(0xFF9CB9BF),
                              fontSize: 9,
                            ),
                          ),
                        ],
                      ),
                    ),
                    if ('${snapshot['landingUrl'] ?? ''}'.isNotEmpty)
                      Container(
                        padding: const EdgeInsets.all(5),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: QrImageView(
                          data: '${snapshot['landingUrl']}',
                          size: 76,
                          version: QrVersions.auto,
                          errorCorrectionLevel: QrErrorCorrectLevel.Q,
                          gapless: true,
                        ),
                      ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _CertificatePerson extends StatelessWidget {
  const _CertificatePerson({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        label,
        style: const TextStyle(color: Color(0xFF9CB9BF), fontSize: 10),
      ),
      const SizedBox(height: 3),
      Text(
        value,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800),
      ),
    ],
  );
}

class _EligibleTripCard extends StatelessWidget {
  const _EligibleTripCard({required this.trip, required this.onPressed});
  final Map<String, dynamic> trip;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(15),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.sailing_outlined,
                color: FishingTokens.brand,
                size: 20,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '${trip['boatName'] ?? '已完成航次'}',
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
              ),
              Text(
                _shortDate(trip['departureAt']),
                style: const TextStyle(
                  color: FishingTokens.secondary,
                  fontSize: 12,
                ),
              ),
            ],
          ),
          const SizedBox(height: 7),
          Text(
            '船长 ${trip['captainName'] ?? '—'}',
            style: const TextStyle(
              color: FishingTokens.secondary,
              fontSize: 12,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            _summary(trip['fishSummary']),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 13, height: 1.4),
          ),
          const SizedBox(height: 10),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton.tonalIcon(
              onPressed: onPressed,
              icon: const Icon(Icons.auto_awesome_outlined, size: 18),
              label: const Text('预览证书'),
            ),
          ),
        ],
      ),
    ),
  );
}

class _SavedCertificateCard extends StatelessWidget {
  const _SavedCertificateCard({
    required this.certificate,
    required this.onOpen,
    required this.onHide,
  });
  final Map<String, dynamic> certificate;
  final VoidCallback onOpen;
  final VoidCallback onHide;

  @override
  Widget build(BuildContext context) {
    final snapshot = _certificateMap(certificate['snapshot']);
    return Card(
      child: ListTile(
        onTap: onOpen,
        leading: const CircleAvatar(
          backgroundColor: Color(0xFF173F4D),
          child: Icon(
            Icons.workspace_premium_outlined,
            color: FishingTokens.brand,
          ),
        ),
        title: Text(
          '${snapshot['boatName'] ?? '渔获证书'}',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: Text(
          '${_shortDate(snapshot['departureAt'])} · ${snapshot['fishItems'] is List ? (snapshot['fishItems'] as List).length : 0} 条记录',
        ),
        trailing: IconButton(
          tooltip: '从列表隐藏',
          onPressed: onHide,
          icon: const Icon(Icons.close_rounded, color: FishingTokens.secondary),
        ),
      ),
    );
  }
}

class _CertificateSectionTitle extends StatelessWidget {
  const _CertificateSectionTitle({required this.title});
  final String title;
  @override
  Widget build(BuildContext context) => Text(
    title,
    style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
  );
}

class _CertificateEmptyCard extends StatelessWidget {
  const _CertificateEmptyCard({required this.title, required this.detail});
  final String title;
  final String detail;
  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 5),
          Text(
            detail,
            style: const TextStyle(color: FishingTokens.secondary, height: 1.4),
          ),
        ],
      ),
    ),
  );
}

class _CertificateEmptyState extends StatelessWidget {
  const _CertificateEmptyState({
    required this.icon,
    required this.title,
    required this.detail,
    required this.action,
    required this.onPressed,
  });
  final IconData icon;
  final String title;
  final String detail;
  final String action;
  final VoidCallback onPressed;
  @override
  Widget build(BuildContext context) => Column(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(icon, color: FishingTokens.brand, size: 40),
      const SizedBox(height: 12),
      Text(
        title,
        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
      ),
      const SizedBox(height: 7),
      Text(
        detail,
        textAlign: TextAlign.center,
        style: const TextStyle(color: FishingTokens.secondary, height: 1.5),
      ),
      const SizedBox(height: 14),
      FilledButton(onPressed: onPressed, child: Text(action)),
    ],
  );
}

class _CertificateNotice extends StatelessWidget {
  const _CertificateNotice({required this.text});
  final String text;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: const Color(0x33D9786C),
      borderRadius: BorderRadius.circular(12),
    ),
    child: Text(text, style: const TextStyle(color: Color(0xFFFFB8AD))),
  );
}

String _shortDate(Object? value) {
  final date = DateTime.tryParse('$value')?.toLocal();
  if (date == null) return '航次日期';
  return '${date.year}年${date.month}月${date.day}日';
}

String _summary(Object? value) => value is List && value.isNotEmpty
    ? value.map((item) => '$item').join(' · ')
    : '渔获记录';

String _sizeDetail(Map<String, dynamic> item) {
  final parts = <String>[];
  final grams = item['maxIndividualWeightGrams'];
  if (grams is num && grams > 0) {
    parts.add('${(grams / 1000).toStringAsFixed(1)} kg');
  }
  final millimeters = item['maxLengthMm'];
  if (millimeters is num && millimeters > 0) {
    parts.add('${(millimeters / 10).toStringAsFixed(1)} cm');
  }
  return parts.join(' / ');
}
