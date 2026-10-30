const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MOBILE_PATTERN = /(?<!\d)(?:\+?86[\s-]?)?1[3-9](?:[\s-]?\d){9}(?!\d)/;
const WECHAT_PATTERN = /(?:微信|微\s*信|wechat|weixin|vx|v\s*x|wx)\s*(?:号|id|[:：]|\s)*[a-z][a-z0-9_-]{3,}/i;
const WECHAT_ID_PATTERN = /\bwxid_[a-z0-9_-]{4,}\b/i;

function validDate(value) {
  const match = DATE_PATTERN.exec(String(value ?? ''));
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function validateMemberActivityRequestFilters(query, { marinaCodes, fishCodes }) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    return { error: '筛选条件无效' };
  }
  const allowedKeys = new Set(['marinaCode', 'departureDate', 'partySize', 'fishCode', 'bookingType']);
  if (Object.keys(query).some((key) => !allowedKeys.has(key))) return { error: '包含不支持的筛选条件' };

  const optionalString = (key) => {
    const value = query[key];
    if (value === undefined || value === null || value === '') return { value: null };
    if (typeof value !== 'string') return { error: `${key}筛选值无效` };
    const normalized = value.trim();
    return normalized ? { value: normalized } : { value: null };
  };

  const marina = optionalString('marinaCode');
  if (marina.error) return marina;
  if (marina.value && !marinaCodes.has(marina.value)) return { error: '请选择平台内的出发码头' };

  const date = optionalString('departureDate');
  if (date.error) return date;
  if (date.value && !validDate(date.value)) return { error: '出航日期筛选值无效' };

  const fish = optionalString('fishCode');
  if (fish.error) return fish;
  if (fish.value && !fishCodes.has(fish.value)) return { error: '目标鱼种筛选值无效' };

  const bookingType = optionalString('bookingType');
  if (bookingType.error) return bookingType;
  if (bookingType.value && !['charter', 'shared'].includes(bookingType.value)) {
    return { error: '包船/拼船筛选值无效' };
  }

  let partySize = null;
  if (query.partySize !== undefined && query.partySize !== null && query.partySize !== '') {
    if (!['number', 'string'].includes(typeof query.partySize)) return { error: '人数筛选值无效' };
    partySize = Number(query.partySize);
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > 30) {
      return { error: '人数筛选值需为 1–30 人' };
    }
  }

  return {
    value: {
      marinaCode: marina.value,
      departureDate: date.value,
      partySize,
      fishCode: fish.value,
      bookingType: bookingType.value,
    },
  };
}

function addCalendarDay(value) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function localInstant(date, time) {
  return new Date(`${date}T${time}:00+08:00`);
}

function shanghaiDate(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function validOptionalFen(value, label) {
  if (value === null || value === undefined || value === '') return { value: null };
  if (!['number', 'string'].includes(typeof value)) return { error: `${label}需为整数金额` };
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 2_000_000_000) {
    return { error: `${label}需为 0–2000000000 分的整数` };
  }
  return { value: amount };
}

function validTags(value, { label, maxCount, maxLength, required = false }) {
  if (value === undefined && !required) return { value: [] };
  if (!Array.isArray(value) || (required && value.length < 1) || value.length > maxCount) {
    return { error: `${label}数量无效` };
  }
  const tags = value.map((item) => typeof item === 'string' ? item.trim() : '');
  if (tags.some((tag) => !tag || tag.length > maxLength)) return { error: `${label}内容无效` };
  if (new Set(tags).size !== tags.length) return { error: `${label}不能重复` };
  if (tags.some(containsExternalContact)) return { error: `${label}不能包含手机号或微信联系方式` };
  return { value: tags };
}

export function containsExternalContact(value) {
  const text = String(value ?? '');
  return MOBILE_PATTERN.test(text) || WECHAT_PATTERN.test(text) || WECHAT_ID_PATTERN.test(text);
}

export function validateMemberActivityRequest(body, {
  marinaCodes,
  targetAreaCodes,
  fishCodes,
  now = new Date(),
}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: '需求单内容无效' };
  const departureDate = String(body.departureDate ?? '');
  const startTime = String(body.startTime ?? '');
  const endTime = String(body.endTime ?? '');
  const marinaCode = String(body.marinaCode ?? '');
  const targetAreaCode = String(body.targetAreaCode ?? '');
  const bookingType = String(body.bookingType ?? '');
  const partySize = Number(body.partySize);
  if (!validDate(departureDate) || !TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)) {
    return { error: '请选择有效的出航日期和时间范围' };
  }
  if (departureDate < shanghaiDate(now)) {
    return { error: '出航日期不能早于今天' };
  }
  if (!marinaCodes.has(marinaCode)) return { error: '请选择平台内的出发码头' };
  if (!targetAreaCodes.has(targetAreaCode)) return { error: '请选择平台内的目标海域' };
  if (!['charter', 'shared'].includes(bookingType)) return { error: '请选择包船或拼船方式' };
  if (!['number', 'string'].includes(typeof body.partySize)
      || !Number.isInteger(partySize) || partySize < 1 || partySize > 30) {
    return { error: '人数需为 1–30 人' };
  }

  const normalizedFish = validTags(body.fishCodes, { label: '目标鱼种', maxCount: 3, maxLength: 60, required: true });
  if (normalizedFish.error) return normalizedFish;
  if (normalizedFish.value.some((code) => !fishCodes.has(code))) return { error: '目标鱼种必须来自平台鱼种库' };
  const fishingMethods = validTags(body.fishingMethods, { label: '钓法', maxCount: 6, maxLength: 40 });
  if (fishingMethods.error) return fishingMethods;

  const minBudget = validOptionalFen(body.minBudgetFen, '最低预算');
  if (minBudget.error) return minBudget;
  const maxBudget = validOptionalFen(body.maxBudgetFen, '最高预算');
  if (maxBudget.error) return maxBudget;
  if (minBudget.value !== null && maxBudget.value !== null && maxBudget.value < minBudget.value) {
    return { error: '预算区间无效' };
  }

  const gearRequirements = String(body.gearRequirements ?? '').trim();
  const notes = String(body.notes ?? '').trim();
  if (gearRequirements.length > 500 || notes.length > 500) return { error: '装备要求或备注最多 500 个字符' };
  if (containsExternalContact(gearRequirements) || containsExternalContact(notes)) {
    return { error: '需求单不能包含手机号或微信联系方式，请使用站内消息沟通' };
  }
  if (typeof body.beginnerFriendly !== 'boolean' || typeof body.childrenAllowed !== 'boolean') {
    return { error: '新手和儿童同行要求需明确选择' };
  }

  const endDate = endTime <= startTime ? addCalendarDay(departureDate) : departureDate;
  const requestedStartAt = localInstant(departureDate, startTime);
  const requestedEndAt = localInstant(endDate, endTime);
  if (requestedStartAt <= now || requestedEndAt <= requestedStartAt
      || requestedEndAt.getTime() - requestedStartAt.getTime() > 24 * 60 * 60 * 1000) {
    return { error: '出航时间范围无效或已过期' };
  }

  return {
    value: {
      departureDate,
      requestedStartAt,
      requestedEndAt,
      marinaCode,
      targetAreaCode,
      partySize,
      bookingType,
      fishCodes: normalizedFish.value,
      fishingMethods: fishingMethods.value,
      minBudgetFen: minBudget.value,
      maxBudgetFen: maxBudget.value,
      gearRequirements,
      beginnerFriendly: body.beginnerFriendly,
      childrenAllowed: body.childrenAllowed,
      notes,
    },
  };
}

export function serializeMemberActivityRequest(row) {
  return {
    id: row.id,
    departureDate: row.departure_date,
    startAt: row.requested_start_at,
    endAt: row.requested_end_at,
    marinaCode: row.marina_code,
    targetAreaCode: row.target_area_code,
    partySize: Number(row.party_size),
    bookingType: row.booking_type,
    fishCodes: row.fish_codes,
    fishingMethods: row.fishing_methods,
    minBudgetFen: row.min_budget_fen === null ? null : Number(row.min_budget_fen),
    maxBudgetFen: row.max_budget_fen === null ? null : Number(row.max_budget_fen),
    gearRequirements: row.gear_requirements,
    beginnerFriendly: row.beginner_friendly,
    childrenAllowed: row.children_allowed,
    notes: row.notes,
    status: row.status,
    expiresAt: row.expires_at,
    convertedDepartureId: row.converted_departure_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
