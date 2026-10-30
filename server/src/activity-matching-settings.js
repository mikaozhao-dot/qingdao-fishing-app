export function validateActivityMatchingSettings(body, marinaCodes, fishCodes) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: '匹配偏好内容无效' };
  }

  const validateCodes = (value, allowed, label) => {
    if (!Array.isArray(value)) return { error: `${label}需为数组` };
    if (value.some((code) => typeof code !== 'string' || !allowed.has(code))) {
      return { error: `${label}包含无效选项` };
    }
    if (new Set(value).size !== value.length) {
      return { error: `${label}不能重复` };
    }
    return { value: [...value] };
  };

  const marinas = validateCodes(body.serviceMarinaCodes, marinaCodes, '服务码头');
  if (marinas.error) return marinas;
  const fish = validateCodes(body.fishTargetCodes, fishCodes, '目标鱼种');
  if (fish.error) return fish;

  return {
    value: {
      serviceMarinaCodes: marinas.value,
      fishTargetCodes: fish.value,
    },
  };
}

export function serializeActivityMatchingSettings({
  serviceMarinaCodes,
  fishTargetCodes,
  marinas,
  fishCatalog,
}) {
  const marinaNames = marinas;
  const fishNames = new Map(fishCatalog.map(({ code, name }) => [code, name]));
  return {
    serviceMarinaCodes,
    serviceMarinas: serviceMarinaCodes.map((code) => ({
      code,
      name: marinaNames[code] ?? code,
    })),
    fishTargetCodes,
    fishTargets: fishTargetCodes.map((code) => ({
      code,
      name: fishNames.get(code) ?? code,
    })),
  };
}
