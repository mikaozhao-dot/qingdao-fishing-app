import test from 'node:test';
import assert from 'node:assert/strict';
import { registerStep2Routes } from '../src/step2-routes.js';
import {
  serializeActivityMatchingSettings,
  validateActivityMatchingSettings,
} from '../src/activity-matching-settings.js';
import { FISH_CATALOG } from '../src/step2-catalog.js';

const marinaNames = { xiaogang: '小港', shazikou: '沙子口' };
const marinaCodes = new Set(Object.keys(marinaNames));
const fishCodes = new Set(FISH_CATALOG.map(({ code }) => code));

test('activity matching settings accept known, distinct selections and preserve order', () => {
  assert.deepEqual(validateActivityMatchingSettings({
    serviceMarinaCodes: ['shazikou', 'xiaogang'],
    fishTargetCodes: ['sea_bass', 'blackhead'],
  }, marinaCodes, fishCodes), {
    value: {
      serviceMarinaCodes: ['shazikou', 'xiaogang'],
      fishTargetCodes: ['sea_bass', 'blackhead'],
    },
  });
});

test('activity matching settings allow explicit empty selections', () => {
  assert.deepEqual(validateActivityMatchingSettings({
    serviceMarinaCodes: [],
    fishTargetCodes: [],
  }, marinaCodes, fishCodes), {
    value: { serviceMarinaCodes: [], fishTargetCodes: [] },
  });
});

test('activity matching settings reject malformed arrays, unknown codes, and duplicates', () => {
  assert.equal(validateActivityMatchingSettings(null, marinaCodes, fishCodes).error, '匹配偏好内容无效');
  assert.equal(validateActivityMatchingSettings({ serviceMarinaCodes: 'xiaogang', fishTargetCodes: [] }, marinaCodes, fishCodes).error, '服务码头需为数组');
  assert.equal(validateActivityMatchingSettings({ serviceMarinaCodes: ['other'], fishTargetCodes: [] }, marinaCodes, fishCodes).error, '服务码头包含无效选项');
  assert.equal(validateActivityMatchingSettings({ serviceMarinaCodes: ['xiaogang', 'xiaogang'], fishTargetCodes: [] }, marinaCodes, fishCodes).error, '服务码头不能重复');
  assert.equal(validateActivityMatchingSettings({ serviceMarinaCodes: [], fishTargetCodes: ['not-a-fish'] }, marinaCodes, fishCodes).error, '目标鱼种包含无效选项');
  assert.equal(validateActivityMatchingSettings({ serviceMarinaCodes: [], fishTargetCodes: ['sea_bass', 'sea_bass'] }, marinaCodes, fishCodes).error, '目标鱼种不能重复');
});

test('activity matching settings serialize maintained codes with platform labels', () => {
  assert.deepEqual(serializeActivityMatchingSettings({
    serviceMarinaCodes: ['xiaogang'],
    fishTargetCodes: ['sea_bass'],
    marinas: marinaNames,
    fishCatalog: FISH_CATALOG,
  }), {
    serviceMarinaCodes: ['xiaogang'],
    serviceMarinas: [{ code: 'xiaogang', name: '小港' }],
    fishTargetCodes: ['sea_bass'],
    fishTargets: [{ code: 'sea_bass', name: '鲈鱼' }],
  });
});

function fakePool() {
  const state = {
    serviceMarinaCodes: ['xiaogang'],
    fishTargetCodes: ['sea_bass'],
    captainApproved: true,
    connectCount: 0,
  };
  const client = {
    staged: null,
    async query(sql, values = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalized === 'begin') {
        this.staged = {
          serviceMarinaCodes: [...state.serviceMarinaCodes],
          fishTargetCodes: [...state.fishTargetCodes],
        };
        return { rowCount: 0, rows: [] };
      }
      if (normalized.includes('from captain_profiles') && normalized.includes('for update')) {
        return { rowCount: state.captainApproved ? 1 : 0, rows: state.captainApproved ? [{ user_id: values[0] }] : [] };
      }
      if (normalized.startsWith('delete from captain_service_marinas')) {
        this.staged.serviceMarinaCodes = [];
        return { rowCount: 1, rows: [] };
      }
      if (normalized.startsWith('delete from captain_fish_targets')) {
        this.staged.fishTargetCodes = [];
        return { rowCount: 1, rows: [] };
      }
      if (normalized.startsWith('insert into captain_service_marinas')) {
        this.staged.serviceMarinaCodes = [...values[1]];
        return { rowCount: values[1].length, rows: [] };
      }
      if (normalized.startsWith('insert into captain_fish_targets')) {
        this.staged.fishTargetCodes = [...values[1]];
        return { rowCount: values[1].length, rows: [] };
      }
      if (normalized === 'commit') {
        state.serviceMarinaCodes = [...this.staged.serviceMarinaCodes];
        state.fishTargetCodes = [...this.staged.fishTargetCodes];
        this.staged = null;
        return { rowCount: 0, rows: [] };
      }
      if (normalized === 'rollback') {
        this.staged = null;
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`Unexpected client query: ${normalized}`);
    },
    release() {},
  };
  return {
    state,
    async query(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalized.includes('from captain_profiles')) {
        return { rowCount: state.captainApproved ? 1 : 0, rows: state.captainApproved ? [{ user_id: 'captain-1' }] : [] };
      }
      if (normalized.includes('from captain_service_marinas')) {
        return { rowCount: state.serviceMarinaCodes.length, rows: state.serviceMarinaCodes.map((marina_code) => ({ marina_code })) };
      }
      if (normalized.includes('from captain_fish_targets')) {
        return { rowCount: state.fishTargetCodes.length, rows: state.fishTargetCodes.map((fish_code) => ({ fish_code })) };
      }
      throw new Error(`Unexpected pool query: ${normalized}`);
    },
    async connect() {
      state.connectCount += 1;
      return client;
    },
  };
}

function matchingSettingsRoutes(pool) {
  const routes = [];
  const app = {
    get(path, options, handler) { routes.push({ method: 'GET', path, options, handler }); },
    post(path, options, handler) { routes.push({ method: 'POST', path, options, handler }); },
    put(path, options, handler) { routes.push({ method: 'PUT', path, options, handler }); },
  };
  const requireUser = async () => {};
  registerStep2Routes(app, {
    pool,
    config: { uploadDir: '/tmp/qingdao-fishing-activity-settings-test' },
    requireUser,
  });
  return routes.filter((route) => route.path === '/captain/activity-matching-settings');
}

function fakeReply() {
  return {
    statusCode: 200,
    payload: null,
    code(statusCode) { this.statusCode = statusCode; return this; },
    send(payload) { this.payload = payload; return payload; },
  };
}

test('captain activity matching settings GET is captain-scoped and returns maintained values', async () => {
  const pool = fakePool();
  const routes = matchingSettingsRoutes(pool);
  const route = routes.find((entry) => entry.method === 'GET');
  const reply = fakeReply();
  const result = await route.handler({ user: { id: 'captain-1' } }, reply);

  assert.equal(route.options.preHandler instanceof Function, true);
  assert.deepEqual(result.settings.serviceMarinaCodes, ['xiaogang']);
  assert.deepEqual(result.settings.fishTargetCodes, ['sea_bass']);
});

test('captain activity matching settings PUT atomically replaces selections', async () => {
  const pool = fakePool();
  const routes = matchingSettingsRoutes(pool);
  const route = routes.find((entry) => entry.method === 'PUT');
  const reply = fakeReply();
  const result = await route.handler({
    user: { id: 'captain-1' },
    body: { serviceMarinaCodes: ['shazikou', 'xiaogang'], fishTargetCodes: ['blackhead'] },
    log: { error() {} },
  }, reply);

  assert.deepEqual(pool.state.serviceMarinaCodes, ['shazikou', 'xiaogang']);
  assert.deepEqual(pool.state.fishTargetCodes, ['blackhead']);
  assert.deepEqual(result.settings.serviceMarinaCodes, ['shazikou', 'xiaogang']);
  assert.equal(pool.state.connectCount, 1);
});

test('captain activity matching settings PUT rejects invalid codes without writing', async () => {
  const pool = fakePool();
  const routes = matchingSettingsRoutes(pool);
  const route = routes.find((entry) => entry.method === 'PUT');
  const reply = fakeReply();
  await route.handler({
    user: { id: 'captain-1' },
    body: { serviceMarinaCodes: ['unknown'], fishTargetCodes: [] },
    log: { error() {} },
  }, reply);

  assert.equal(reply.statusCode, 400);
  assert.equal(pool.state.connectCount, 0);
  assert.deepEqual(pool.state.serviceMarinaCodes, ['xiaogang']);
});

test('unapproved captains cannot read or write activity matching settings', async () => {
  const pool = fakePool();
  pool.state.captainApproved = false;
  const routes = matchingSettingsRoutes(pool);
  for (const method of ['GET', 'PUT']) {
    const route = routes.find((entry) => entry.method === method);
    const reply = fakeReply();
    const result = await route.handler({
      user: { id: 'captain-1' },
      body: { serviceMarinaCodes: [], fishTargetCodes: [] },
    }, reply);
    assert.equal(reply.statusCode, 403);
    assert.equal(result.error, '船长资质尚未审核通过');
  }
  assert.equal(pool.state.connectCount, 0);
});
