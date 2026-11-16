// Draaien als Home Assistant-add-on.
// De Supervisor geeft ons een token (SUPERVISOR_TOKEN) waarmee we zonder eigen
// token bij Home Assistant kunnen, en zet de instellingen in /data/options.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const isAddon = Boolean(process.env.SUPERVISOR_TOKEN);
export const addonInfo = { slug: null, hostname: os.hostname(), ingressUrl: null };

// Verzoeken via ingress (de zijbalk van Home Assistant) komen altijd van de Supervisor.
const INGRESS_PROXY_IP = process.env.INGRESS_PROXY_IP || '172.30.32.2';

export async function loadAddonOptions() {
  if (!isAddon) return;
  try {
    const o = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR || '/data', 'options.json'), 'utf8'));
    if (o.pin && !process.env.HUIS_PIN) process.env.HUIS_PIN = String(o.pin);
    if (o.vapid_subject && !process.env.VAPID_SUBJECT) {
      process.env.VAPID_SUBJECT = String(o.vapid_subject).startsWith('mailto:') ? o.vapid_subject : `mailto:${o.vapid_subject}`;
    }
  } catch {
    // Geen opties: prima, alles werkt dan via de zijbalk.
  }
  process.env.HA_URL ||= 'http://supervisor/core';
  process.env.HA_TOKEN ||= process.env.SUPERVISOR_TOKEN;
  try {
    const r = await fetch('http://supervisor/addons/self/info', {
      headers: { Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}` },
      signal: AbortSignal.timeout(5000),
    });
    const { data } = await r.json();
    addonInfo.slug = data.slug;
    addonInfo.hostname = data.hostname || addonInfo.hostname;
    addonInfo.ingressUrl = data.ingress_url;
  } catch (e) {
    console.warn('Kon add-on-informatie niet ophalen:', e.message);
  }
}

// Is dit verzoek via ingress binnengekomen? Dan heeft Home Assistant de gebruiker al ingelogd.
export function ingressUser(req) {
  if (!isAddon && !process.env.INGRESS_PROXY_IP) return null;
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (ip !== INGRESS_PROXY_IP || !req.get('x-ingress-path')) return null;
  return {
    id: req.get('x-remote-user-id') || null,
    name: req.get('x-remote-user-display-name') || req.get('x-remote-user-name') || null,
  };
}

// Waar een melding in de Home Assistant-app naartoe moet openen.
export function panelPath() {
  return addonInfo.slug ? `/hassio/ingress/${addonInfo.slug}` : null;
}
