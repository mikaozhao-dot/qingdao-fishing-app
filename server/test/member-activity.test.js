import test from 'node:test';
import assert from 'node:assert/strict';
import { expireMemberActivityRequests, registerMemberActivityRoutes } from '../src/member-activity-routes.js';
import {
  containsExternalContact,
  serializeMemberActivityRequest,
  validateMemberActivityRequestFilters,
  validateMemberActivityRequest,
} from '../src/member-activity-service.js';
import { step1Options } from '../src/step1-routes.js';
import { FISH_CATALOG, TARGET_AREAS } from '../src/step2-catalog.js';

const now = new Date('2026-10-30T04:00:00.000Z');
const body = {
  departureDate: '2026-11-01',
  startTime: '06:00',
  endTime: '13:00',
  marinaCode: Object.keys(step1Options.marinas)[0],
  targetAreaCode: Object.keys(TARGET_AREAS)[0],
  partySize: 4,
  bookingType: 'shared',
  fishCodes: [FISH_CATALOG[0].code],
  fishingMethods: ['船钓'],
  minBudgetFen: 30000,
  maxBudgetFen: 60000,
  gearRequirements: '船竿可借用',
  beginnerFriendly: true,
  childrenAllowed: false,
  notes: '可接受拼船',
};

function validation(bodyValue = body) {
  return validateMemberActivityRequest(bodyValue, {
    marinaCodes: new Set(Object.keys(step1Options.marinas)),
    targetAreaCodes: new Set(Object.keys(TARGET_AREAS)),
    fishCodes: new Set(FISH_CATALOG.map(({ code }) => code)),
    now,
  });
}

function filterValidation(query) {
  return validateMemberActivityRequestFilters(query, {
    marinaCodes: new Set(Object.keys(step1Options.marinas)),
    fishCodes: new Set(FISH_CATALOG.map(({ code }) => code)),
  });
}

test('member activity plaza filters accept all five supported dimensions', () => {
  const result = filterValidation({
    marinaCode: body.marinaCode,
    departureDate: '2026-11-01',
    partySize: '4',
    fishCode: FISH_CATALOG[0].code,
    bookingType: 'shared',
  });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.value, {
    marinaCode: body.marinaCode,
    departureDate: '2026-11-01',
    partySize: 4,
    fishCode: FISH_CATALOG[0].code,
    bookingType: 'shared',
  });
});

test('member activity plaza filters reject unknown, malformed, and out-of-range values', () => {
  assert.match(filterValidation({ marinaCode: 'unknown' }).error, /出发码头/);
  assert.match(filterValidation({ departureDate: '2026-02-30' }).error, /日期/);
  assert.match(filterValidation({ partySize: '0' }).error, /1–30/);
  assert.match(filterValidation({ fishCode: 'unknown' }).error, /鱼种/);
  assert.match(filterValidation({ bookingType: 'auction' }).error, /包船\/拼船/);
  assert.match(filterValidation({ unexpected: 'value' }).error, /不支持/);
});

test('member activity request validation normalizes Shanghai time and optional requirements', () => {
  const result = validation();
  assert.equal(result.error, undefined);
  assert.equal(result.value.requestedStartAt.toISOString(), '2026-10-31T22:00:00.000Z');
  assert.equal(result.value.requestedEndAt.toISOString(), '2026-11-01T05:00:00.000Z');
  assert.deepEqual(result.value.fishingMethods, ['船钓']);
});

test('member activity request time window can cross midnight and remains at most 24 hours', () => {
  const overnight = validation({ ...body, startTime: '20:00', endTime: '02:00' });
  assert.equal(overnight.error, undefined);
  assert.equal(overnight.value.requestedEndAt.toISOString(), '2026-11-01T18:00:00.000Z');
  assert.equal(validation({ ...body, startTime: '06:00', endTime: '06:00' }).error, undefined);
});

test('member activity request validation rejects invalid catalogs, budget, time, and oversized parties', () => {
  assert.match(validation({ ...body, marinaCode: 'unknown' }).error, /出发码头/);
  assert.match(validation({ ...body, fishCodes: ['unknown'] }).error, /平台鱼种库/);
  assert.match(validation({ ...body, minBudgetFen: 60000, maxBudgetFen: 30000 }).error, /预算区间/);
  assert.match(validation({ ...body, partySize: 31 }).error, /人数/);
  assert.match(validation({ ...body, departureDate: '2026-10-30', startTime: '06:00', endTime: '13:00' }).error, /已过期/);
});

test('member activity contact filter rejects mobile and WeChat identifiers', () => {
  assert.equal(containsExternalContact('联系 138 0013 8000'), true);
  assert.equal(containsExternalContact('微信号：wxid_fishing2026'), true);
  assert.equal(containsExternalContact('正常需求说明'), false);
  assert.match(validation({ ...body, notes: '加我微信 wxid_fishing2026' }).error, /联系方式/);
});

test('member activity request serialization returns the public request fields without owner identity', () => {
  const row = {
    id: 'request-1', member_user_id: 'private-user-id', departure_date: '2026-11-01',
    requested_start_at: '2026-10-31T22:00:00Z', requested_end_at: '2026-11-01T05:00:00Z',
    marina_code: 'xiaogang', target_area_code: 'qingdao_nearshore', party_size: 4,
    booking_type: 'shared', fish_codes: ['yellow_croaker'], fishing_methods: ['船钓'],
    min_budget_fen: 30000, max_budget_fen: null, gear_requirements: '',
    beginner_friendly: true, children_allowed: false, notes: '', status: 'published',
    expires_at: '2026-11-01T00:00:00Z', converted_departure_id: null,
    created_at: '2026-10-30T04:00:00Z', updated_at: '2026-10-30T04:00:00Z',
  };
  const serialized = serializeMemberActivityRequest(row);
  assert.equal(serialized.partySize, 4);
  assert.equal(serialized.minBudgetFen, 30000);
  assert.equal(Object.hasOwn(serialized, 'memberUserId'), false);
});

function fakePool({ verified = true, activeCount = 0, dailyCount = 0, expireOnPoll = false } = {}) {
  const state = { verified, activeCount, dailyCount, expireOnPoll, request: null, facts: [] };
  const client = {
    async query(sql, values = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') {
        return { rowCount: 0, rows: [] };
      }
      if (normalized.includes('from users') && normalized.includes('for update')) {
        return { rowCount: state.verified ? 1 : 0, rows: state.verified ? [{ id: values[0] }] : [] };
      }
      if (normalized.includes('count(*)::integer') && normalized.includes("status='published'")) {
        return { rowCount: 1, rows: [{ count: state.activeCount }] };
      }
      if (normalized.includes('count(*)::integer') && normalized.includes('date_trunc')) {
        return { rowCount: 1, rows: [{ count: state.dailyCount }] };
      }
      if (normalized.startsWith('insert into member_activity_requests')) {
        const [memberUserId, departureDate, startAt, endAt, marinaCode, targetAreaCode,
          partySize, bookingType, fishCodes, fishingMethods, minBudgetFen, maxBudgetFen,
          gearRequirements, beginnerFriendly, childrenAllowed, notes] = values;
        state.request = {
          id: '11111111-1111-4111-8111-111111111111', member_user_id: memberUserId, departure_date: departureDate,
          requested_start_at: startAt, requested_end_at: endAt, marina_code: marinaCode,
          target_area_code: targetAreaCode, party_size: partySize, booking_type: bookingType,
          fish_codes: fishCodes, fishing_methods: fishingMethods, min_budget_fen: minBudgetFen,
          max_budget_fen: maxBudgetFen, gear_requirements: gearRequirements,
          beginner_friendly: beginnerFriendly, children_allowed: childrenAllowed, notes,
          status: 'published', expires_at: startAt, converted_departure_id: null,
          created_at: now, updated_at: now,
        };
        return { rowCount: 1, rows: [state.request] };
      }
      if (normalized.startsWith("update member_activity_requests set status='closed'")) {
        if (!state.request || state.request.id !== values[0] || state.request.member_user_id !== values[1]
            || state.request.status !== 'published') return { rowCount: 0, rows: [] };
        state.request.status = 'closed';
        return { rowCount: 1, rows: [{ id: state.request.id }] };
      }
      if (normalized.startsWith('update member_activity_requests set departure_date=')) {
        if (!state.request || state.request.id !== values[0] || state.request.member_user_id !== values[1]
            || state.request.status !== 'published') return { rowCount: 0, rows: [] };
        const [, , departureDate, startAt, endAt, marinaCode, targetAreaCode,
          partySize, bookingType, fishCodes, fishingMethods, minBudgetFen, maxBudgetFen,
          gearRequirements, beginnerFriendly, childrenAllowed, notes] = values;
        Object.assign(state.request, {
          departure_date: departureDate, requested_start_at: startAt, requested_end_at: endAt,
          marina_code: marinaCode, target_area_code: targetAreaCode, party_size: partySize,
          booking_type: bookingType, fish_codes: fishCodes, fishing_methods: fishingMethods,
          min_budget_fen: minBudgetFen, max_budget_fen: maxBudgetFen,
          gear_requirements: gearRequirements, beginner_friendly: beginnerFriendly,
          children_allowed: childrenAllowed, notes, expires_at: startAt, updated_at: now,
        });
        return { rowCount: 1, rows: [state.request] };
      }
      if (normalized.startsWith('insert into member_activity_facts')) {
        state.facts.push({ requestId: values[0], actorUserId: values[1], factType: values[2] });
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected client query: ${normalized}`);
    },
    release() {},
  };
  return {
    state,
    async query(sql) {
      assert.match(sql, /WITH expired AS/);
      if (state.expireOnPoll && state.request?.status === 'published') {
        state.request.status = 'expired';
        state.facts.push({ requestId: state.request.id, factType: 'request_expired' });
        return { rowCount: 1, rows: [{ request_id: state.request.id }] };
      }
      return { rowCount: 0, rows: [] };
    },
    async connect() { return client; },
  };
}

function captureRoutes(pool) {
  const routes = [];
  const app = {
    get(path, options, handler) { routes.push({ method: 'GET', path, options, handler }); },
    post(path, options, handler) { routes.push({ method: 'POST', path, options, handler }); },
    put(path, options, handler) { routes.push({ method: 'PUT', path, options, handler }); },
    addHook() {},
    log: { warn() {} },
  };
  registerMemberActivityRoutes(app, { pool, config: { nodeEnv: 'test' }, requireUser: async () => {}, clockNow: () => now });
  return routes;
}

function fakeCaptainPlazaPool({ approved = true, requests = [] } = {}) {
  const state = { approved, requests, queries: [], plazaQuery: null };
  return {
    state,
    async query(sql, values = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      state.queries.push({ sql: normalized, values });
      if (normalized.startsWith('with expired as')) return { rowCount: 0, rows: [] };
      if (normalized.includes('from captain_profiles')) {
        return { rowCount: approved ? 1 : 0, rows: approved ? [{ '?column?': 1 }] : [] };
      }
      if (normalized.includes('from member_activity_requests')) {
        state.plazaQuery = { sql: normalized, values };
        return { rowCount: requests.length, rows: requests };
      }
      throw new Error(`Unexpected captain plaza query: ${normalized}`);
    },
  };
}

function fakeReply() {
  return {
    statusCode: 200,
    payload: null,
    code(statusCode) { this.statusCode = statusCode; return this; },
    send(payload) { this.payload = payload; return payload; },
  };
}

test('publishing requires verified identity and records the request fact', async () => {
  const pool = fakePool();
  const route = captureRoutes(pool).find((item) => item.method === 'POST' && item.path === '/member/activity-requests');
  const reply = fakeReply();
  const response = await route.handler({ user: { id: 'member-1' }, body, log: { error() {} } }, reply);
  assert.equal(reply.statusCode, 201);
  assert.equal(response.request.id, '11111111-1111-4111-8111-111111111111');
  assert.equal(response.request.expiresAt, '2026-10-31T22:00:00.000Z');
  assert.deepEqual(pool.state.facts, [{
    requestId: '11111111-1111-4111-8111-111111111111',
    actorUserId: 'member-1',
    factType: 'request_published',
  }]);
});

test('publishing rejects unverified members and both three-request limits', async () => {
  for (const pool of [fakePool({ verified: false }), fakePool({ activeCount: 3 }), fakePool({ dailyCount: 3 })]) {
    const route = captureRoutes(pool).find((item) => item.method === 'POST' && item.path === '/member/activity-requests');
    const reply = fakeReply();
    await route.handler({ user: { id: 'member-1' }, body, log: { error() {} } }, reply);
    assert.equal(reply.statusCode, pool.state.verified ? 409 : 403);
    assert.equal(pool.state.request, null);
  }
});

test('a member can edit and close a published request with append-only facts', async () => {
  const pool = fakePool();
  const routes = captureRoutes(pool);
  const create = routes.find((item) => item.method === 'POST' && item.path === '/member/activity-requests');
  const edit = routes.find((item) => item.method === 'PUT' && item.path === '/member/activity-requests/:id');
  const close = routes.find((item) => item.method === 'POST' && item.path === '/member/activity-requests/:id/close');
  const request = {
    user: { id: 'member-1' }, body, log: { error() {} },
    params: { id: '11111111-1111-4111-8111-111111111111' },
  };
  await create.handler(request, fakeReply());
  const editReply = fakeReply();
  const edited = await edit.handler({ ...request, body: { ...body, notes: '接受同船拼友' } }, editReply);
  assert.equal(editReply.statusCode, 200);
  assert.equal(edited.request.notes, '接受同船拼友');
  const closed = await close.handler(request, fakeReply());
  assert.deepEqual(closed, { id: request.params.id, status: 'closed' });
  assert.deepEqual(pool.state.facts.map((fact) => fact.factType), [
    'request_published', 'request_edited', 'request_closed',
  ]);
});

test('expired requests transition once and receive an expiration fact', async () => {
  const pool = fakePool({ expireOnPoll: true });
  const routes = captureRoutes(pool);
  const create = routes.find((item) => item.method === 'POST' && item.path === '/member/activity-requests');
  await create.handler({ user: { id: 'member-1' }, body, log: { error() {} } }, fakeReply());
  assert.equal(await expireMemberActivityRequests(pool), 1);
  assert.equal(pool.state.request.status, 'expired');
  assert.equal(pool.state.facts.filter((fact) => fact.factType === 'request_expired').length, 1);
});

test('captain demand plaza requires approval and applies parameterized filters without exposing member identity', async () => {
  const requestRow = {
    id: '22222222-2222-4222-8222-222222222222', member_user_id: 'private-member-id',
    departure_date: '2026-11-01', requested_start_at: '2026-10-31T22:00:00Z',
    requested_end_at: '2026-11-01T05:00:00Z', marina_code: body.marinaCode,
    target_area_code: body.targetAreaCode, party_size: 4, booking_type: 'shared',
    fish_codes: [FISH_CATALOG[0].code], fishing_methods: [], min_budget_fen: 30000,
    max_budget_fen: 60000, gear_requirements: '', beginner_friendly: true,
    children_allowed: false, notes: '', status: 'published', expires_at: '2026-11-01T05:00:00Z',
    converted_departure_id: null, created_at: now, updated_at: now,
  };
  const pool = fakeCaptainPlazaPool({ requests: [requestRow] });
  const route = captureRoutes(pool).find((item) => item.method === 'GET'
    && item.path === '/captain/member/activity-requests');
  const response = await route.handler({
    user: { id: 'captain-1' },
    query: {
      marinaCode: body.marinaCode,
      departureDate: '2026-11-01',
      partySize: '4',
      fishCode: FISH_CATALOG[0].code,
      bookingType: 'shared',
    },
  }, fakeReply());

  assert.equal(response.items.length, 1);
  assert.equal(Object.hasOwn(response.items[0], 'memberUserId'), false);
  assert.match(pool.state.plazaQuery.sql, /status='published'/);
  assert.match(pool.state.plazaQuery.sql, /expires_at > \$1/);
  assert.match(pool.state.plazaQuery.sql, /marina_code=\$2/);
  assert.match(pool.state.plazaQuery.sql, /departure_date=\$3::date/);
  assert.match(pool.state.plazaQuery.sql, /party_size=\$4::smallint/);
  assert.match(pool.state.plazaQuery.sql, /fish_codes @> array\[\$5::varchar\]/);
  assert.match(pool.state.plazaQuery.sql, /booking_type=\$6/);
  assert.deepEqual(pool.state.plazaQuery.values, [
    now.toISOString(), body.marinaCode, '2026-11-01', 4, FISH_CATALOG[0].code, 'shared',
  ]);
  assert.equal(pool.state.plazaQuery.sql.includes(FISH_CATALOG[0].code), false);
});

test('captain demand plaza rejects unapproved captains and invalid filters before listing', async () => {
  const unapproved = fakeCaptainPlazaPool({ approved: false });
  const route = captureRoutes(unapproved).find((item) => item.method === 'GET'
    && item.path === '/captain/member/activity-requests');
  const denied = fakeReply();
  await route.handler({ user: { id: 'captain-1' }, query: {} }, denied);
  assert.equal(denied.statusCode, 403);
  assert.equal(unapproved.state.plazaQuery, null);

  const invalid = fakeCaptainPlazaPool();
  const invalidRoute = captureRoutes(invalid).find((item) => item.method === 'GET'
    && item.path === '/captain/member/activity-requests');
  const invalidReply = fakeReply();
  await invalidRoute.handler({ user: { id: 'captain-1' }, query: { marinaCode: 'bad-code' } }, invalidReply);
  assert.equal(invalidReply.statusCode, 400);
  assert.equal(invalid.state.queries.length, 0);
});
