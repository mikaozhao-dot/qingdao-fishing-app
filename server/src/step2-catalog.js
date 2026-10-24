export const TARGET_AREAS = Object.freeze({
  qingdao_nearshore: '青岛近海',
  jiaozhou_bay: '胶州湾',
  lingshan_island: '灵山岛',
  zhucha_island: '竹岔岛',
  tianheng_island: '田横岛',
  yellow_sea_offshore: '黄海近海',
});

export const FISH_CATALOG = Object.freeze([
  { code: 'yellow_croaker', name: '小黄鱼', months: [4, 5, 6, 9, 10, 11], rigPreset: { baitTypes: ['antarctic_shrimp', 'lugworm'], baitGramsPerPerson: 300, baitSupply: 'captain_provided', mainLinePe: 1.0, leaderLineNumber: 3, sinkerShape: 'long_bar', sinkerMinGrams: 80, sinkerMaxGrams: 120 } },
  { code: 'sea_bass', name: '鲈鱼', months: [5, 6, 7, 8, 9, 10, 11], rigPreset: { baitTypes: ['live_shrimp', 'lure_jig'], baitGramsPerPerson: 200, baitSupply: 'captain_provided', mainLinePe: 1.5, leaderLineNumber: 5, sinkerShape: 'water_drop', sinkerMinGrams: 40, sinkerMaxGrams: 80 } },
  { code: 'blackhead', name: '黑头（许氏平鲉）', months: [1, 2, 3, 4, 10, 11, 12], rigPreset: { baitTypes: ['lugworm', 'red_worm'], baitGramsPerPerson: 300, baitSupply: 'captain_provided', mainLinePe: 1.5, leaderLineNumber: 5, sinkerShape: 'olive', sinkerMinGrams: 80, sinkerMaxGrams: 150 } },
  { code: 'black_seabream', name: '黑鲷', months: [4, 5, 6, 7, 8, 9, 10, 11], rigPreset: { baitTypes: ['lugworm', 'red_worm'], baitGramsPerPerson: 250, baitSupply: 'captain_provided', mainLinePe: 1.2, leaderLineNumber: 4, sinkerShape: 'through', sinkerMinGrams: 40, sinkerMaxGrams: 100 } },
  { code: 'red_seabream', name: '真鲷', months: [5, 6, 7, 8, 9, 10], rigPreset: { baitTypes: ['live_shrimp', 'squid_strip'], baitGramsPerPerson: 250, baitSupply: 'captain_provided', mainLinePe: 2.0, leaderLineNumber: 6, sinkerShape: 'olive', sinkerMinGrams: 100, sinkerMaxGrams: 150 } },
  { code: 'olive_flounder', name: '牙鲆', months: [5, 6, 7, 8, 9, 10], rigPreset: { baitTypes: ['live_baitfish', 'live_shrimp'], baitGramsPerPerson: 300, baitSupply: 'captain_provided', mainLinePe: 1.5, leaderLineNumber: 5, sinkerShape: 'long_bar', sinkerMinGrams: 100, sinkerMaxGrams: 180 } },
  { code: 'hairtail', name: '带鱼', months: [9, 10, 11, 12], rigPreset: { baitTypes: ['squid_strip', 'live_baitfish'], baitGramsPerPerson: 250, baitSupply: 'captain_provided', mainLinePe: 1.5, leaderLineNumber: 5, sinkerShape: 'long_bar', sinkerMinGrams: 80, sinkerMaxGrams: 150 } },
  { code: 'spanish_mackerel', name: '鲅鱼', months: [4, 5, 6, 9, 10], rigPreset: { baitTypes: ['lure_jig', 'live_baitfish'], baitGramsPerPerson: 200, baitSupply: 'captain_provided', mainLinePe: 2.0, leaderLineNumber: 6, sinkerShape: 'olive', sinkerMinGrams: 60, sinkerMaxGrams: 120 } },
  { code: 'chub_mackerel', name: '鲐鱼', months: [7, 8, 9, 10], rigPreset: { baitTypes: ['commercial_bait', 'lure_jig'], baitGramsPerPerson: 200, baitSupply: 'captain_provided', mainLinePe: 1.0, leaderLineNumber: 3, sinkerShape: 'water_drop', sinkerMinGrams: 40, sinkerMaxGrams: 80 } },
  { code: 'cuttlefish', name: '墨鱼（金乌贼）', months: [10, 11, 12, 1], rigPreset: { baitTypes: ['lure_jig'], baitGramsPerPerson: 0, baitSupply: 'guest_bring', mainLinePe: 1.0, leaderLineNumber: 3, sinkerShape: 'swivel', sinkerMinGrams: 20, sinkerMaxGrams: 40 } },
  { code: 'octopus', name: '八带（章鱼）', months: [3, 4, 5, 9, 10, 11], rigPreset: { baitTypes: ['live_shrimp', 'commercial_bait'], baitGramsPerPerson: 200, baitSupply: 'captain_provided', mainLinePe: 2.0, leaderLineNumber: 6, sinkerShape: 'through', sinkerMinGrams: 60, sinkerMaxGrams: 100 } },
  { code: 'greenling', name: '六线鱼', months: [10, 11, 12, 1, 2, 3], rigPreset: { baitTypes: ['lugworm', 'red_worm'], baitGramsPerPerson: 250, baitSupply: 'captain_provided', mainLinePe: 1.5, leaderLineNumber: 5, sinkerShape: 'long_bar', sinkerMinGrams: 80, sinkerMaxGrams: 150 } },
  { code: 'mullet', name: '梭鱼', months: [4, 5, 6, 7], rigPreset: { baitTypes: ['commercial_bait', 'red_worm'], baitGramsPerPerson: 200, baitSupply: 'captain_provided', mainLinePe: 1.0, leaderLineNumber: 3, sinkerShape: 'water_drop', sinkerMinGrams: 30, sinkerMaxGrams: 60 } },
  { code: 'needlefish', name: '针良鱼（鄂针鱼）', months: [6, 7, 8, 9, 10], rigPreset: { baitTypes: ['lure_jig', 'live_shrimp'], baitGramsPerPerson: 150, baitSupply: 'captain_provided', mainLinePe: 1.0, leaderLineNumber: 3, sinkerShape: 'water_drop', sinkerMinGrams: 20, sinkerMaxGrams: 60 } },
  { code: 'conger_eel', name: '鳗鱼（海鳗）', months: [9, 10, 11, 12, 1, 2], rigPreset: { baitTypes: ['squid_strip', 'live_baitfish'], baitGramsPerPerson: 250, baitSupply: 'captain_provided', mainLinePe: 2.5, leaderLineNumber: 8, sinkerShape: 'long_bar', sinkerMinGrams: 100, sinkerMaxGrams: 180 } },
  { code: 'rockfish', name: '石九公（褐菖鲉）', months: [1, 2, 3, 4, 9, 10, 11, 12], rigPreset: { baitTypes: ['red_worm', 'lugworm'], baitGramsPerPerson: 200, baitSupply: 'captain_provided', mainLinePe: 1.0, leaderLineNumber: 3, sinkerShape: 'water_drop', sinkerMinGrams: 40, sinkerMaxGrams: 80 } },
  { code: 'yellowtail_amberjack', name: '黄条鰤', months: [7, 8, 9, 10], rigPreset: { baitTypes: ['lure_jig', 'live_baitfish'], baitGramsPerPerson: 200, baitSupply: 'captain_provided', mainLinePe: 3.0, leaderLineNumber: 8, sinkerShape: 'long_bar', sinkerMinGrams: 120, sinkerMaxGrams: 200 } },
]);

export const BAIT_TYPES = Object.freeze({
  antarctic_shrimp: '南极虾',
  live_shrimp: '活虾',
  lugworm: '沙蚕',
  red_worm: '红虫',
  squid_strip: '鱿鱼条',
  live_baitfish: '活小鱼',
  commercial_bait: '商品饵',
  lure_jig: '拟饵/铁板',
});

export const BAIT_SUPPLIES = Object.freeze({
  captain_provided: '船长提供',
  guest_bring: '钓友自备',
  onboard_purchase: '船上可购',
});

export const MAIN_LINE_PE = Object.freeze([0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0, 4.0]);
export const LEADER_LINE_NUMBERS = Object.freeze([2, 3, 4, 5, 6, 8, 10]);
export const SINKER_SHAPES = Object.freeze({
  water_drop: '水滴坠', olive: '橄榄坠', through: '通心坠', long_bar: '长条坠', swivel: '转环坠',
});

