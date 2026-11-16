// Pushmeldingen (Web Push). Werkt op iPhone vanaf iOS 16.4 als de app
// op het beginscherm staat en via HTTPS wordt geopend.
import crypto from 'node:crypto';
import * as webpush from 'web-push';
import { db, save } from './store.js';
import { eventsBetween } from './calendars.js';
import { haConfigured, sendAppNotification } from './ha.js';
import { panelPath } from './addon.js';

// Heeft dit lid een manier om meldingen te krijgen?
export const hasChannel = (m) => Boolean(m?.push?.length || (m?.haNotify && haConfigured()));

export const DEFAULT_PREFS = {
  taskAssigned: true,   // iemand geeft jou een taak
  eventAdded: true,     // nieuwe gezinsafspraak waar jij bij hoort
  eventReminder: true,  // 30 minuten voor een gezinsafspraak
  dailySummary: true,   // ochtendoverzicht
  summaryTime: '08:00',
  shopping: false,      // iets op het boodschappenlijstje gezet
  ha: true,             // meldingen vanuit Home Assistant
};

export function initPush() {
  const d = db();
  if (!d.vapid) d.vapid = webpush.generateVAPIDKeys();
  if (!d.notifyToken) d.notifyToken = crypto.randomBytes(24).toString('base64url');
  d.sentReminders ||= {};
  save();
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:huis-app@example.com',
    d.vapid.publicKey,
    d.vapid.privateKey
  );
}

export const publicKey = () => db().vapid.publicKey;
export const prefsOf = (m) => ({ ...DEFAULT_PREFS, ...(m.notify || {}) });

export function setPrefs(m, input = {}) {
  const next = prefsOf(m);
  for (const k of Object.keys(DEFAULT_PREFS)) {
    if (k === 'summaryTime') {
      if (/^([01]\d|2[0-3]):[0-5]\d$/.test(input.summaryTime || '')) next.summaryTime = input.summaryTime;
    } else if (typeof input[k] === 'boolean') {
      next[k] = input[k];
    }
  }
  m.notify = next;
  return next;
}

// Net meldingen aangezet? Begin het ochtendoverzicht pas morgen.
export function startSummaryTomorrow(member) {
  if (!hasChannel(member)) {
    const d = new Date();
    member.lastSummary = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}

export function addSubscription(member, sub, userAgent) {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw Object.assign(new Error('Ongeldige inschrijving'), { status: 400 });
  if (!/^https:\/\//.test(sub.endpoint)) throw Object.assign(new Error('Ongeldige inschrijving'), { status: 400 });
  // Eén toestel hoort bij één persoon: haal het bij anderen weg.
  for (const m of db().members) m.push = (m.push || []).filter((s) => s.endpoint !== sub.endpoint);
  member.push.push({
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    device: describeDevice(userAgent),
    createdAt: new Date().toISOString(),
  });
}

export function removeSubscription(member, endpoint) {
  member.push = (member.push || []).filter((s) => s.endpoint !== endpoint);
}

function describeDevice(ua = '') {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Toestel';
}

// Stuur een melding naar één lid. `kind` is de voorkeur die aan moet staan.
export async function sendTo(member, payload, kind) {
  if (!hasChannel(member)) return 0;
  if (kind && !prefsOf(member)[kind]) return 0;
  const { urgency = 'normal', ...rest } = payload;
  const body = JSON.stringify({ url: '/', ...rest });
  let sent = 0;
  let dirty = false;

  // Via de Home Assistant-app
  if (member.haNotify && haConfigured()) {
    try {
      await sendAppNotification(member.haNotify, {
        title: rest.title,
        body: rest.body,
        tag: rest.tag,
        url: panelPath(),
        urgent: urgency === 'high',
      });
      sent++;
    } catch (e) {
      console.error(`Melding via Home Assistant-app naar ${member.name} mislukt:`, e.message);
    }
  }

  await Promise.all((member.push || []).map(async (sub) => {
    try {
      await webpush.sendNotification(sub, body, { TTL: 6 * 3600, urgency });
      sent++;
    } catch (e) {
      // 404/410: toestel heeft de inschrijving opgezegd. Opruimen.
      if (e.statusCode === 404 || e.statusCode === 410) {
        member.push = member.push.filter((s) => s.endpoint !== sub.endpoint);
        dirty = true;
      } else {
        console.error(`Push naar ${member.name} mislukt:`, e.statusCode || '', e.body || e.message);
      }
    }
  }));
  if (dirty) save();
  return sent;
}

// Stuur naar een groep. memberIds leeg/null = iedereen. exceptId = wie het zelf deed.
export async function notify(memberIds, payload, kind, exceptId) {
  const targets = db().members.filter((m) =>
    m.id !== exceptId && (!memberIds?.length || memberIds.includes(m.id)));
  const counts = await Promise.all(targets.map((m) => sendTo(m, payload, kind)));
  return counts.reduce((a, b) => a + b, 0);
}

// ---------- Planner: ochtendoverzicht en herinneringen ----------
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

async function dailySummaries(now) {
  const today = dateKey(now);
  const due = db().members.filter((m) =>
    hasChannel(m) && prefsOf(m).dailySummary && m.lastSummary !== today && hhmm(now) >= prefsOf(m).summaryTime);
  if (!due.length) return;

  const start = new Date(today + 'T00:00:00');
  const end = new Date(today + 'T23:59:59');
  const { events } = await eventsBetween(start, end);

  for (const m of due) {
    m.lastSummary = today;
    const mine = events.filter((e) => (e.memberIds || []).includes(m.id) || (e.source === 'huis' && !(e.memberIds || []).length));
    const tasks = db().tasks.filter((t) => !t.done && t.due && t.due <= today && (!t.assigneeId || t.assigneeId === m.id));
    if (!mine.length && !tasks.length) continue;

    const lines = [];
    const timed = mine.filter((e) => !e.allDay).slice(0, 3)
      .map((e) => `${new Date(e.start).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })} ${e.title}`);
    const allDay = mine.filter((e) => e.allDay).map((e) => e.title);
    if (allDay.length) lines.push(allDay.join(', '));
    lines.push(...timed);
    if (mine.length > timed.length + allDay.length) lines.push(`+${mine.length - timed.length - allDay.length} meer`);
    if (tasks.length) lines.push(`${tasks.length} ${tasks.length === 1 ? 'taak' : 'taken'}: ${tasks.slice(0, 3).map((t) => t.title).join(', ')}`);

    const h = now.getHours();
    const hi = h < 12 ? 'Goedemorgen' : h < 18 ? 'Goedemiddag' : 'Goedenavond';
    await sendTo(m, { title: `${hi} ${m.name}`, body: lines.join('\n'), url: '/#/vandaag', tag: `dag-${today}` }, 'dailySummary');
  }
  save();
}

async function eventReminders(now) {
  const d = db();
  const soon = now.getTime() + 30 * 60e3;
  for (const ev of d.events) {
    if (ev.allDay || d.sentReminders[ev.id] === ev.start) continue;
    const t = new Date(ev.start).getTime();
    if (t > now.getTime() && t <= soon) {
      d.sentReminders[ev.id] = ev.start;
      const time = new Date(ev.start).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
      await notify(ev.memberIds, {
        title: ev.title,
        body: `Om ${time}${ev.location ? ` · ${ev.location}` : ''}`,
        url: '/#/agenda',
        tag: `herinnering-${ev.id}`,
        urgency: 'high',
      }, 'eventReminder');
      save();
    }
  }
  // Oude herinneringen opruimen
  for (const id of Object.keys(d.sentReminders)) {
    if (!d.events.some((e) => e.id === id)) delete d.sentReminders[id];
  }
}

export function startScheduler() {
  const tick = async () => {
    const now = new Date();
    try {
      await dailySummaries(now);
      await eventReminders(now);
    } catch (e) {
      console.error('Planner-fout:', e.message);
    }
  };
  setInterval(tick, 60e3);
  setTimeout(tick, 5e3);
}
