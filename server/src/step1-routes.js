import { createLocalObjectStorage, allowedImageTypes } from './local-object-storage.js';
import { createIdentityAdapter } from './identity-adapter.js';
import { createSecurity } from './security.js';
import { createSmsAdapter } from './sms-adapter.js';
import { syncPromotionForUser } from './promotion-service.js';

const MARINAS = Object.freeze({
  xiaogang: '小港',
  jimiya: '积米崖',
  shazikou: '沙子口',
  tianheng: '田横',
  hongdao: '红岛',
  zhonggang: '中港',
});
const FACILITIES = new Set([
  'toilet',
  'cabin',
  'live_fish_well',
  'fish_finder',
  'air_conditioning',
  'night_fishing_lights',
]);
const PHOTO_KINDS = new Set(['exterior', 'deck', 'cabin', 'toilet', 'certificate', 'registration']);
const PHOTO_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);
const TOKEN_LIFETIME_DAYS = 30;

const sendError = (reply, statusCode, message) => reply.code(statusCode).send({ error: message });

function normalizePhone(value) {
  const phone = String(value ?? '').trim();
  return /^1[3-9]\d{9}$/.test(phone) ? phone : null;
}

function validChineseName(value) {
  return typeof value === 'string' && /^[\p{Script=Han}·]{2,32}$/u.test(value.trim());
}

function calculateComfort(lengthCm) {
  const spacingCm = Math.round(((lengthCm - 200) / 6) * 10) / 10;
  const comfort = spacingCm >= 195 ? 'spacious' : spacingCm >= 175 ? 'comfortable' : 'compact';
  return { spacingCm, comfort };
}

function publicUser(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    identityStatus: row.identity_status,
    identityRejectionReason: row.identity_rejection_reason,
    captainStatus: row.captain_status ?? null,
  };
}

function appPage() {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#081410"><title>约钓者 · 船长审核台</title>
<style>
:root{color-scheme:dark;--bg:#081410;--panel:#13241b;--panel2:#0b1913;--line:#20352a;--text:#f0f5ee;--muted:#9aac9e;--accent:#cdf463;--bad:#e17e70}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% -20%,#253d2d 0,transparent 42%),var(--bg);color:var(--text);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1040px;margin:0 auto;padding:32px 20px 80px}.eyebrow{color:var(--accent);font-size:12px;letter-spacing:.13em;font-weight:700}h1{font-size:30px;margin:8px 0 4px}p{color:var(--muted)}.top{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:20px}.login,.card{background:rgba(19,36,27,.94);border:1px solid var(--line);border-radius:20px;padding:20px}.login{max-width:520px}.row{display:flex;gap:10px;align-items:center}.row input{flex:1}input,textarea,button{font:inherit}input,textarea{width:100%;background:#0b1913;border:1px solid #304b3a;border-radius:12px;color:var(--text);padding:12px;margin:6px 0}button{border:0;border-radius:12px;background:var(--accent);color:#081410;font-weight:800;padding:11px 16px;cursor:pointer}button.secondary{background:#20352a;color:var(--text)}button.reject{background:#4b2521;color:#ffe5df}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:14px;margin-top:18px}.card h2{font-size:18px;margin:0 0 4px}.meta{color:var(--muted);font-size:13px}.photos{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:12px 0}.photos img{width:100%;height:120px;object-fit:cover;background:#0b1913;border-radius:10px;border:1px solid var(--line)}.label{color:var(--accent);font-size:12px}.actions{display:flex;gap:8px;margin-top:12px}.reason{display:none}.empty{border:1px dashed #405647;border-radius:18px;padding:25px;text-align:center;color:var(--muted)}#message{min-height:22px;color:var(--accent)}@media(max-width:560px){.top{display:block}h1{font-size:25px}main{padding:24px 14px}.row{align-items:stretch;flex-direction:column}}
</style></head><body><main><div class="top"><div><div class="eyebrow">YUEDIAOZHE · OPERATIONS</div><h1>船长与船档案审核</h1><p>核对资质、四类船照与登记信息，驳回时填写原因。</p></div><span class="label">青岛 · 审核台</span></div>
<section class="login"><label for="password">管理员口令</label><div class="row"><input id="password" type="password" autocomplete="current-password" placeholder="由部署环境 ADMIN_PASSWORD 配置"><button id="load">进入审核台</button></div><div id="message" role="status"></div></section><div id="queue" class="grid"></div></main>
<script>
let adminPassword='';const $=s=>document.querySelector(s);const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,options={}){const response=await fetch(path,{...options,headers:{'content-type':'application/json','x-admin-password':adminPassword,...options.headers}});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||('HTTP '+response.status));return body}
async function loadQueue(){adminPassword=$('#password').value;$('#message').textContent='正在读取待审核申请…';try{const {items}=await api('/admin/reviews');$('#message').textContent=items.length?'待处理 '+items.length+' 项':'审核队列已清空';const queue=$('#queue');queue.innerHTML=items.length?items.map(item=>{const pictures=[['船证',item.certificateUri],['外观',item.photos.exterior],['甲板',item.photos.deck],['船舱',item.photos.cabin],['厕所',item.photos.toilet]].filter(x=>x[1]);return '<article class="card" data-id="'+escapeHtml(item.id)+'"><div class="label">待审核 · '+escapeHtml(item.marinaName)+'</div><h2>'+escapeHtml(item.boat.name)+' · '+(item.boat.lengthCm/100).toFixed(1)+' 米</h2><div class="meta">申请人：'+escapeHtml(item.captainName)+'　资质号：'+escapeHtml(item.licenseNumber)+'<br>船舶登记号：'+escapeHtml(item.registrationNumber)+'<br>设施：'+escapeHtml(item.facilities.join('、'))+'<br>舒适度：'+escapeHtml(item.comfortLabel||'待人工')+'　模板：'+escapeHtml(item.templateLabel)+'</div><div class="photos">'+pictures.map(([label,uri])=>'<div><div class="label">'+label+'</div><img data-uri="'+escapeHtml(uri)+'" alt="'+label+'凭证"></div>').join('')+'</div><div class="actions"><button data-action="approve">审核通过</button><button class="reject" data-action="reject">驳回</button></div><textarea class="reason" placeholder="请写明驳回原因"></textarea></article>'}).join(''):'<div class="empty">暂无待审核申请</div>';for(const image of queue.querySelectorAll('img[data-uri]')){const uri=image.dataset.uri;try{const data=await api('/admin/object?uri='+encodeURIComponent(uri),{method:'GET',headers:{'content-type':'text/plain'}});image.src='data:'+data.contentType+';base64,'+data.base64}catch(_){image.alt+='（暂不可读取）'}}}catch(error){$('#message').textContent=error.message;$('#queue').innerHTML=''}}
$('#load').addEventListener('click',loadQueue);$('#password').addEventListener('keydown',e=>{if(e.key==='Enter')loadQueue()});$('#queue').addEventListener('click',async e=>{const button=e.target.closest('button[data-action]');if(!button)return;const card=button.closest('[data-id]'),reason=card.querySelector('.reason');if(button.dataset.action==='reject'&&!reason.value.trim()){reason.style.display='block';reason.focus();reason.setCustomValidity('驳回必须填写原因');reason.reportValidity();reason.addEventListener('input',()=>reason.setCustomValidity(''),{once:true});return}try{await api('/admin/reviews/'+card.dataset.id+'/decision',{method:'POST',body:JSON.stringify({decision:button.dataset.action==='approve'?'approved':'rejected',reason:reason.value.trim()})});await loadQueue()}catch(error){$('#message').textContent=error.message}});
</script></body></html>`;
}

export function registerStep1Routes(app, { pool, config }) {
  const security = createSecurity(config);
  const storage = createLocalObjectStorage(config.uploadDir);
  const smsAdapter = createSmsAdapter(config, security);
  const identityAdapter = createIdentityAdapter(config);
  const requirePool = async (_request, reply) => {
    if (!pool) return sendError(reply, 503, '数据库未配置');
  };
  const requireUser = async (request, reply) => {
    if (!pool) return sendError(reply, 503, '数据库未配置');
    const authorization = request.headers.authorization ?? '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) return sendError(reply, 401, '请先登录');
    try {
      const result = await pool.query(
        `SELECT u.id, u.status, u.display_name, u.identity_status,
                u.identity_rejection_reason, cp.verification_status AS captain_status
         FROM user_sessions s JOIN users u ON u.id = s.user_id
         LEFT JOIN captain_profiles cp ON cp.user_id = u.id
         WHERE s.token_hash = $1 AND s.expires_at > now()`,
        [security.tokenHash(token)],
      );
      if (!result.rowCount || result.rows[0].status !== 'active') {
        return sendError(reply, 401, '登录已过期，请重新登录');
      }
      request.user = result.rows[0];
    } catch (error) {
      request.log.error({ err: error }, 'Session lookup failed');
      return sendError(reply, 503, '登录服务暂不可用');
    }
  };
  const requireAdmin = async (request, reply) => {
    if (!config.adminPassword) return sendError(reply, 503, '未配置 ADMIN_PASSWORD');
    const provided = Buffer.from(String(request.headers['x-admin-password'] ?? ''));
    const expected = Buffer.from(config.adminPassword);
    if (provided.length !== expected.length || !security.safeEqual(provided, expected)) {
      return sendError(reply, 401, '管理员口令错误');
    }
  };

  app.get('/admin', async (_request, reply) => reply.type('text/html; charset=utf-8').send(appPage()));

  app.post('/auth/code', { preHandler: requirePool }, async (request, reply) => {
    const phone = normalizePhone(request.body?.phone);
    if (!phone) return sendError(reply, 400, '请输入有效的 11 位手机号');
    const phoneHash = security.phoneHash(phone);
    const recent = await pool.query(
      `SELECT 1 FROM sms_verification_codes
       WHERE phone_hash = $1 AND created_at > now() - interval '60 seconds'`,
      [phoneHash],
    );
    if (recent.rowCount) return sendError(reply, 429, '验证码已发送，请稍后再试');
    let delivery;
    try {
      delivery = await smsAdapter.sendVerificationCode(phone);
    } catch (error) {
      return sendError(reply, error.statusCode ?? 503, error.message);
    }
    await pool.query(
      `INSERT INTO sms_verification_codes (phone_hash, code_hash, expires_at)
       VALUES ($1, $2, now() + interval '5 minutes')`,
      [phoneHash, security.smsCodeHash(delivery.code)],
    );
    return reply.code(201).send({ sent: true, expiresInSeconds: 300, sandboxCode: delivery.sandboxCode });
  });

  async function authenticateWithCode(request, reply) {
    const phone = normalizePhone(request.body?.phone);
    const code = String(request.body?.code ?? '').trim();
    const displayName = String(request.body?.displayName ?? '').trim();
    if (!phone || !/^\d{6}$/.test(code)) return sendError(reply, 400, '手机号或验证码格式不正确');
    if (config.nodeEnv === 'production' && !config.piiEncryptionKeyHex) {
      return sendError(reply, 503, '账号服务未配置安全密钥');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const phoneHash = security.phoneHash(phone);
      const otp = await client.query(
        `SELECT id, code_hash, expires_at, attempts FROM sms_verification_codes
         WHERE phone_hash = $1 AND consumed_at IS NULL
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [phoneHash],
      );
      if (!otp.rowCount) {
        await client.query('ROLLBACK');
        return sendError(reply, 401, '验证码无效或已使用');
      }
      const record = otp.rows[0];
      const valid = new Date(record.expires_at) > new Date()
        && record.attempts < 5
        && security.safeEqual(record.code_hash, security.smsCodeHash(code));
      if (!valid) {
        await client.query(
          `UPDATE sms_verification_codes SET attempts = LEAST(attempts + 1, 6),
             consumed_at = CASE WHEN attempts >= 4 OR expires_at <= now() THEN now() ELSE consumed_at END
           WHERE id = $1`,
          [record.id],
        );
        await client.query('COMMIT');
        return sendError(reply, 401, '验证码错误或已过期');
      }
      await client.query('UPDATE sms_verification_codes SET consumed_at = now() WHERE id = $1', [record.id]);
      let userResult = await client.query(
        `SELECT id, status, display_name, identity_status, identity_rejection_reason
         FROM users WHERE phone_hash = $1 FOR UPDATE`,
        [phoneHash],
      );
      if (!userResult.rowCount) {
        const ciphertext = security.encrypt(phone);
        userResult = await client.query(
          `INSERT INTO users (phone_ciphertext, phone_hash, display_name)
           VALUES ($1, $2, $3)
           RETURNING id, status, display_name, identity_status, identity_rejection_reason`,
          [ciphertext, phoneHash, displayName || '钓友'],
        );
      }
      const user = userResult.rows[0];
      if (user.status !== 'active') {
        await client.query('ROLLBACK');
        return sendError(reply, 403, '该账号当前不可用');
      }
      const token = security.newToken();
      const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_DAYS * 86400000);
      await client.query(
        'INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
        [security.tokenHash(token), user.id, expiresAt],
      );
      await client.query('COMMIT');
      return reply.code(200).send({ token, expiresAt: expiresAt.toISOString(), user: publicUser(user) });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      request.log.error({ err: error }, 'Account authentication failed');
      return sendError(reply, 500, '登录失败，请稍后重试');
    } finally {
      client.release();
    }
  }

  app.post('/auth/register', { preHandler: requirePool }, authenticateWithCode);
  app.post('/auth/login', { preHandler: requirePool }, authenticateWithCode);

  app.post('/auth/logout', { preHandler: requireUser }, async (request, reply) => {
    const token = request.headers.authorization.slice(7);
    await pool.query('DELETE FROM user_sessions WHERE token_hash = $1', [security.tokenHash(token)]);
    return reply.code(204).send();
  });

  app.get('/account/me', { preHandler: requireUser }, async (request) => ({ user: publicUser(request.user) }));

  app.get('/captain/douyin-profile', { preHandler: [requireUser, requirePool] }, async (request, reply) => {
    const result = await pool.query(
      'SELECT douyin_handle,douyin_profile_url FROM captain_profiles WHERE user_id=$1',
      [request.user.id],
    );
    if (!result.rowCount) return sendError(reply, 403, '请先提交船长入驻申请');
    return {
      handle: result.rows[0].douyin_handle,
      profileUrl: result.rows[0].douyin_profile_url,
    };
  });

  app.post('/captain/douyin-profile', { preHandler: [requireUser, requirePool] }, async (request, reply) => {
    const handleInput = String(request.body?.handle ?? '').trim().replace(/^@/, '');
    const urlInput = String(request.body?.profileUrl ?? '').trim();
    let handle = handleInput || null;
    let profileUrl = null;
    if ((handle === null) !== (urlInput.length === 0)) {
      return sendError(reply, 400, '抖音号和主页链接需要一起填写，清空两项可解除绑定');
    }
    if (handle !== null) {
      if (handle.length > 80 || /[\u0000-\u001f\u007f]/.test(handle)) {
        return sendError(reply, 400, '抖音号长度或格式无效');
      }
      try {
        const parsed = new URL(urlInput);
        const allowedHosts = new Set(['douyin.com', 'www.douyin.com', 'v.douyin.com']);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password
          || !allowedHosts.has(parsed.hostname.toLowerCase()) || parsed.pathname === '/') {
          return sendError(reply, 400, '请填写抖音个人主页的 HTTPS 链接');
        }
        profileUrl = parsed.toString();
      } catch {
        return sendError(reply, 400, '抖音主页链接格式无效');
      }
    } else {
      handle = null;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const profile = await client.query(
        'SELECT user_id FROM captain_profiles WHERE user_id=$1 FOR UPDATE',
        [request.user.id],
      );
      if (!profile.rowCount) {
        await client.query('ROLLBACK');
        return sendError(reply, 403, '请先提交船长入驻申请');
      }
      if (handle === null) {
        const activeLive = await client.query(
          `SELECT 1 FROM step5_live_sessions
           WHERE captain_user_id=$1 AND ended_at IS NULL LIMIT 1`,
          [request.user.id],
        );
        if (activeLive.rowCount) {
          await client.query('ROLLBACK');
          return sendError(reply, 409, '直播结束后才能解除抖音主页绑定');
        }
      }
      const result = await client.query(
        `UPDATE captain_profiles SET douyin_handle=$2,douyin_profile_url=$3,updated_at=now()
         WHERE user_id=$1 RETURNING douyin_handle,douyin_profile_url`,
        [request.user.id, handle, profileUrl],
      );
      await client.query('COMMIT');
      return {
        handle: result.rows[0].douyin_handle,
        profileUrl: result.rows[0].douyin_profile_url,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      request.log.error({ err: error }, 'Captain Douyin profile update failed');
      return sendError(reply, 500, '保存抖音主页失败');
    } finally {
      client.release();
    }
  });

  app.post('/identity', { preHandler: requireUser }, async (request, reply) => {
    const legalName = String(request.body?.legalName ?? '').trim();
    const identityNumber = String(request.body?.identityNumber ?? '').toUpperCase().trim();
    if (!validChineseName(legalName)) return sendError(reply, 400, '请填写有效姓名');
    let sandboxDecision;
    try {
      sandboxDecision = await identityAdapter.verify({ legalName, identityNumber });
    } catch (error) {
      return sendError(reply, error.statusCode ?? 503, error.message);
    }
    const legalNameCiphertext = security.encrypt(legalName);
    const identityNumberCiphertext = security.encrypt(identityNumber);
    const identityNumberHash = security.identityHash(identityNumber);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE users SET legal_name_ciphertext = $1, identity_number_ciphertext = $2,
           identity_status = 'pending', identity_rejection_reason = NULL,
           identity_submitted_at = now(), identity_verified_at = NULL, updated_at = now()
         WHERE id = $3 RETURNING id`,
        [legalNameCiphertext, identityNumberCiphertext, request.user.id],
      );
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, '账号不存在');
      }
      await client.query(
        `UPDATE users SET identity_status = $1::varchar, identity_rejection_reason = $2,
           identity_verified_at = CASE WHEN $1::varchar = 'verified' THEN now() ELSE NULL END,
           identity_number_hash = CASE WHEN $1::varchar = 'verified' THEN $3::bytea ELSE NULL END,
           updated_at = now() WHERE id = $4`,
        [sandboxDecision.status, sandboxDecision.reason, identityNumberHash, request.user.id],
      );
      if (sandboxDecision.status === 'verified') {
        await syncPromotionForUser(client, request.user.id);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.code === '23505') return sendError(reply, 409, '该实名身份已关联其他账号');
      request.log.error({ err: error }, 'Identity verification submission failed');
      return sendError(reply, 500, '实名提交失败，请稍后重试');
    } finally {
      client.release();
    }
    return reply.code(200).send({
      status: sandboxDecision.status,
      rejectionReason: sandboxDecision.reason,
      maskedIdentityNumber: `**************${identityNumber.slice(-4)}`,
    });
  });

  app.post('/uploads', { preHandler: requireUser }, async (request, reply) => {
    const kind = String(request.body?.kind ?? '');
    const contentType = String(request.body?.contentType ?? '').toLowerCase();
    const encoded = String(request.body?.base64 ?? '');
    if (!PHOTO_KINDS.has(kind)) return sendError(reply, 400, '照片类别不支持');
    if (!allowedImageTypes.has(contentType)) return sendError(reply, 415, '仅支持 JPEG、PNG 或 WebP 图片');
    if (!encoded || encoded.length > 7_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      return sendError(reply, 413, '图片为空或超过 5 MB');
    }
    const bytes = Buffer.from(encoded, 'base64');
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) return sendError(reply, 413, '图片超过 5 MB');
    const key = await storage.put(bytes, contentType);
    await pool.query(
      'INSERT INTO uploaded_objects (object_key, owner_user_id, object_kind, content_type) VALUES ($1, $2, $3, $4)',
      [key, request.user.id, kind, contentType],
    );
    return reply.code(201).send({ objectUri: `local-object://${key}`, kind, contentType, sizeBytes: bytes.length });
  });

  async function objectRecord(key) {
    const result = await pool.query(
      'SELECT object_key, owner_user_id, object_kind, content_type FROM uploaded_objects WHERE object_key = $1',
      [key],
    );
    return result.rows[0] ?? null;
  }
  async function sendObject(reply, row) {
    const bytes = await storage.get(row.object_key);
    if (!bytes) return sendError(reply, 404, '图片不存在');
    return reply.type(row.content_type).header('cache-control', 'private, max-age=120').send(bytes);
  }
  app.get('/objects/:key', { preHandler: requireUser }, async (request, reply) => {
    const row = await objectRecord(request.params.key);
    if (!row || row.owner_user_id !== request.user.id) return sendError(reply, 404, '图片不存在');
    return sendObject(reply, row);
  });
  app.get('/admin/object', { preHandler: [requirePool, requireAdmin] }, async (request, reply) => {
    const uri = String(request.query?.uri ?? '');
    const key = uri.startsWith('local-object://') ? uri.slice('local-object://'.length) : '';
    const row = key ? await objectRecord(key) : null;
    if (!row) return sendError(reply, 404, '图片不存在');
    const bytes = await storage.get(row.object_key);
    if (!bytes) return sendError(reply, 404, '图片不存在');
    return { contentType: row.content_type, base64: bytes.toString('base64') };
  });

  app.post('/captain/application', { preHandler: requireUser }, async (request, reply) => {
    if (request.user.identity_status !== 'verified') return sendError(reply, 403, '请先完成实名核验');
    const body = request.body ?? {};
    const captainName = String(body.captainName ?? '').trim();
    const licenseNumber = String(body.licenseNumber ?? '').trim();
    const boatName = String(body.boatName ?? '').trim();
    const lengthCm = Number(body.lengthCm);
    const registrationNumber = String(body.registrationNumber ?? '').trim();
    const marinaCode = String(body.homeMarinaCode ?? '');
    const facilities = body.facilities;
    const photos = body.photos;
    const certificateUri = String(body.certificateUri ?? '');
    const registrationRecordUri = body.registrationRecordUri ? String(body.registrationRecordUri) : null;
    if (!validChineseName(captainName)) return sendError(reply, 400, '请填写有效船长姓名');
    if (licenseNumber.length < 4 || licenseNumber.length > 80) return sendError(reply, 400, '请填写有效船长资质编号');
    if (boatName.length < 2 || boatName.length > 100) return sendError(reply, 400, '船名需为 2–100 个字符');
    if (!Number.isInteger(lengthCm) || lengthCm < 300 || lengthCm > 5000) return sendError(reply, 400, '船长需填写 300–5000 厘米');
    if (registrationNumber.length < 3 || registrationNumber.length > 80) return sendError(reply, 400, '请填写有效船舶登记号');
    if (!Object.hasOwn(MARINAS, marinaCode)) return sendError(reply, 400, '请选择青岛集合码头');
    if (!Array.isArray(facilities) || facilities.some((item) => !FACILITIES.has(item))) {
      return sendError(reply, 400, '设施选项无效');
    }
    if (!photos || !['exterior', 'deck', 'cabin', 'toilet'].every((kind) => typeof photos[kind] === 'string')) {
      return sendError(reply, 400, '请分别上传外观、甲板、船舱和厕所照片');
    }
    if (!certificateUri.startsWith('local-object://')) return sendError(reply, 400, '请上传船长资质照片');
    const photoRefs = { ...photos, certificate: certificateUri };
    if (registrationRecordUri) photoRefs.registration = registrationRecordUri;
    for (const [kind, uri] of Object.entries(photoRefs)) {
      if (!uri.startsWith('local-object://')) return sendError(reply, 400, `${kind} 照片地址无效`);
      const key = uri.slice('local-object://'.length);
      const object = await objectRecord(key);
      if (!object || object.owner_user_id !== request.user.id || object.object_kind !== kind) {
        return sendError(reply, 400, `${kind} 照片无效，请重新上传`);
      }
    }
    const { spacingCm, comfort } = calculateComfort(lengthCm);
    const hasTemplate = lengthCm >= 1200 && lengthCm <= 1400;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO captain_profiles
           (user_id, captain_name, captain_name_ciphertext, license_reference_ciphertext, verification_status, verified_at, certificate_uri)
         VALUES ($1, NULL, $2, $3, 'pending', NULL, $4)
         ON CONFLICT (user_id) DO UPDATE SET captain_name = NULL, captain_name_ciphertext = EXCLUDED.captain_name_ciphertext,
           license_reference_ciphertext = EXCLUDED.license_reference_ciphertext, verification_status = 'pending',
           verified_at = NULL, certificate_uri = EXCLUDED.certificate_uri, updated_at = now()`,
        [request.user.id, security.encrypt(captainName), security.encrypt(licenseNumber), certificateUri],
      );
      const existing = await client.query('SELECT id FROM boats WHERE captain_user_id = $1 FOR UPDATE', [request.user.id]);
      const templateCode = hasTemplate ? 'qingdao-12-seat-v1' : null;
      const boatValues = [
        request.user.id,
        boatName,
        lengthCm,
        security.encrypt(registrationNumber),
        registrationRecordUri,
        marinaCode,
        JSON.stringify([...new Set(facilities)]),
        templateCode,
        hasTemplate ? 12 : null,
        comfort,
        spacingCm,
        hasTemplate ? 'ready' : 'manual_review',
      ];
      let boat;
      if (existing.rowCount) {
        const result = await client.query(
          `UPDATE boats SET name=$2, length_cm=$3, registration_number_ciphertext=$4, registration_record_uri=$5,
            home_marina_code=$6, facilities=$7::jsonb, seat_template_code=$8, seat_count=$9, comfort_level=$10,
            comfort_spacing_cm=$11, template_status=$12, review_status='pending', updated_at=now()
           WHERE id=$1 RETURNING id`,
          [existing.rows[0].id, ...boatValues.slice(1)],
        );
        boat = result.rows[0];
        await client.query('DELETE FROM boat_photos WHERE boat_id = $1', [boat.id]);
      } else {
        const result = await client.query(
          `INSERT INTO boats (captain_user_id,name,length_cm,registration_number_ciphertext,registration_record_uri,
            home_marina_code,facilities,seat_template_code,seat_count,comfort_level,comfort_spacing_cm,template_status,review_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,'pending') RETURNING id`,
          boatValues,
        );
        boat = result.rows[0];
      }
      for (const [kind, uri] of Object.entries(photos)) {
        const key = uri.slice('local-object://'.length);
        await client.query(
          'INSERT INTO boat_photos (boat_id, photo_kind, object_uri) VALUES ($1, $2, $3)',
          [boat.id, kind, `local-object://${key}`],
        );
      }
      const application = await client.query(
        `INSERT INTO captain_applications (captain_user_id, boat_id, status, rejection_reason, submitted_at, reviewed_at)
         VALUES ($1,$2,'pending',NULL,now(),NULL)
         ON CONFLICT (boat_id) DO UPDATE SET status='pending', rejection_reason=NULL, submitted_at=now(),
           reviewed_at=NULL, updated_at=now() RETURNING id`,
        [request.user.id, boat.id],
      );
      await client.query('COMMIT');
      return reply.code(201).send({
        applicationId: application.rows[0].id,
        status: 'pending',
        templateStatus: hasTemplate ? 'ready' : 'manual_review',
        templateCode,
        seatCount: hasTemplate ? 12 : null,
        comfortLevel: comfort,
        estimatedSpacingCm: spacingCm,
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      request.log.error({ err: error }, 'Captain application submission failed');
      return sendError(reply, 500, '提交失败，请稍后重试');
    } finally {
      client.release();
    }
  });

  app.get('/captain/application', { preHandler: requireUser }, async (request, reply) => {
    const result = await pool.query(
      `SELECT a.id, a.status AS application_status, a.rejection_reason, a.submitted_at,
              b.id AS boat_id, b.name, b.length_cm, b.home_marina_code, b.facilities,
              b.seat_template_code, b.seat_count, b.template_status, b.comfort_level, b.comfort_spacing_cm,
              st.layout, cp.verification_status AS captain_status, cp.certificate_uri,
              cp.douyin_handle, cp.douyin_profile_url,
              COALESCE(jsonb_object_agg(bp.photo_kind, bp.object_uri) FILTER (WHERE bp.photo_kind IS NOT NULL), '{}'::jsonb) AS photos
       FROM captain_applications a JOIN boats b ON b.id=a.boat_id
       JOIN captain_profiles cp ON cp.user_id=a.captain_user_id
       LEFT JOIN seat_templates st ON st.code=b.seat_template_code
       LEFT JOIN boat_photos bp ON bp.boat_id=b.id
       WHERE a.captain_user_id=$1
       GROUP BY a.id,b.id,cp.user_id,st.code`,
      [request.user.id],
    );
    if (!result.rowCount) return { application: null };
    const row = result.rows[0];
    return {
      application: {
        id: row.id,
        status: row.application_status,
        rejectionReason: row.rejection_reason,
        submittedAt: row.submitted_at,
        captainStatus: row.captain_status,
        douyinProfile: {
          handle: row.douyin_handle,
          profileUrl: row.douyin_profile_url,
        },
        boat: {
          id: row.boat_id,
          name: row.name,
          lengthCm: row.length_cm,
          homeMarinaCode: row.home_marina_code,
          facilities: row.facilities,
          templateCode: row.seat_template_code,
          templateStatus: row.template_status,
          seatCount: row.seat_count,
          seatLayout: row.layout,
          comfortLevel: row.comfort_level,
          estimatedSpacingCm: row.comfort_spacing_cm === null ? null : Number(row.comfort_spacing_cm),
          photos: row.photos,
          certificateUri: row.certificate_uri,
        },
      },
    };
  });

  app.get('/admin/reviews', { preHandler: [requirePool, requireAdmin] }, async () => {
    const result = await pool.query(
      `SELECT a.id, a.status, a.submitted_at, b.id AS boat_id, b.name, b.length_cm,
              b.registration_number_ciphertext, b.home_marina_code, b.facilities, b.seat_template_code,
              b.seat_count, b.template_status, b.comfort_level, b.comfort_spacing_cm,
              cp.captain_name_ciphertext, cp.license_reference_ciphertext, cp.certificate_uri,
              COALESCE(jsonb_object_agg(bp.photo_kind, bp.object_uri) FILTER (WHERE bp.photo_kind IS NOT NULL), '{}'::jsonb) AS photos
       FROM captain_applications a JOIN boats b ON b.id=a.boat_id
       JOIN captain_profiles cp ON cp.user_id=a.captain_user_id
       LEFT JOIN boat_photos bp ON bp.boat_id=b.id
       WHERE a.status='pending'
       GROUP BY a.id,b.id,cp.user_id
       ORDER BY a.submitted_at ASC`,
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        submittedAt: row.submitted_at,
        captainName: security.decrypt(row.captain_name_ciphertext),
        licenseNumber: security.decrypt(row.license_reference_ciphertext),
        certificateUri: row.certificate_uri,
        boat: {
          id: row.boat_id,
          name: row.name,
          lengthCm: row.length_cm,
          registrationNumber: security.decrypt(row.registration_number_ciphertext),
        },
        marinaCode: row.home_marina_code,
        marinaName: MARINAS[row.home_marina_code] ?? row.home_marina_code,
        facilities: row.facilities.map((facility) => ({
          toilet: '厕所', cabin: '船舱', live_fish_well: '活鱼舱', fish_finder: '鱼探',
          air_conditioning: '空调', night_fishing_lights: '夜钓灯',
        })[facility] ?? facility),
        templateLabel: row.template_status === 'ready' ? `${row.seat_template_code} · ${row.seat_count} 位` : '待人工核定',
        comfortLabel: row.comfort_level ? ({ spacious: '宽松', comfortable: '舒适', compact: '紧凑' })[row.comfort_level] : null,
        photos: row.photos,
      })),
    };
  });

  app.post('/admin/reviews/:id/decision', { preHandler: [requirePool, requireAdmin] }, async (request, reply) => {
    const decision = String(request.body?.decision ?? '');
    const reason = String(request.body?.reason ?? '').trim();
    if (!['approved', 'rejected'].includes(decision)) return sendError(reply, 400, '审核结果无效');
    if (decision === 'rejected' && !reason) return sendError(reply, 400, '驳回必须填写理由');
    if (reason.length > 1000) return sendError(reply, 400, '驳回理由过长');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query(
        `SELECT id, captain_user_id, boat_id FROM captain_applications
         WHERE id=$1 AND status='pending' FOR UPDATE`,
        [request.params.id],
      );
      if (!found.rowCount) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, '待审核申请不存在或已处理');
      }
      const appRecord = found.rows[0];
      await client.query(
        `UPDATE captain_applications SET status=$1, rejection_reason=$2, reviewed_at=now(), updated_at=now() WHERE id=$3`,
        [decision, decision === 'rejected' ? reason : null, appRecord.id],
      );
      await client.query(
        `UPDATE captain_profiles SET verification_status=$1::varchar, verified_at=CASE WHEN $1::varchar='approved' THEN now() ELSE NULL END,
          updated_at=now() WHERE user_id=$2`,
        [decision, appRecord.captain_user_id],
      );
      await client.query(
        `UPDATE boats SET review_status=$1, updated_at=now() WHERE id=$2`,
        [decision, appRecord.boat_id],
      );
      await client.query(
        'INSERT INTO review_events (application_id, decision, reason) VALUES ($1,$2,$3)',
        [appRecord.id, decision, decision === 'rejected' ? reason : null],
      );
      await client.query('COMMIT');
      return { id: appRecord.id, status: decision, reason: decision === 'rejected' ? reason : null };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      request.log.error({ err: error }, 'Application review decision failed');
      return sendError(reply, 500, '审核操作失败');
    } finally {
      client.release();
    }
  });

  return { requireUser };
}

export const step1Options = Object.freeze({ marinas: MARINAS, facilities: [...FACILITIES] });
