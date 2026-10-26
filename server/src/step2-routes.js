import { createLocalObjectStorage } from './local-object-storage.js';
import { createSecurity } from './security.js';
import { step1Options } from './step1-routes.js';
import {
  BAIT_SUPPLIES,
  BAIT_TYPES,
  FISH_CATALOG,
  LEADER_LINE_NUMBERS,
  MAIN_LINE_PE,
  SINKER_SHAPES,
  TARGET_AREAS,
} from './step2-catalog.js';

const MARINAS = step1Options.marinas;
const FISH_BY_CODE = new Map(FISH_CATALOG.map((fish) => [fish.code, fish]));
const COMFORT_LABELS = Object.freeze({ spacious: '宽松', comfortable: '舒适', compact: '紧凑' });
const TRIP_TYPES = Object.freeze({ experience: '体验班', pro_fishing: '专业拼船' });
const PHOTO_KINDS = new Set(['exterior', 'deck', 'cabin', 'toilet']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const sendError = (reply, statusCode, message) => reply.code(statusCode).send({ error: message });
const sendQuotaError = (reply, statusCode, code, message) =>
  reply.code(statusCode).send({ code, error: message });
const OFFLINE_RELEASE_STATEMENT_VERSION = 'offline-release-v1';
const OFFLINE_RELEASE_STATEMENT = '该席位线下未售、未锁，且已停止线下销售';

function shanghaiParts(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

function localDate(value) {
  const part = shanghaiParts(value);
  return `${part.year}-${part.month}-${part.day}`;
}

function localTime(value) {
  const part = shanghaiParts(value);
  return `${part.hour}:${part.minute}`;
}

function todayInShanghai() {
  return localDate(new Date());
}

function isCalendarDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function localDateTime(date, time) {
  if (!isCalendarDate(date) || typeof time !== 'string' || !TIME_PATTERN.test(time)) return null;
  const result = new Date(`${date}T${time}:00+08:00`);
  return Number.isNaN(result.getTime()) ? null : result;
}

function nextLocalDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function cstTodayStart() {
  return localDateTime(todayInShanghai(), '00:00');
}

function validInteger(value, { min = 0, max = 2_000_000_000 } = {}) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

function validateRig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '请选择完整钓组配置';
  const baitTypes = value.baitTypes;
  if (!Array.isArray(baitTypes) || baitTypes.length < 1 || baitTypes.length > Object.keys(BAIT_TYPES).length) {
    return '请选择 1–8 种饵料';
  }
  if (new Set(baitTypes).size !== baitTypes.length || baitTypes.some((code) => !BAIT_TYPES[code])) {
    return '饵料选项无效';
  }
  const grams = validInteger(value.baitGramsPerPerson, { min: 0, max: 5000 });
  if (grams === null) return '每人饵料用量需为 0–5000 克';
  if (!BAIT_SUPPLIES[value.baitSupply]) return '请选择饵料供给方式';
  const mainLinePe = Number(value.mainLinePe);
  if (!MAIN_LINE_PE.includes(mainLinePe)) return '主线 PE 号不在平台选项内';
  const leaderNumber = validInteger(value.leaderLineNumber, { min: 1, max: 20 });
  if (!LEADER_LINE_NUMBERS.includes(leaderNumber)) return '前导线号数不在平台选项内';
  if (!SINKER_SHAPES[value.sinkerShape]) return '请选择铅坠形状';
  const minGrams = validInteger(value.sinkerMinGrams, { min: 1, max: 5000 });
  const maxGrams = validInteger(value.sinkerMaxGrams, { min: 1, max: 5000 });
  if (minGrams === null || maxGrams === null || minGrams > maxGrams) return '铅坠克数区间无效';
  return null;
}

function validateDepartureBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: '发班内容无效' };
  const boatId = String(body.boatId ?? '').trim();
  const tripType = String(body.tripType ?? '');
  const date = String(body.departureDate ?? '');
  const meetingTime = String(body.meetingTime ?? '');
  const departureTime = String(body.departureTime ?? '');
  const returnTime = String(body.returnTime ?? '');
  const bookingDeadlineTime = String(body.bookingDeadlineTime ?? meetingTime);
  const marinaCode = String(body.marinaCode ?? '');
  const targetAreaCode = String(body.targetAreaCode ?? '');
  const fishCodes = body.fishCodes;
  const pricePerSeatFen = validInteger(body.pricePerSeatFen, { min: 1 });
  const sternSurchargeFen = validInteger(body.sternSurchargeFen, { min: 0 });
  const minimumTotalFen = validInteger(body.minimumTotalFen, { min: 1 });
  const remarks = String(body.remarks ?? '').trim();
  const hasPlatformQuota = Object.hasOwn(body, 'platformQuotaSeats');
  const hasOfflineQuota = Object.hasOwn(body, 'offlineQuotaSeats');
  const manualSupply = body.manualSupply;

  if (manualSupply !== undefined && typeof manualSupply !== 'boolean') return { error: '供给方式无效' };
  if (hasPlatformQuota !== hasOfflineQuota) return { error: '平台与线下配额需要同时填写' };
  if (manualSupply === true && (hasPlatformQuota || hasOfflineQuota)) {
    return { error: '人工确认供给无需填写平台或线下配额' };
  }
  if (manualSupply === false && !hasPlatformQuota) return { error: '请填写平台与线下席位配额' };
  const platformQuotaSeats = hasPlatformQuota
    ? validInteger(body.platformQuotaSeats, { min: 0, max: 30 }) : null;
  const offlineQuotaSeats = hasOfflineQuota
    ? validInteger(body.offlineQuotaSeats, { min: 0, max: 30 }) : null;
  if (hasPlatformQuota && (platformQuotaSeats === null || offlineQuotaSeats === null)) {
    return { error: '平台与线下席位配额需为 0–30 的整数' };
  }
  if (hasPlatformQuota && platformQuotaSeats + offlineQuotaSeats < 1) {
    return { error: '至少分配一个平台或线下席位' };
  }
  if (hasPlatformQuota && platformQuotaSeats === 0 && manualSupply === false) {
    return { error: '没有平台席位时请使用人工确认供给' };
  }

  if (!boatId) return { error: '请选择已审核通过的船档案' };
  if (!TRIP_TYPES[tripType]) return { error: '请选择班次类型' };
  if (!isCalendarDate(date) || date < todayInShanghai()) return { error: '请选择今天或之后的出航日期' };
  if (!TIME_PATTERN.test(meetingTime) || !TIME_PATTERN.test(departureTime) || !TIME_PATTERN.test(returnTime)) {
    return { error: '请选择集合、出航和返港时间' };
  }
  if (!TIME_PATTERN.test(bookingDeadlineTime)) return { error: '请选择报名截止时间' };
  if (meetingTime > departureTime) return { error: '集合时间不能晚于出航时间' };
  if (bookingDeadlineTime > departureTime) return { error: '报名截止时间不能晚于出航时间' };
  if (!MARINAS[marinaCode]) return { error: '请选择集合码头' };
  if (!TARGET_AREAS[targetAreaCode]) return { error: '请选择目标海域' };
  if (!Array.isArray(fishCodes) || fishCodes.length < 1 || fishCodes.length > 3) return { error: '目标鱼种需选择 1–3 种' };
  if (new Set(fishCodes).size !== fishCodes.length || fishCodes.some((code) => !FISH_BY_CODE.has(code))) {
    return { error: '目标鱼种必须来自平台鱼种库' };
  }
  if (pricePerSeatFen === null) return { error: '每位价格需为正整数分' };
  if (sternSurchargeFen === null || pricePerSeatFen + sternSurchargeFen > 2_000_000_000) return { error: '船尾位加价金额无效' };
  if (minimumTotalFen === null) return { error: '最低成行总价需为正整数分' };
  if (remarks.length > 500) return { error: '备注最多 500 个字符' };
  const rigError = validateRig(body.rigConfig);
  if (rigError) return { error: rigError };

  const meetingAt = localDateTime(date, meetingTime);
  const departureAt = localDateTime(date, departureTime);
  const returnDate = returnTime <= departureTime ? nextLocalDate(date) : date;
  const returnAt = localDateTime(returnDate, returnTime);
  const bookingDeadline = localDateTime(date, bookingDeadlineTime);
  if (!meetingAt || !departureAt || !returnAt || !bookingDeadline) return { error: '日期或时间无效' };
  if (meetingAt > departureAt || returnAt <= departureAt || bookingDeadline > departureAt) {
    return { error: '集合、出航、返港和报名截止时间顺序不正确' };
  }
  if (departureAt <= new Date()) return { error: '出航时间必须晚于当前时间' };
  if (bookingDeadline <= new Date()) return { error: '报名截止时间必须晚于当前时间' };

  return {
    value: {
      boatId, tripType, departureDate: date, meetingAt, departureAt, returnAt,
      bookingDeadline, marinaCode, targetAreaCode, fishCodes,
      pricePerSeatFen, sternSurchargeFen, minimumTotalFen,
      remarks, rigConfig: body.rigConfig,
      quotaInput: hasPlatformQuota
        ? { platformQuotaSeats, offlineQuotaSeats }
        : null,
      manualSupplyInput: manualSupply,
    },
  };
}

function departureQuotas(value, seatCount) {
  if (!value.quotaInput) {
    return { platformQuotaSeats: 0, offlineQuotaSeats: seatCount, manualSupply: true };
  }
  const { platformQuotaSeats, offlineQuotaSeats } = value.quotaInput;
  if (platformQuotaSeats + offlineQuotaSeats > seatCount) return { error: '配额总数不能超过船只模板席位数' };
  if (platformQuotaSeats === 0) {
    if (value.manualSupplyInput === false) return { error: '没有平台席位时请使用人工确认供给' };
    return { platformQuotaSeats, offlineQuotaSeats, manualSupply: true };
  }
  return { platformQuotaSeats, offlineQuotaSeats, manualSupply: false };
}

function validTransferRequest(body) {
  const seatNumber = validInteger(body?.seatNumber, { min: 1, max: 30 });
  const sourceChannel = String(body?.sourceChannel ?? '');
  const targetChannel = String(body?.targetChannel ?? '');
  const requestKey = String(body?.requestKey ?? '').trim();
  const releaseConfirmed = body?.releaseConfirmed ?? false;
  if (seatNumber === null) return { error: '席位编号无效' };
  if (!['platform', 'offline'].includes(sourceChannel)
      || !['platform', 'offline'].includes(targetChannel)
      || sourceChannel === targetChannel) return { error: '配额转移方向无效' };
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(requestKey)) return { error: '转移请求编号无效' };
  if (typeof releaseConfirmed !== 'boolean') return { error: '线下释放确认状态无效' };
  if (sourceChannel === 'platform' && releaseConfirmed) return { error: '平台席位不需要线下释放确认' };
  return { value: { seatNumber, sourceChannel, targetChannel, requestKey, releaseConfirmed } };
}

function validOfflineSeatState(body) {
  const seatNumber = validInteger(body?.seatNumber, { min: 1, max: 30 });
  const state = String(body?.state ?? '');
  if (seatNumber === null) return { error: '席位编号无效' };
  if (!['open', 'locked', 'sold'].includes(state)) return { error: '线下席位状态无效' };
  return { value: { seatNumber, state } };
}

function validateSeatLayout(layout, seatCount) {
  if (!Array.isArray(layout) || layout.length !== Number(seatCount) || layout.length < 1 || layout.length > 30) {
    return false;
  }
  const numbers = new Set();
  for (const seat of layout) {
    if (!Number.isInteger(Number(seat.number)) || Number(seat.number) < 1 || Number(seat.number) > layout.length) return false;
    if (!['port', 'starboard'].includes(seat.side) || !['bow', 'mid', 'stern'].includes(seat.section)) return false;
    if (typeof seat.premium !== 'boolean' || numbers.has(Number(seat.number))) return false;
    numbers.add(Number(seat.number));
  }
  return numbers.size === layout.length;
}

function publicPhotoKinds(photos) {
  return Object.fromEntries(['exterior', 'deck', 'cabin', 'toilet']
    .filter((kind) => photos?.[kind])
    .map((kind) => [kind, true]));
}

function departureStatus(status) {
  if (status === 'open') return 'published';
  if (status === 'cancelled') return 'withdrawn';
  if (status === 'completed') return 'ended';
  return status;
}

function serializeDeparture(row, { seats = null, security }) {
  const fishTargets = (row.fish_targets ?? []).map((entry) => {
    const code = typeof entry === 'string' ? entry : entry.code;
    return { code, name: FISH_BY_CODE.get(code)?.name ?? code };
  });
  const minTotal = Number(row.minimum_sailing_total_fen);
  const perSeat = Number(row.price_per_seat_fen);
  const surcharge = Number(row.stern_surcharge_fen ?? 0);
  const captainName = row.captain_name_ciphertext
    ? security.decrypt(row.captain_name_ciphertext)
    : '船长';
  const liveSession = typeof row.live_session === 'string'
    ? JSON.parse(row.live_session)
    : row.live_session;
  const boat = {
    id: row.boat_id,
    name: row.boat_name,
    lengthCm: Number(row.length_cm),
    seatCount: Number(row.boat_seat_count),
    comfortLevel: row.comfort_level,
    comfortLabel: COMFORT_LABELS[row.comfort_level] ?? '待核定',
    estimatedSpacingCm: row.comfort_spacing_cm == null ? null : Number(row.comfort_spacing_cm),
    facilities: row.facilities ?? [],
    seatTemplateCode: row.seat_template_code,
    photoKinds: publicPhotoKinds(row.photos),
  };
  const result = {
    id: row.id,
    captainId: row.captain_user_id,
    status: departureStatus(row.status),
    tripType: row.trip_type,
    tripTypeLabel: TRIP_TYPES[row.trip_type] ?? row.trip_type,
    departureDate: localDate(row.departure_at),
    meetingTime: row.meeting_at ? localTime(row.meeting_at) : null,
    departureTime: localTime(row.departure_at),
    returnTime: localTime(row.return_at),
    targetAreaCode: row.target_area_code,
    targetAreaName: TARGET_AREAS[row.target_area_code] ?? row.target_area_code,
    marinaCode: row.marina_code,
    marinaName: MARINAS[row.marina_code] ?? row.marina_code,
    bookingDeadline: row.booking_deadline,
    fishTargets,
    pricePerSeatFen: perSeat,
    sternSurchargeFen: surcharge,
    premiumSeatPriceFen: perSeat + surcharge,
    minimumTotalFen: minTotal,
    bookedSeatCount: 0,
    bookedAmountFen: 0,
    remainingMinimumFen: minTotal,
    totalSeatCount: boat.seatCount,
    platformQuotaSeats: Number(row.platform_quota_seats ?? 0),
    offlineQuotaSeats: Number(row.offline_quota_seats ?? 0),
    manualSupply: Boolean(row.manual_supply),
    instantConfirmationAvailable: Number(row.platform_quota_seats ?? 0) > 0 && !row.manual_supply,
    remarks: row.remarks ?? '',
    captainName,
    liveStatus: liveSession ? {
      active: true,
      startedAt: liveSession.startedAt,
      profileUrl: row.douyin_profile_url,
    } : null,
    boat,
    createdAt: row.created_at,
  };
  if (row.rig_config) result.rigConfig = row.rig_config;
  if (row.seat_layout) result.seatLayout = row.seat_layout;
  if (seats) result.seats = seats.map((seat) => ({
    number: Number(seat.seat_number),
    side: seat.seat_side,
    section: seat.seat_section,
    premium: seat.is_premium,
    status: seat.status,
    priceFen: Number(seat.price_fen),
  }));
  return result;
}

const DEPARTURE_SELECT = `
  SELECT d.id, d.boat_id, d.captain_user_id, d.trip_type, d.meeting_at,
         d.departure_at, d.return_at, d.target_area_code, d.marina_code,
         d.minimum_sailing_total_fen, d.price_per_seat_fen, d.stern_surcharge_fen,
         d.booking_deadline, d.status, d.remarks, d.created_at,
         d.seat_template_count, d.platform_quota_seats, d.offline_quota_seats, d.manual_supply,
         b.name AS boat_name, b.length_cm, b.seat_count AS boat_seat_count,
         b.seat_template_code, b.comfort_level, b.comfort_spacing_cm, b.facilities,
         cp.captain_name_ciphertext, cp.douyin_profile_url, st.layout AS seat_layout,
         (SELECT jsonb_build_object('sessionId',live.id,'startedAt',live.started_at)
          FROM step5_live_sessions live
          WHERE live.departure_id=d.id AND live.ended_at IS NULL
            AND d.status='in_progress'
            AND EXISTS (SELECT 1 FROM departure_checkins departed
                        WHERE departed.departure_id=d.id AND departed.event='departed'
                          AND departed.captain_user_id=d.captain_user_id)
            AND NOT EXISTS (SELECT 1 FROM departure_checkins returned
                            WHERE returned.departure_id=d.id AND returned.event='returned'
                              AND returned.captain_user_id=d.captain_user_id)
          ORDER BY live.started_at DESC LIMIT 1) AS live_session,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('code', ft.fish_code, 'sortOrder', ft.sort_order)
                                    ORDER BY ft.sort_order)
                   FROM departure_fish_targets ft WHERE ft.departure_id=d.id), '[]'::jsonb) AS fish_targets,
         COALESCE((SELECT jsonb_object_agg(bp.photo_kind, bp.object_uri)
                   FROM boat_photos bp
                   WHERE bp.boat_id=b.id AND bp.photo_kind IN ('exterior','deck','cabin','toilet')), '{}'::jsonb) AS photos
  FROM departures d
  JOIN boats b ON b.id=d.boat_id
  JOIN captain_profiles cp ON cp.user_id=d.captain_user_id
  LEFT JOIN seat_templates st ON st.code=b.seat_template_code`;

async function loadDeparture(pool, id) {
  const result = await pool.query(`${DEPARTURE_SELECT} WHERE d.id=$1`, [id]);
  return result.rows[0] ?? null;
}

async function loadSeats(pool, departureId) {
  const result = await pool.query(
    `SELECT seat_number, seat_side, seat_section, is_premium, status, price_fen
     FROM seat_inventory WHERE departure_id=$1 AND sale_channel='platform' ORDER BY seat_number`,
    [departureId],
  );
  return result.rows;
}

async function updateEndedDepartures(pool) {
  await pool.query(
    `UPDATE departures SET status='completed', updated_at=now()
     WHERE status='open' AND (departure_at AT TIME ZONE 'Asia/Shanghai')::date < $1::date`,
    [todayInShanghai()],
  );
}

async function captainApproved(pool, userId) {
  const result = await pool.query(
    `SELECT 1 FROM captain_profiles
     WHERE user_id=$1 AND verification_status='approved'`,
    [userId],
  );
  return result.rowCount > 0;
}

async function approvedBoatForUpdate(client, boatId, userId) {
  const result = await client.query(
    `SELECT b.id, b.captain_user_id, b.name, b.home_marina_code, b.seat_template_code,
            b.seat_count, b.template_status, st.layout
     FROM boats b
     LEFT JOIN seat_templates st ON st.code=b.seat_template_code
     WHERE b.id=$1 AND b.captain_user_id=$2 AND b.review_status='approved'
       AND b.template_status='ready'
     FOR UPDATE OF b`,
    [boatId, userId],
  );
  const boat = result.rows[0];
  if (!boat || !validateSeatLayout(boat.layout, boat.seat_count)) return null;
  return boat;
}

async function insertDeparture(client, boat, userId, value) {
  const inserted = await client.query(
    `INSERT INTO departures
       (boat_id, captain_user_id, trip_type, departure_at, meeting_at, return_at,
        target_area_code, marina_code, minimum_sailing_total_fen, price_per_seat_fen,
        whole_boat_price_fen, booking_deadline, status, stern_surcharge_fen, remarks,
        seat_template_count, platform_quota_seats, offline_quota_seats, manual_supply,
        seat_layout_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,$11,'open',$12,$13,$14,$15,$16,$17,$18)
     RETURNING id`,
    [boat.id, userId, value.tripType, value.departureAt, value.meetingAt, value.returnAt,
      value.targetAreaCode, value.marinaCode, value.minimumTotalFen, value.pricePerSeatFen,
      value.bookingDeadline, value.sternSurchargeFen, value.remarks,
      Number(boat.seat_count ?? boat.seatCount ?? boat.layout.length),
      value.platformQuotaSeats, value.offlineQuotaSeats, value.manualSupply,
      JSON.stringify(boat.layout)],
  );
  const departureId = inserted.rows[0].id;
  await client.query(
    `INSERT INTO departure_fish_targets (departure_id, fish_code, sort_order)
     SELECT $1, target.code, (target.ordinality - 1)::smallint
     FROM unnest($2::varchar[]) WITH ORDINALITY AS target(code, ordinality)`,
    [departureId, value.fishCodes],
  );
  const rig = value.rigConfig;
  await client.query(
    `INSERT INTO departure_rig_configs
       (departure_id, bait_types, bait_grams_per_person, bait_supply, main_line_pe,
        leader_line_number, sinker_shape, sinker_min_grams, sinker_max_grams)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [departureId, rig.baitTypes, Number(rig.baitGramsPerPerson), rig.baitSupply,
      Number(rig.mainLinePe), Number(rig.leaderLineNumber), rig.sinkerShape,
      Number(rig.sinkerMinGrams), Number(rig.sinkerMaxGrams)],
  );
  await client.query(
    `INSERT INTO seat_inventory
       (departure_id, seat_number, price_fen, seat_side, seat_section, is_premium)
     SELECT $1, seat.number,
            $3 + CASE WHEN seat.premium THEN $4 ELSE 0 END,
            seat.side, seat.section, seat.premium
     FROM jsonb_to_recordset($2::jsonb)
       AS seat(number smallint, side varchar, section varchar, premium boolean)
     JOIN departure_seat_quotas quota
       ON quota.departure_id=$1 AND quota.seat_number=seat.number AND quota.sale_channel='platform'`,
    [departureId, JSON.stringify(boat.layout), value.pricePerSeatFen, value.sternSurchargeFen],
  );
  return departureId;
}

function optionsPayload() {
  const month = Number(shanghaiParts(new Date()).month);
  return {
    marinas: Object.entries(MARINAS).map(([code, name]) => ({ code, name })),
    targetAreas: Object.entries(TARGET_AREAS).map(([code, name]) => ({ code, name })),
    tripTypes: Object.entries(TRIP_TYPES).map(([code, name]) => ({ code, name })),
    fish: FISH_CATALOG.map(({ code, name, months, rigPreset }) => ({
      code, name, months, inSeason: months.includes(month), rigPreset,
    })),
    baitTypes: Object.entries(BAIT_TYPES).map(([code, name]) => ({ code, name })),
    baitSupplies: Object.entries(BAIT_SUPPLIES).map(([code, name]) => ({ code, name })),
    mainLinePe: MAIN_LINE_PE,
    leaderLineNumbers: LEADER_LINE_NUMBERS,
    sinkerShapes: Object.entries(SINKER_SHAPES).map(([code, name]) => ({ code, name })),
    sinkerWeightsGrams: [20, 30, 40, 60, 80, 100, 120, 150, 180, 200],
    statusOptions: [{ code: 'published', name: '报名中' }],
  };
}

function addCondition(conditions, values, sql, value) {
  values.push(value);
  conditions.push(sql.replace('?', `$${values.length}`));
}

function buildDepartureFilters(query) {
  const conditions = ["d.status='open'", 'd.departure_at > now()'];
  const values = [];
  const invalid = (error) => ({ error });
  const dateFrom = query.dateFrom == null ? '' : String(query.dateFrom);
  const dateTo = query.dateTo == null ? '' : String(query.dateTo);
  if (dateFrom && !isCalendarDate(dateFrom)) return invalid('筛选开始日期无效');
  if (dateTo && !isCalendarDate(dateTo)) return invalid('筛选结束日期无效');
  if (dateFrom && dateTo && dateFrom > dateTo) return invalid('日期区间顺序无效');
  if (dateFrom) addCondition(conditions, values, "(d.departure_at AT TIME ZONE 'Asia/Shanghai')::date >= ?::date", dateFrom);
  if (dateTo) addCondition(conditions, values, "(d.departure_at AT TIME ZONE 'Asia/Shanghai')::date <= ?::date", dateTo);

  const comfort = query.comfortLevel == null ? '' : String(query.comfortLevel);
  if (comfort && !COMFORT_LABELS[comfort]) return invalid('舒适度筛选值无效');
  if (comfort) addCondition(conditions, values, 'b.comfort_level = ?', comfort);

  const boatSize = query.boatSize == null ? '' : String(query.boatSize);
  if (boatSize === 'under_12') conditions.push('b.length_cm < 1200');
  else if (boatSize === '12_14') conditions.push('b.length_cm >= 1200 AND b.length_cm < 1400');
  else if (boatSize === '14_plus') conditions.push('b.length_cm >= 1400');
  else if (boatSize && boatSize !== 'all') return invalid('船长筛选值无效');

  const marinaCode = query.marinaCode == null ? '' : String(query.marinaCode);
  if (marinaCode && !MARINAS[marinaCode]) return invalid('集合码头筛选值无效');
  if (marinaCode) addCondition(conditions, values, 'd.marina_code = ?', marinaCode);

  const fishCode = query.fishCode == null ? '' : String(query.fishCode);
  if (fishCode && !FISH_BY_CODE.has(fishCode)) return invalid('鱼种筛选值无效');
  if (fishCode) addCondition(conditions, values,
    'EXISTS (SELECT 1 FROM departure_fish_targets f WHERE f.departure_id=d.id AND f.fish_code=?)', fishCode);

  const targetAreaCode = query.targetAreaCode == null ? '' : String(query.targetAreaCode);
  if (targetAreaCode && !TARGET_AREAS[targetAreaCode]) return invalid('海域筛选值无效');
  if (targetAreaCode) addCondition(conditions, values, 'd.target_area_code = ?', targetAreaCode);

  const timeSlot = query.timeSlot == null ? '' : String(query.timeSlot);
  if (timeSlot && !['morning', 'day', 'evening'].includes(timeSlot)) return invalid('出发时段筛选值无效');
  if (timeSlot === 'morning') conditions.push("EXTRACT(HOUR FROM d.departure_at AT TIME ZONE 'Asia/Shanghai') >= 4 AND EXTRACT(HOUR FROM d.departure_at AT TIME ZONE 'Asia/Shanghai') < 10");
  if (timeSlot === 'day') conditions.push("EXTRACT(HOUR FROM d.departure_at AT TIME ZONE 'Asia/Shanghai') >= 10 AND EXTRACT(HOUR FROM d.departure_at AT TIME ZONE 'Asia/Shanghai') < 16");
  if (timeSlot === 'evening') conditions.push("(EXTRACT(HOUR FROM d.departure_at AT TIME ZONE 'Asia/Shanghai') >= 16 OR EXTRACT(HOUR FROM d.departure_at AT TIME ZONE 'Asia/Shanghai') < 4)");

  const minPriceFen = query.minPriceFen == null || query.minPriceFen === '' ? null : validInteger(query.minPriceFen);
  const maxPriceFen = query.maxPriceFen == null || query.maxPriceFen === '' ? null : validInteger(query.maxPriceFen);
  if (query.minPriceFen != null && query.minPriceFen !== '' && minPriceFen === null) return invalid('最低价格筛选值无效');
  if (query.maxPriceFen != null && query.maxPriceFen !== '' && maxPriceFen === null) return invalid('最高价格筛选值无效');
  if (minPriceFen !== null && maxPriceFen !== null && minPriceFen > maxPriceFen) return invalid('价格区间顺序无效');
  if (minPriceFen !== null) addCondition(conditions, values, 'd.price_per_seat_fen >= ?', minPriceFen);
  if (maxPriceFen !== null) addCondition(conditions, values, 'd.price_per_seat_fen <= ?', maxPriceFen);

  const status = query.status == null ? '' : String(query.status);
  if (status && status !== 'all' && status !== 'published') return invalid('公开活动仅支持筛选报名中的班次');
  if (status === 'published') conditions.push("d.status='open'");
  const tripType = query.tripType == null ? '' : String(query.tripType);
  if (tripType && !TRIP_TYPES[tripType]) return invalid('班次类型筛选值无效');
  if (tripType) addCondition(conditions, values, 'd.trip_type = ?', tripType);
  return { conditions, values };
}

export function registerStep2Routes(app, { pool, config, requireUser }) {
  const security = createSecurity(config);
  const storage = createLocalObjectStorage(config.uploadDir);

  app.get('/step2/options', { preHandler: requireUser }, async () => optionsPayload());

  app.get('/captain/departure-context', { preHandler: requireUser }, async (request, reply) => {
    if (!await captainApproved(pool, request.user.id)) return sendError(reply, 403, '船长资质尚未审核通过');
    const result = await pool.query(
      `SELECT b.id, b.name, b.length_cm, b.home_marina_code, b.facilities,
              b.seat_template_code, b.seat_count, b.comfort_level,
              b.comfort_spacing_cm, st.layout,
              COALESCE((SELECT jsonb_object_agg(bp.photo_kind, bp.object_uri)
                        FROM boat_photos bp
                        WHERE bp.boat_id=b.id AND bp.photo_kind IN ('exterior','deck','cabin','toilet')), '{}'::jsonb) AS photos
       FROM boats b LEFT JOIN seat_templates st ON st.code=b.seat_template_code
       WHERE b.captain_user_id=$1 AND b.review_status='approved' AND b.template_status='ready'
       ORDER BY b.created_at ASC`,
      [request.user.id],
    );
    return {
      boats: result.rows.map((boat) => ({
        id: boat.id,
        name: boat.name,
        lengthCm: Number(boat.length_cm),
        defaultMarinaCode: boat.home_marina_code,
        facilities: boat.facilities,
        seatTemplateCode: boat.seat_template_code,
        seatCount: Number(boat.seat_count),
        comfortLevel: boat.comfort_level,
        comfortLabel: COMFORT_LABELS[boat.comfort_level] ?? '待核定',
        estimatedSpacingCm: boat.comfort_spacing_cm == null ? null : Number(boat.comfort_spacing_cm),
        seatLayout: validateSeatLayout(boat.layout, boat.seat_count) ? boat.layout : [],
        photoKinds: publicPhotoKinds(boat.photos),
      })),
      options: optionsPayload(),
    };
  });

  app.post('/captain/departures', { preHandler: requireUser }, async (request, reply) => {
    if (!await captainApproved(pool, request.user.id)) return sendError(reply, 403, '船长资质尚未审核通过');
    const validated = validateDepartureBody(request.body);
    if (validated.error) return sendError(reply, 400, validated.error);
    const client = await pool.connect();
    let departureId;
    try {
      await client.query('BEGIN');
      const boat = await approvedBoatForUpdate(client, validated.value.boatId, request.user.id);
      if (!boat) {
        await client.query('ROLLBACK');
        return sendError(reply, 403, '只能使用已审核且钓位模板可用的船档案发班');
      }
      const quotas = departureQuotas(validated.value, Number(boat.seat_count));
      if (quotas.error) {
        await client.query('ROLLBACK');
        return sendError(reply, 400, quotas.error);
      }
      departureId = await insertDeparture(client, boat, request.user.id, {
        ...validated.value,
        ...quotas,
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      request.log.error({ err: error }, 'Step 2 departure publish failed');
      return sendError(reply, 500, '发班失败，请稍后重试');
    } finally {
      client.release();
    }
    const row = await loadDeparture(pool, departureId);
    const seats = await loadSeats(pool, departureId);
    return reply.code(201).send({ departure: serializeDeparture(row, { seats, security }) });
  });

  app.get('/captain/departures', { preHandler: requireUser }, async (request, reply) => {
    if (!await captainApproved(pool, request.user.id)) return sendError(reply, 403, '船长资质尚未审核通过');
    await updateEndedDepartures(pool);
    const result = await pool.query(`${DEPARTURE_SELECT}
      WHERE d.captain_user_id=$1 ORDER BY d.departure_at DESC`, [request.user.id]);
    return {
      items: result.rows.map((row) => serializeDeparture(row, { security })),
    };
  });

  app.get('/captain/departures/:id/offline-seats', { preHandler: requireUser }, async (request, reply) => {
    if (!await captainApproved(pool, request.user.id)) return sendError(reply, 403, '船长资质尚未审核通过');
    const departure = await pool.query(
      `SELECT id FROM departures WHERE id=$1 AND captain_user_id=$2`,
      [request.params.id, request.user.id],
    );
    if (!departure.rowCount) return sendError(reply, 404, '班次不存在');
    const seats = await pool.query(
      `SELECT seat_number,offline_state FROM departure_seat_quotas
       WHERE departure_id=$1 AND sale_channel='offline' ORDER BY seat_number`,
      [request.params.id],
    );
    return {
      seats: seats.rows.map((row) => ({
        seatNumber: Number(row.seat_number),
        state: row.offline_state,
      })),
      releaseStatement: OFFLINE_RELEASE_STATEMENT,
      factBoundary: '平台只能证明船长已在系统内登记状态并作出释放确认，不能技术性核验或阻止线下事实本身。',
    };
  });

  app.post('/captain/departures/:id/offline-seat-status', { preHandler: requireUser }, async (request, reply) => {
    if (!await captainApproved(pool, request.user.id)) return sendError(reply, 403, '船长资质尚未审核通过');
    const validated = validOfflineSeatState(request.body);
    if (validated.error) return sendError(reply, 400, validated.error);
    const { seatNumber, state } = validated.value;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const departure = await client.query(
        `SELECT id,status,departure_at,booking_deadline FROM departures
         WHERE id=$1 AND captain_user_id=$2 FOR UPDATE`,
        [request.params.id, request.user.id],
      );
      if (!departure.rowCount) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, '班次不存在');
      }
      const row = departure.rows[0];
      if (row.status !== 'open' || new Date(row.departure_at) <= new Date()
          || new Date(row.booking_deadline) <= new Date()) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '只有报名中的未出航班次可以登记线下席位');
      }
      const quota = await client.query(
        `SELECT sale_channel,offline_state FROM departure_seat_quotas
         WHERE departure_id=$1 AND seat_number=$2 FOR UPDATE`,
        [row.id, seatNumber],
      );
      if (!quota.rowCount) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, '席位不在当前船只模板内');
      }
      if (quota.rows[0].sale_channel !== 'offline') {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '只有当前线下配额席位可以登记线下状态');
      }
      const previousState = quota.rows[0].offline_state;
      if (previousState === 'sold') {
        await client.query('ROLLBACK');
        return sendQuotaError(reply, 409, 'offline_seat_sold_terminal', '已登记线下售出的席位不能再改为其他状态');
      }
      const allowed = (previousState === 'open' && ['locked', 'sold'].includes(state))
        || (previousState === 'locked' && ['open', 'sold'].includes(state))
        || previousState === state;
      if (!allowed) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '线下席位状态变化不允许');
      }
      if (previousState !== state) {
        await client.query(
          `UPDATE departure_seat_quotas SET offline_state=$3,updated_at=now()
           WHERE departure_id=$1 AND seat_number=$2`,
          [row.id, seatNumber, state],
        );
        await client.query(
          `INSERT INTO departure_offline_seat_state_events
             (departure_id,seat_number,actor_user_id,previous_state,next_state,event_kind)
           VALUES ($1,$2,$3,$4,$5,'captain_status')`,
          [row.id, seatNumber, request.user.id, previousState, state],
        );
      }
      await client.query('COMMIT');
      return { departureId: row.id, seatNumber, state, changed: previousState !== state };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      request.log.error({ err: error }, 'Offline seat status update failed');
      return sendError(reply, 500, '线下席位登记失败，请稍后重试');
    } finally {
      client.release();
    }
  });

  app.post('/captain/departures/:id/quota-transfers', { preHandler: requireUser }, async (request, reply) => {
    if (!await captainApproved(pool, request.user.id)) return sendError(reply, 403, '船长资质尚未审核通过');
    const validated = validTransferRequest(request.body);
    if (validated.error) return sendError(reply, 400, validated.error);
    const { seatNumber, sourceChannel, targetChannel, requestKey, releaseConfirmed } = validated.value;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const departureResult = await client.query(
        `SELECT id,boat_id,status,departure_at,booking_deadline,seat_template_count,
                platform_quota_seats,offline_quota_seats,price_per_seat_fen,stern_surcharge_fen,
                seat_layout_snapshot
         FROM departures
         WHERE id=$1 AND captain_user_id=$2 FOR UPDATE`,
        [request.params.id, request.user.id],
      );
      const departure = departureResult.rows[0];
      if (!departure) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, '班次不存在');
      }
      const previous = await client.query(
        `SELECT seat_number,source_channel,target_channel,platform_quota_after,offline_quota_after,
                offline_release_confirmed
         FROM departure_quota_transfers WHERE departure_id=$1 AND request_key=$2`,
        [departure.id, requestKey],
      );
      if (previous.rowCount) {
        const item = previous.rows[0];
        if (Number(item.seat_number) !== seatNumber || item.source_channel !== sourceChannel
            || item.target_channel !== targetChannel
            || Boolean(item.offline_release_confirmed) !== releaseConfirmed) {
          await client.query('ROLLBACK');
          return sendError(reply, 409, '转移请求编号已用于其他操作');
        }
        await client.query('COMMIT');
        const platformQuotaSeats = Number(item.platform_quota_after);
        return {
          departureId: departure.id,
          seatNumber,
          sourceChannel,
          targetChannel,
          platformQuotaSeats,
          offlineQuotaSeats: Number(item.offline_quota_after),
          manualSupply: platformQuotaSeats === 0,
          instantConfirmationAvailable: platformQuotaSeats > 0,
          releaseConfirmed: Boolean(item.offline_release_confirmed),
          replayed: true,
        };
      }

      if (departure.status !== 'open' || new Date(departure.departure_at) <= new Date()
          || new Date(departure.booking_deadline) <= new Date()) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '只有未出航且仍在报名的班次可以调额');
      }
      if (seatNumber > Number(departure.seat_template_count)) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, '席位不在当前船只模板内');
      }

      const slotResult = await client.query(
        `SELECT sale_channel,offline_state FROM departure_seat_quotas
         WHERE departure_id=$1 AND seat_number=$2 FOR UPDATE`,
        [departure.id, seatNumber],
      );
      if (!slotResult.rowCount) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '该席位尚未分配给平台或线下配额');
      }
      if (slotResult.rows[0].sale_channel !== sourceChannel) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '席位当前不属于请求的来源配额');
      }
      const previousOfflineState = slotResult.rows[0].offline_state;
      if (sourceChannel === 'offline') {
        if (previousOfflineState === 'sold') {
          await client.query('ROLLBACK');
          return sendQuotaError(reply, 409, 'offline_seat_sold', '线下已售席位不能调入平台');
        }
        if (previousOfflineState === 'locked') {
          await client.query('ROLLBACK');
          return sendQuotaError(reply, 409, 'offline_seat_locked', '线下已锁定席位不能调入平台');
        }
        if (previousOfflineState !== 'open') {
          await client.query('ROLLBACK');
          return sendQuotaError(reply, 409, 'offline_seat_state_missing', '线下席位来源状态未登记，不能调入平台');
        }
        if (!releaseConfirmed) {
          await client.query('ROLLBACK');
          return sendQuotaError(reply, 409, 'offline_release_confirmation_required', '调入平台前需要船长确认已停止线下销售');
        }
      }

      const inventoryResult = await client.query(
        `SELECT id,status,hold_id,sale_channel FROM seat_inventory
         WHERE departure_id=$1 AND seat_number=$2 FOR UPDATE`,
        [departure.id, seatNumber],
      );
      const inventory = inventoryResult.rows[0];
      if (sourceChannel === 'platform') {
        if (!inventory || inventory.sale_channel !== 'platform' || inventory.status !== 'available' || inventory.hold_id) {
          await client.query('ROLLBACK');
          return sendError(reply, 409, '已售或已锁定席位不能转出平台配额');
        }
        const references = await client.query(
          `SELECT EXISTS (SELECT 1 FROM booking_orders WHERE seat_inventory_id=$1
                           AND status IN ('pending_payment','paid','completed'))
                  OR EXISTS (SELECT 1 FROM seat_hold_items WHERE seat_inventory_id=$1 AND status='active') AS used`,
          [inventory.id],
        );
        if (references.rows[0].used) {
          await client.query('ROLLBACK');
          return sendError(reply, 409, '已有订单或有效锁位记录的席位不能调出');
        }
        await client.query(
          `UPDATE seat_inventory SET sale_channel='offline',status='blocked',updated_at=now()
           WHERE id=$1`,
          [inventory.id],
        );
      } else if (inventory) {
        if (inventory.sale_channel !== 'offline' || inventory.status !== 'blocked' || inventory.hold_id) {
          await client.query('ROLLBACK');
          return sendError(reply, 409, '线下席位存在有效库存状态，无法转入平台');
        }
        const references = await client.query(
          `SELECT EXISTS (SELECT 1 FROM booking_orders WHERE seat_inventory_id=$1
                           AND status IN ('pending_payment','paid','completed'))
                  OR EXISTS (SELECT 1 FROM seat_hold_items WHERE seat_inventory_id=$1 AND status='active') AS used`,
          [inventory.id],
        );
        if (references.rows[0].used) {
          await client.query('ROLLBACK');
          return sendError(reply, 409, '已有订单或有效锁位记录的席位不能调入');
        }
        await client.query(
          `UPDATE seat_inventory SET sale_channel='platform',status='available',hold_id=NULL,
             hold_expires_at=NULL,updated_at=now() WHERE id=$1`,
          [inventory.id],
        );
      } else {
        const opened = await client.query(
          `INSERT INTO seat_inventory (departure_id,seat_number,price_fen,seat_side,seat_section,is_premium)
           SELECT $1,seat.number,$3 + CASE WHEN seat.premium THEN $4 ELSE 0 END,
                  seat.side,seat.section,seat.premium
           FROM jsonb_to_recordset(COALESCE($2::jsonb, '[]'::jsonb))
             AS seat(number smallint,side varchar,section varchar,premium boolean)
           WHERE seat.number=$5 RETURNING id`,
          [departure.id, JSON.stringify(departure.seat_layout_snapshot ?? []),
            Number(departure.price_per_seat_fen), Number(departure.stern_surcharge_fen ?? 0), seatNumber],
        );
        if (!opened.rowCount) {
          await client.query('ROLLBACK');
          return sendError(reply, 409, '班次缺少该席位的发布快照，无法开放平台库存');
        }
      }

      const platformDelta = sourceChannel === 'platform' ? -1 : 1;
      const offlineDelta = -platformDelta;
      const platformQuotaSeats = Number(departure.platform_quota_seats) + platformDelta;
      const offlineQuotaSeats = Number(departure.offline_quota_seats) + offlineDelta;
      if (platformQuotaSeats < 0 || offlineQuotaSeats < 0) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '当前配额数量与席位分配记录不一致');
      }
      await client.query(
        `UPDATE departure_seat_quotas SET sale_channel=$3,offline_state=$4,updated_at=now()
         WHERE departure_id=$1 AND seat_number=$2`,
        [departure.id, seatNumber, targetChannel,
          sourceChannel === 'offline' ? 'released' : 'open'],
      );
      await client.query(
        `UPDATE departures SET platform_quota_seats=$2,offline_quota_seats=$3,
             manual_supply=$4,updated_at=now() WHERE id=$1`,
        [departure.id, platformQuotaSeats, offlineQuotaSeats, platformQuotaSeats === 0],
      );
      await client.query(
        `INSERT INTO departure_quota_transfers
           (departure_id,actor_user_id,seat_number,source_channel,target_channel,request_key,
            platform_quota_after,offline_quota_after,offline_release_confirmed)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [departure.id, request.user.id, seatNumber, sourceChannel, targetChannel, requestKey,
          platformQuotaSeats, offlineQuotaSeats, releaseConfirmed],
      );
      if (sourceChannel === 'offline') {
        await client.query(
          `INSERT INTO departure_offline_release_confirmations
             (departure_id,seat_number,request_key,actor_user_id,statement_version,statement_text)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [departure.id, seatNumber, requestKey, request.user.id,
            OFFLINE_RELEASE_STATEMENT_VERSION, OFFLINE_RELEASE_STATEMENT],
        );
        await client.query(
          `INSERT INTO departure_offline_seat_state_events
             (departure_id,seat_number,actor_user_id,previous_state,next_state,event_kind,transfer_request_key)
           VALUES ($1,$2,$3,$4,'released','quota_transfer',$5)`,
          [departure.id, seatNumber, request.user.id, previousOfflineState, requestKey],
        );
      } else {
        await client.query(
          `INSERT INTO departure_offline_seat_state_events
             (departure_id,seat_number,actor_user_id,previous_state,next_state,event_kind,transfer_request_key)
           VALUES ($1,$2,$3,$4,'open','quota_return',$5)`,
          [departure.id, seatNumber, request.user.id, previousOfflineState, requestKey],
        );
      }
      await client.query('COMMIT');
      return {
        departureId: departure.id,
        seatNumber,
        sourceChannel,
        targetChannel,
        platformQuotaSeats,
        offlineQuotaSeats,
        manualSupply: platformQuotaSeats === 0,
        instantConfirmationAvailable: platformQuotaSeats > 0,
        releaseConfirmed,
        replayed: false,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      request.log.error({ err: error }, 'Departure quota transfer failed');
      return sendError(reply, 500, '配额调整失败，请稍后重试');
    } finally {
      client.release();
    }
  });

  app.post('/captain/departures/:id/withdraw', { preHandler: requireUser }, async (request, reply) => {
    if (!await captainApproved(pool, request.user.id)) return sendError(reply, 403, '船长资质尚未审核通过');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query(
        `SELECT d.id, d.status FROM departures d
         WHERE d.id=$1 AND d.captain_user_id=$2 FOR UPDATE`,
        [request.params.id, request.user.id],
      );
      if (!found.rowCount) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, '班次不存在');
      }
      if (found.rows[0].status !== 'open') {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '只有报名中的班次可以下架');
      }
      const booked = await client.query(
        `SELECT 1 FROM booking_orders WHERE departure_id=$1
         AND status IN ('pending_payment','paid','completed') LIMIT 1`,
        [request.params.id],
      );
      if (booked.rowCount) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '班次已有订单，请使用后续订单处置流程');
      }
      await client.query(
        `UPDATE departures SET status='cancelled', updated_at=now()
         WHERE id=$1`,
        [request.params.id],
      );
      await client.query('COMMIT');
      return { id: request.params.id, status: 'withdrawn' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      request.log.error({ err: error }, 'Step 2 departure withdrawal failed');
      return sendError(reply, 500, '下架失败，请稍后重试');
    } finally {
      client.release();
    }
  });

  app.post('/captain/departures/:id/republish', { preHandler: requireUser }, async (request, reply) => {
    if (!await captainApproved(pool, request.user.id)) return sendError(reply, 403, '船长资质尚未审核通过');
    const date = String(request.body?.departureDate ?? '');
    if (!isCalendarDate(date) || date < todayInShanghai()) return sendError(reply, 400, '请选择今天或之后的出航日期');
    const client = await pool.connect();
    let departureId;
    try {
      await client.query('BEGIN');
      const sourceResult = await client.query(
        `SELECT d.*, b.name AS boat_name, b.captain_user_id AS boat_captain_id,
                b.review_status AS boat_review_status, b.template_status, b.seat_count,
                b.seat_template_code, st.layout
         FROM departures d JOIN boats b ON b.id=d.boat_id
         LEFT JOIN seat_templates st ON st.code=b.seat_template_code
         WHERE d.id=$1 AND d.captain_user_id=$2 FOR UPDATE OF d`,
        [request.params.id, request.user.id],
      );
      const source = sourceResult.rows[0];
      if (!source) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, '历史班次不存在');
      }
      if (source.boat_review_status !== 'approved' || source.template_status !== 'ready'
          || !validateSeatLayout(source.layout, source.seat_count)) {
        await client.query('ROLLBACK');
        return sendError(reply, 403, '船档案或钓位模板当前不可发班');
      }
      const oldDepartureAt = new Date(source.departure_at);
      const newDepartureAt = localDateTime(date, localTime(oldDepartureAt));
      if (!newDepartureAt || newDepartureAt <= new Date()) {
        await client.query('ROLLBACK');
        return sendError(reply, 400, '新班次出航时间必须晚于当前时间');
      }
      const shift = newDepartureAt.getTime() - oldDepartureAt.getTime();
      const fishResult = await client.query(
        'SELECT fish_code FROM departure_fish_targets WHERE departure_id=$1 ORDER BY sort_order',
        [source.id],
      );
      const rigResult = await client.query(
        `SELECT bait_types, bait_grams_per_person, bait_supply, main_line_pe,
                leader_line_number, sinker_shape, sinker_min_grams, sinker_max_grams
         FROM departure_rig_configs WHERE departure_id=$1`,
        [source.id],
      );
      if (!rigResult.rowCount || !fishResult.rowCount) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '历史班次缺少完整鱼种或钓组配置，无法复发');
      }
      const value = {
        tripType: source.trip_type,
        departureAt: newDepartureAt,
        meetingAt: source.meeting_at ? new Date(new Date(source.meeting_at).getTime() + shift) : newDepartureAt,
        returnAt: new Date(new Date(source.return_at).getTime() + shift),
        bookingDeadline: new Date(new Date(source.booking_deadline).getTime() + shift),
        targetAreaCode: source.target_area_code,
        marinaCode: source.marina_code,
        minimumTotalFen: Number(source.minimum_sailing_total_fen),
        pricePerSeatFen: Number(source.price_per_seat_fen),
        sternSurchargeFen: Number(source.stern_surcharge_fen ?? 0),
        platformQuotaSeats: Number(source.platform_quota_seats),
        offlineQuotaSeats: Number(source.offline_quota_seats),
        manualSupply: Boolean(source.manual_supply),
        remarks: source.remarks ?? '',
        fishCodes: fishResult.rows.map((row) => row.fish_code),
        rigConfig: {
          baitTypes: rigResult.rows[0].bait_types,
          baitGramsPerPerson: Number(rigResult.rows[0].bait_grams_per_person),
          baitSupply: rigResult.rows[0].bait_supply,
          mainLinePe: Number(rigResult.rows[0].main_line_pe),
          leaderLineNumber: Number(rigResult.rows[0].leader_line_number),
          sinkerShape: rigResult.rows[0].sinker_shape,
          sinkerMinGrams: Number(rigResult.rows[0].sinker_min_grams),
          sinkerMaxGrams: Number(rigResult.rows[0].sinker_max_grams),
        },
      };
      if (value.returnAt <= value.departureAt || value.meetingAt > value.departureAt
          || value.bookingDeadline > value.departureAt || value.bookingDeadline <= new Date()) {
        await client.query('ROLLBACK');
        return sendError(reply, 400, '新日期无法沿用历史时间，请先创建新班次');
      }
      departureId = await insertDeparture(client, {
        id: source.boat_id,
        layout: source.layout,
      }, request.user.id, value);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      request.log.error({ err: error }, 'Step 2 departure republish failed');
      return sendError(reply, 500, '复发失败，请稍后重试');
    } finally {
      client.release();
    }
    const row = await loadDeparture(pool, departureId);
    const seats = await loadSeats(pool, departureId);
    return reply.code(201).send({ departure: serializeDeparture(row, { seats, security }) });
  });

  app.get('/departures', { preHandler: requireUser }, async (request, reply) => {
    await updateEndedDepartures(pool);
    const filters = buildDepartureFilters(request.query ?? {});
    if (filters?.error) return sendError(reply, 400, filters.error);
    const openResult = await pool.query(
      `${DEPARTURE_SELECT} WHERE ${filters.conditions.join(' AND ')}
       ORDER BY d.departure_at ASC LIMIT 100`,
      filters.values,
    );
    const liveFilters = filters.conditions.filter((condition) =>
      condition !== "d.status='open'" && condition !== 'd.departure_at > now()'
    );
    const liveWhere = [
      "d.status='in_progress'",
      `EXISTS (SELECT 1 FROM step5_live_sessions live
               WHERE live.departure_id=d.id AND live.ended_at IS NULL
                 AND EXISTS (SELECT 1 FROM departure_checkins departed
                             WHERE departed.departure_id=d.id AND departed.event='departed'
                               AND departed.captain_user_id=d.captain_user_id)
                 AND NOT EXISTS (SELECT 1 FROM departure_checkins returned
                                 WHERE returned.departure_id=d.id AND returned.event='returned'
                                   AND returned.captain_user_id=d.captain_user_id))`,
      ...liveFilters,
    ].join(' AND ');
    const liveResult = await pool.query(
      `${DEPARTURE_SELECT} WHERE ${liveWhere}
       ORDER BY d.departure_at ASC LIMIT 100`,
      filters.values,
    );
    const rows = [...liveResult.rows, ...openResult.rows]
      .sort((left, right) => new Date(left.departure_at) - new Date(right.departure_at))
      .slice(0, 100);
    return { items: rows.map((row) => serializeDeparture(row, { security })) };
  });

  app.get('/departures/:id', { preHandler: requireUser }, async (request, reply) => {
    await updateEndedDepartures(pool);
    const row = await loadDeparture(pool, request.params.id);
    const isPublished = row?.status === 'open' && new Date(row.departure_at) > new Date();
    const isLive = row?.status === 'in_progress' && row.live_session;
    if (!row || (!isPublished && !isLive)) {
      return sendError(reply, 404, '活动不存在或已结束');
    }
    const [seats, rig] = await Promise.all([
      loadSeats(pool, row.id),
      pool.query(
        `SELECT bait_types, bait_grams_per_person, bait_supply, main_line_pe,
                leader_line_number, sinker_shape, sinker_min_grams, sinker_max_grams
         FROM departure_rig_configs WHERE departure_id=$1`,
        [row.id],
      ),
    ]);
    if (!rig.rowCount) return sendError(reply, 500, '活动钓组信息暂不可用');
    const configRow = rig.rows[0];
    row.rig_config = {
      baitTypes: configRow.bait_types.map((code) => ({ code, name: BAIT_TYPES[code] ?? code })),
      baitGramsPerPerson: Number(configRow.bait_grams_per_person),
      baitSupply: configRow.bait_supply,
      baitSupplyName: BAIT_SUPPLIES[configRow.bait_supply],
      mainLinePe: Number(configRow.main_line_pe),
      leaderLineNumber: Number(configRow.leader_line_number),
      sinkerShape: configRow.sinker_shape,
      sinkerShapeName: SINKER_SHAPES[configRow.sinker_shape],
      sinkerMinGrams: Number(configRow.sinker_min_grams),
      sinkerMaxGrams: Number(configRow.sinker_max_grams),
    };
    return { departure: serializeDeparture(row, { seats, security }) };
  });

  app.get('/boats/:boatId/photos/:kind', { preHandler: requireUser }, async (request, reply) => {
    const { boatId, kind } = request.params;
    if (!PHOTO_KINDS.has(kind)) return sendError(reply, 404, '照片不存在');
    const result = await pool.query(
      `SELECT u.object_key, u.content_type
       FROM boats b
       JOIN boat_photos bp ON bp.boat_id=b.id AND bp.photo_kind=$2
       JOIN uploaded_objects u ON u.object_key=split_part(bp.object_uri, '://', 2)
       WHERE b.id=$1 AND b.review_status='approved'
         AND bp.object_uri LIKE 'local-object://%'
         AND u.object_kind=bp.photo_kind
       LIMIT 1`,
      [boatId, kind],
    );
    const photo = result.rows[0];
    if (!photo) return sendError(reply, 404, '照片不存在');
    const bytes = await storage.get(photo.object_key);
    if (!bytes) return sendError(reply, 404, '照片不存在');
    return reply.type(photo.content_type).header('cache-control', 'private, max-age=120').send(bytes);
  });
}

