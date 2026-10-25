export async function readStep3Clock(client, clockNow = null) {
  if (typeof clockNow === 'function') return new Date(clockNow());
  return (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
}

export function configuredStep3Clock(config) {
  return config.nodeEnv === 'test' && typeof config.step3ClockNow === 'function'
    ? config.step3ClockNow
    : null;
}
