import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, save, db, newId } from './lib/store.js';
import {
  checkPin, pinAllowed, recordFailedPin, readSession, setSession, clearSession,
  requireHouse, requireMember,
} from './lib/auth.js';
import { eventsBetween, testCalendar, normalizeUrl, buildFeed } from './lib/calendars.js';
import * as ha from './lib/ha.js';
import * as push from './lib/push.js';
import { isAddon, loadAddonOptions, addonInfo } from './lib/addon.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);

await loadAddonOptions();
if (!process.env.HUIS_PIN && !isAddon) {
  console.error('Zet HUIS_PIN (de pincode van het huis) in je omgeving of .env. Zie README.');
  process.exit(1);
}
if (isAddon && !process.env.HUIS_PIN) {
  console.log('Geen pincode ingesteld: Huis werkt alleen via de zijbalk van Home Assistant.');
}

load();
push.initPush();
push.startScheduler();
const app = express();
const later = (p) => p.catch((e) => console.error('Melding mislukt:', e.message));
app.set('trust proxy', true);
app.use(express.json({ limit: '100kb' }));

// ---------- Live updates (Server-Sent Events) ----------
const listeners = new Set();
function changed(what) {
  save();
  for (const res of listeners) res.write(`data: ${JSON.stringify({ what })}\n\n`);
}
app.get('/api/stream', requireHouse, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  listeners.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    listeners.delete(res);
  });
});

// ---------- Hulpjes ----------
const clean = (s, max = 200) => String(s ?? '').trim().slice(0, max);
const isDateKey = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isIso = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));
const COLORS = ['#ff6b5b', '#3d8bfd', '#22b07d', '#f5a524', '#a061ff', '#ec4899', '#14b8a6', '#64748b'];
const publicMember = (m) => ({
  id: m.id,
  name: m.name,
  color: m.color,
  calendars: (m.calendars || []).map(({ id, label, privacy }) => ({ id, label, privacy })),
});
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- Inloggen ----------
app.post('/api/login', (req, res) => {
  if (!pinAllowed(req.ip)) return res.status(429).json({ error: 'Te veel pogingen. Probeer het over 15 minuten opnieuw.' });
  if (!process.env.HUIS_PIN) {
    return res.status(403).json({ error: 'Er is geen pincode ingesteld. Open Huis via Home Assistant, of stel een pincode in bij de add-on.' });
  }
  if (!checkPin(req.body?.pin)) {
    recordFailedPin(req.ip);
    return res.status(401).json({ error: 'Onjuiste pincode' });
  }
  setSession(req, res, { house: true, memberId: null });
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  clearSession(req, res);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const s = readSession(req);
  if (!s?.house) return res.json({ house: false });
  const { members } = db();
  const me = members.find((m) => m.id === s.memberId);
  res.json({
    house: true,
    ingress: Boolean(s.ingress),
    addon: isAddon,
    haName: s.haName || null,
    me: me ? { ...publicMember(me), calendars: me.calendars || [] } : null,
    members: members.map(publicMember),
    colors: COLORS,
  });
});

app.post('/api/me/select', requireHouse, (req, res) => {
  const m = db().members.find((x) => x.id === req.body?.memberId);
  if (!m) return res.status(404).json({ error: 'Onbekend lid' });
  setSession(req, res, { house: true, memberId: m.id });
  res.json({ ok: true });
});

// ---------- Leden ----------
app.post('/api/members', requireHouse, (req, res) => {
  const name = clean(req.body?.name, 40);
  if (!name) return res.status(400).json({ error: 'Naam is verplicht' });
  const { members } = db();
  const color = COLORS.includes(req.body?.color) ? req.body.color : COLORS[members.length % COLORS.length];
  const m = { id: newId(), name, color, calendars: [], push: [] };
  members.push(m);
  setSession(req, res, { house: true, memberId: m.id });
  changed('members');
  res.json(publicMember(m));
});

app.patch('/api/members/me', requireMember, (req, res) => {
  const m = req.member;
  if (req.body?.name) m.name = clean(req.body.name, 40);
  if (COLORS.includes(req.body?.color)) m.color = req.body.color;
  changed('members');
  res.json(publicMember(m));
});

app.delete('/api/members/me', requireMember, (req, res) => {
  const d = db();
  d.members = d.members.filter((m) => m.id !== req.member.id);
  for (const t of d.tasks) if (t.assigneeId === req.member.id) t.assigneeId = null;
  for (const e of d.events) e.memberIds = (e.memberIds || []).filter((id) => id !== req.member.id);
  setSession(req, res, { house: true, memberId: null });
  changed('members');
  res.json({ ok: true });
});

// Agenda-links van het ingelogde lid
app.post('/api/members/me/calendars', requireMember, wrap(async (req, res) => {
  const url = normalizeUrl(req.body?.url);
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Plak een agenda-link die begint met https:// of webcal://' });
  const test = await testCalendar(url);
  if (!test.ok) return res.status(400).json({ error: `Kon de agenda niet lezen: ${test.error}` });
  const cal = {
    id: newId(),
    label: clean(req.body?.label, 40) || test.name || 'Agenda',
    url,
    privacy: req.body?.privacy === 'busy' ? 'busy' : 'details',
  };
  req.member.calendars = [...(req.member.calendars || []), cal];
  changed('calendar');
  res.json({ ...cal, events: test.events });
}));

app.patch('/api/members/me/calendars/:id', requireMember, (req, res) => {
  const cal = (req.member.calendars || []).find((c) => c.id === req.params.id);
  if (!cal) return res.status(404).json({ error: 'Niet gevonden' });
  if (req.body?.label) cal.label = clean(req.body.label, 40);
  if (['busy', 'details'].includes(req.body?.privacy)) cal.privacy = req.body.privacy;
  changed('calendar');
  res.json(cal);
});

app.delete('/api/members/me/calendars/:id', requireMember, (req, res) => {
  req.member.calendars = (req.member.calendars || []).filter((c) => c.id !== req.params.id);
  changed('calendar');
  res.json({ ok: true });
});

// ---------- Agenda ----------
app.get('/api/calendar', requireMember, wrap(async (req, res) => {
  const { from, to } = req.query;
  if (!isDateKey(from) || !isDateKey(to)) return res.status(400).json({ error: 'from/to moeten YYYY-MM-DD zijn' });
  const result = await eventsBetween(new Date(from + 'T00:00:00'), new Date(to + 'T23:59:59'));
  res.json(result);
}));

function eventFromBody(body, existing = {}) {
  const allDay = Boolean(body.allDay ?? existing.allDay);
  const start = body.start ?? existing.start;
  const end = body.end ?? existing.end ?? start;
  const ok = allDay ? isDateKey(start) && isDateKey(end) : isIso(start) && isIso(end);
  if (!ok) return { error: 'Ongeldige datum of tijd' };
  if ((allDay ? end < start : new Date(end) < new Date(start))) return { error: 'Einde ligt voor het begin' };
  const title = clean(body.title ?? existing.title, 120);
  if (!title) return { error: 'Titel is verplicht' };
  const ids = new Set(db().members.map((m) => m.id));
  return {
    value: {
      title,
      allDay,
      start,
      end,
      location: clean(body.location ?? existing.location, 120),
      notes: clean(body.notes ?? existing.notes, 1000),
      memberIds: (body.memberIds ?? existing.memberIds ?? []).filter((id) => ids.has(id)),
    },
  };
}

app.post('/api/events', requireMember, (req, res) => {
  const { value, error } = eventFromBody(req.body || {});
  if (error) return res.status(400).json({ error });
  const ev = { id: newId(), ...value, createdBy: req.member.id, createdAt: new Date().toISOString() };
  db().events.push(ev);
  changed('calendar');
  const when = ev.allDay
    ? new Date(ev.start + 'T12:00:00').toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })
    : new Date(ev.start).toLocaleString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  later(push.notify(ev.memberIds, {
    title: `Nieuwe afspraak: ${ev.title}`,
    body: `${when} · door ${req.member.name}`,
    url: '/#/agenda',
    tag: `afspraak-${ev.id}`,
  }, 'eventAdded', req.member.id));
  res.json(ev);
});

app.patch('/api/events/:id', requireMember, (req, res) => {
  const ev = db().events.find((e) => e.id === req.params.id);
  if (!ev) return res.status(404).json({ error: 'Niet gevonden' });
  const { value, error } = eventFromBody(req.body || {}, ev);
  if (error) return res.status(400).json({ error });
  Object.assign(ev, value);
  changed('calendar');
  res.json(ev);
});

app.delete('/api/events/:id', requireMember, (req, res) => {
  const d = db();
  d.events = d.events.filter((e) => e.id !== req.params.id);
  changed('calendar');
  res.json({ ok: true });
});

// Abonneerbare feed van de gezinsagenda (voor de Agenda-app op je iPhone)
app.get('/api/feed-url', requireMember, (req, res) => {
  if (req.session.ingress) {
    // Via de zijbalk kennen we het losse adres niet; de agenda-app moet de feed zonder HA-login kunnen ophalen.
    return res.json({ ingress: true, path: `/feed/${db().feedToken}.ics` });
  }
  const host = req.get('host');
  res.json({
    https: `${req.protocol}://${host}/feed/${db().feedToken}.ics`,
    webcal: `webcal://${host}/feed/${db().feedToken}.ics`,
  });
});

app.get('/feed/:token.ics', (req, res) => {
  if (req.params.token !== db().feedToken) return res.status(404).end();
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.send(buildFeed(req.hostname));
});

// ---------- Taken ----------
const REPEATS = ['none', 'daily', 'weekly', 'monthly'];
function nextDue(due, repeat) {
  const d = new Date((due || new Date().toISOString().slice(0, 10)) + 'T12:00:00');
  if (repeat === 'daily') d.setDate(d.getDate() + 1);
  if (repeat === 'weekly') d.setDate(d.getDate() + 7);
  if (repeat === 'monthly') d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

app.get('/api/tasks', requireMember, (req, res) => res.json(db().tasks));

app.post('/api/tasks', requireMember, (req, res) => {
  const title = clean(req.body?.title, 120);
  if (!title) return res.status(400).json({ error: 'Titel is verplicht' });
  const due = isDateKey(req.body?.due) ? req.body.due : null;
  const assigneeId = db().members.some((m) => m.id === req.body?.assigneeId) ? req.body.assigneeId : null;
  const t = {
    id: newId(), title, due, assigneeId,
    repeat: REPEATS.includes(req.body?.repeat) ? req.body.repeat : 'none',
    done: false, doneAt: null, doneBy: null,
    createdBy: req.member.id, createdAt: new Date().toISOString(),
  };
  db().tasks.push(t);
  changed('tasks');
  if (t.assigneeId && t.assigneeId !== req.member.id) {
    later(push.notify([t.assigneeId], {
      title: `Nieuwe taak van ${req.member.name}`,
      body: t.title + (t.due ? ` · ${t.due === new Date().toISOString().slice(0, 10) ? 'vandaag' : t.due}` : ''),
      url: '/#/taken',
      tag: `taak-${t.id}`,
    }, 'taskAssigned'));
  }
  res.json(t);
});

app.patch('/api/tasks/:id', requireMember, (req, res) => {
  const d = db();
  const t = d.tasks.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Niet gevonden' });
  const b = req.body || {};
  const oldAssignee = t.assigneeId;
  if (b.title !== undefined) t.title = clean(b.title, 120) || t.title;
  if (b.due !== undefined) t.due = isDateKey(b.due) ? b.due : null;
  if (b.assigneeId !== undefined) t.assigneeId = d.members.some((m) => m.id === b.assigneeId) ? b.assigneeId : null;
  if (REPEATS.includes(b.repeat)) t.repeat = b.repeat;
  if (b.done !== undefined && Boolean(b.done) !== t.done) {
    t.done = Boolean(b.done);
    t.doneAt = t.done ? new Date().toISOString() : null;
    t.doneBy = t.done ? req.member.id : null;
    // Terugkerende taak: zet meteen de volgende klaar.
    if (t.done && t.repeat !== 'none') {
      const next = {
        ...t, id: newId(), due: nextDue(t.due, t.repeat), done: false, doneAt: null, doneBy: null,
        createdAt: new Date().toISOString(),
      };
      delete next.nextId;
      d.tasks.push(next);
      t.nextId = next.id;
    }
    // Per ongeluk afgevinkt? Haal de al aangemaakte volgende weer weg.
    if (!t.done && t.nextId) {
      const next = d.tasks.find((x) => x.id === t.nextId);
      if (next && !next.done) d.tasks = d.tasks.filter((x) => x.id !== next.id);
      delete t.nextId;
    }
  }
  changed('tasks');
  if (t.assigneeId && t.assigneeId !== oldAssignee && t.assigneeId !== req.member.id && !t.done) {
    later(push.notify([t.assigneeId], {
      title: `${req.member.name} gaf je een taak`,
      body: t.title,
      url: '/#/taken',
      tag: `taak-${t.id}`,
    }, 'taskAssigned'));
  }
  res.json(t);
});

app.delete('/api/tasks/:id', requireMember, (req, res) => {
  const d = db();
  d.tasks = d.tasks.filter((t) => t.id !== req.params.id);
  changed('tasks');
  res.json({ ok: true });
});

app.post('/api/tasks/clear-done', requireMember, (req, res) => {
  const d = db();
  d.tasks = d.tasks.filter((t) => !t.done);
  changed('tasks');
  res.json({ ok: true });
});

// ---------- Boodschappen ----------
app.get('/api/shopping', requireMember, (req, res) => res.json(db().shopping));

app.post('/api/shopping', requireMember, (req, res) => {
  const title = clean(req.body?.title, 80);
  if (!title) return res.status(400).json({ error: 'Wat moet er gehaald worden?' });
  const item = { id: newId(), title, done: false, createdBy: req.member.id, createdAt: new Date().toISOString() };
  db().shopping.push(item);
  changed('shopping');
  later(push.notify(null, {
    title: 'Boodschappenlijstje',
    body: `${req.member.name} zette "${item.title}" op de lijst`,
    url: '/#/taken',
    tag: 'boodschappen',
  }, 'shopping', req.member.id));
  res.json(item);
});

app.patch('/api/shopping/:id', requireMember, (req, res) => {
  const item = db().shopping.find((x) => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Niet gevonden' });
  if (req.body?.done !== undefined) item.done = Boolean(req.body.done);
  if (req.body?.title) item.title = clean(req.body.title, 80);
  changed('shopping');
  res.json(item);
});

app.delete('/api/shopping/:id', requireMember, (req, res) => {
  const d = db();
  d.shopping = d.shopping.filter((x) => x.id !== req.params.id);
  changed('shopping');
  res.json({ ok: true });
});

app.post('/api/shopping/clear-done', requireMember, (req, res) => {
  const d = db();
  d.shopping = d.shopping.filter((x) => !x.done);
  changed('shopping');
  res.json({ ok: true });
});

// ---------- Home Assistant ----------
app.get('/api/ha/status', requireMember, wrap(async (req, res) => res.json(await ha.ping())));

app.get('/api/ha/states', requireMember, wrap(async (req, res) => {
  if (!ha.haConfigured()) return res.status(503).json({ error: 'Home Assistant is nog niet ingesteld' });
  res.json({ states: await ha.getStates(), favorites: db().haFavorites });
}));

app.post('/api/ha/service', requireMember, wrap(async (req, res) => {
  const { domain, service, entity_id, data } = req.body || {};
  await ha.callService(domain, service, entity_id, data);
  res.json({ ok: true });
}));

app.put('/api/ha/favorites', requireMember, (req, res) => {
  const list = Array.isArray(req.body?.favorites) ? req.body.favorites : [];
  db().haFavorites = list.filter((x) => typeof x === 'string' && /^[a-z_]+\.[\w-]+$/.test(x)).slice(0, 100);
  changed('ha');
  res.json({ favorites: db().haFavorites });
});

// ---------- Pushmeldingen ----------
app.get('/api/push', requireMember, wrap(async (req, res) => {
  // Telefoons met de Home Assistant-app, om meldingen via die app te sturen
  let haApps = [];
  if (ha.haConfigured()) haApps = await ha.listNotifyServices().catch(() => []);
  res.json({
    publicKey: push.publicKey(),
    prefs: push.prefsOf(req.member),
    devices: (req.member.push || []).map(({ endpoint, device, createdAt }) => ({ endpoint, device, createdAt })),
    haNotify: req.member.haNotify || '',
    haApps,
    active: push.hasChannel(req.member),
  });
}));

app.put('/api/push/ha-app', requireMember, (req, res) => {
  const service = String(req.body?.service || '');
  if (service && !/^mobile_app_[a-z0-9_]+$/.test(service)) return res.status(400).json({ error: 'Ongeldige keuze' });
  if (service) push.startSummaryTomorrow(req.member);
  if (service) req.member.haNotify = service; else delete req.member.haNotify;
  save();
  res.json({ haNotify: req.member.haNotify || '' });
});

app.post('/api/push/subscribe', requireMember, (req, res) => {
  push.startSummaryTomorrow(req.member);
  push.addSubscription(req.member, req.body?.subscription, req.get('user-agent'));
  save();
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', requireMember, (req, res) => {
  push.removeSubscription(req.member, req.body?.endpoint);
  save();
  res.json({ ok: true });
});

app.put('/api/push/prefs', requireMember, (req, res) => {
  const prefs = push.setPrefs(req.member, req.body || {});
  save();
  res.json({ prefs });
});

app.post('/api/push/test', requireMember, wrap(async (req, res) => {
  const sent = await push.sendTo(req.member, {
    title: 'Het werkt! 🎉',
    body: `Hoi ${req.member.name}, meldingen van Huis komen binnen.`,
    tag: 'test',
  });
  if (!sent) return res.status(400).json({ error: 'Geen toestel bereikt. Zet meldingen opnieuw aan.' });
  res.json({ sent });
}));

// Gegevens om Home Assistant meldingen te laten sturen
app.get('/api/push/ha-info', requireMember, (req, res) => {
  // Als add-on bereikt Home Assistant ons via de interne naam van de add-on.
  const url = isAddon ? `http://${addonInfo.hostname}:8080/api/notify` : `${req.protocol}://${req.get('host')}/api/notify`;
  res.json({ url, token: db().notifyToken, addon: isAddon });
});

// Home Assistant (of iets anders) stuurt hier een melding naar het huis.
// POST /api/notify  Authorization: Bearer <token>
// {"title": "Wasmachine", "message": "De was is klaar", "to": "all" | ["Jan", "Eva"], "url": "/#/huis"}
app.post('/api/notify', wrap(async (req, res) => {
  const auth = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const given = Buffer.from(auth || String(req.query.token || ''));
  const expected = Buffer.from(db().notifyToken);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return res.status(401).json({ error: 'Onjuist token' });
  }
  const b = req.body || {};
  const message = clean(b.message, 300);
  if (!message) return res.status(400).json({ error: 'message is verplicht' });
  let ids = null;
  const to = typeof b.to === 'string' && b.to !== 'all' ? b.to.split(',') : Array.isArray(b.to) ? b.to : null;
  if (to) {
    const want = to.map((x) => String(x).trim().toLowerCase());
    ids = db().members.filter((m) => want.includes(m.name.toLowerCase()) || want.includes(m.id)).map((m) => m.id);
    if (!ids.length) return res.status(400).json({ error: 'Niemand gevonden met die naam' });
  }
  const sent = await push.notify(ids, {
    title: clean(b.title, 80) || 'Huis',
    body: message,
    url: typeof b.url === 'string' && b.url.startsWith('/') ? b.url : '/#/huis',
    tag: b.tag ? clean(b.tag, 60) : undefined,
    urgency: b.urgent ? 'high' : 'normal',
  }, 'ha');
  res.json({ ok: true, sent });
}));

// ---------- Frontend ----------
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, file) {
    if (file.endsWith('sw.js') || file.endsWith('.html')) res.set('Cache-Control', 'no-cache');
  },
}));
app.get(/^\/(?!api|feed).*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status && err.status < 600 ? err.status : 500).json({ error: err.message || 'Er ging iets mis' });
});

app.listen(PORT, () => console.log(`Huis-app draait op http://localhost:${PORT}`));
