// Home Assistant via de REST API. De server praat met HA, zodat het token
// nooit op de telefoon terechtkomt en je geen CORS hoeft in te stellen.

const url = () => (process.env.HA_URL || '').replace(/\/+$/, '');
const token = () => process.env.HA_TOKEN || '';

export const haConfigured = () => Boolean(url() && token());

// Domeinen die we tonen en de services die vanuit de app mogen.
export const DOMAINS = {
  light: ['turn_on', 'turn_off', 'toggle'],
  switch: ['turn_on', 'turn_off', 'toggle'],
  fan: ['turn_on', 'turn_off', 'toggle'],
  input_boolean: ['turn_on', 'turn_off', 'toggle'],
  cover: ['open_cover', 'close_cover', 'stop_cover'],
  lock: ['lock', 'unlock'],
  climate: ['set_temperature', 'set_hvac_mode'],
  scene: ['turn_on'],
  script: ['turn_on'],
  media_player: ['media_play_pause', 'volume_up', 'volume_down', 'turn_on', 'turn_off'],
  vacuum: ['start', 'return_to_base', 'pause'],
  sensor: [],
  binary_sensor: [],
  person: [],
  weather: [],
};

async function ha(path, options = {}) {
  const res = await fetch(url() + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Home Assistant gaf ${res.status}: ${text.slice(0, 200)}`);
    // 502: fout zit bij HA, niet bij de inlog van de app
    err.status = 502;
    throw err;
  }
  return res.json();
}

export async function getStates() {
  const states = await ha('/api/states');
  return states
    .filter((s) => s.entity_id.split('.')[0] in DOMAINS)
    .map((s) => ({
      entity_id: s.entity_id,
      domain: s.entity_id.split('.')[0],
      state: s.state,
      name: s.attributes.friendly_name || s.entity_id,
      unit: s.attributes.unit_of_measurement,
      device_class: s.attributes.device_class,
      icon: s.attributes.icon,
      // Alleen de attributen die de app gebruikt
      attrs: pick(s.attributes, [
        'brightness', 'current_temperature', 'temperature', 'hvac_modes', 'hvac_action',
        'min_temp', 'max_temp', 'target_temp_step', 'current_position', 'media_title',
        'media_artist', 'volume_level', 'entity_picture', 'temperature_unit',
      ]),
      last_changed: s.last_changed,
    }));
}

export async function callService(domain, service, entityId, data = {}) {
  const allowed = DOMAINS[domain];
  if (!allowed || !allowed.includes(service)) {
    const err = new Error(`Actie ${domain}.${service} is niet toegestaan`);
    err.status = 400;
    throw err;
  }
  if (!entityId?.startsWith(domain + '.')) {
    const err = new Error('Apparaat hoort niet bij dit domein');
    err.status = 400;
    throw err;
  }
  const safeData = pick(data, ['brightness_pct', 'temperature', 'hvac_mode']);
  return ha(`/api/services/${domain}/${service}`, {
    method: 'POST',
    body: JSON.stringify({ entity_id: entityId, ...safeData }),
  });
}

export async function ping() {
  if (!haConfigured()) return { configured: false, ok: false };
  try {
    const r = await ha('/api/');
    return { configured: true, ok: true, message: r.message };
  } catch (e) {
    return { configured: true, ok: false, message: e.message };
  }
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj?.[k] !== undefined) out[k] = obj[k];
  return out;
}

// ---------- Meldingen via de Home Assistant-app (Companion) ----------
const NOTIFY_RE = /^mobile_app_[a-z0-9_]+$/;

// Lijst van telefoons met de Home Assistant-app, zoals notify.mobile_app_iphone_van_samer
export async function listNotifyServices() {
  const services = await ha('/api/services');
  const notify = services.find((d) => d.domain === 'notify');
  return Object.keys(notify?.services || {}).filter((k) => NOTIFY_RE.test(k)).sort();
}

export async function sendAppNotification(service, { title, body, tag, url, urgent }) {
  if (!NOTIFY_RE.test(service || '')) throw Object.assign(new Error('Ongeldige meldingsdienst'), { status: 400 });
  const data = {};
  if (url) {
    data.url = url;          // iPhone
    data.clickAction = url;  // Android
  }
  if (tag) data.tag = tag;
  data.group = 'huis';
  if (urgent) {
    data.priority = 'high';
    data.push = { 'interruption-level': 'time-sensitive' };
  }
  return ha(`/api/services/notify/${service}`, {
    method: 'POST',
    body: JSON.stringify({ title, message: body, data }),
  });
}
