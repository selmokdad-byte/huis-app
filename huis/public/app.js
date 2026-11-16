// Huis-app — één bestand, geen build-stap nodig.

// ================= Hulpjes =================
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => new Date(k + 'T00:00:00');
const todayKey = () => keyOf(new Date());
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
const mondayOf = (k) => { const d = parseKey(k); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return keyOf(d); };
const fmt = (k, opts) => parseKey(k).toLocaleDateString('nl-NL', opts);
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
const timeOf = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const initials = (name = '?') => name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

function relDay(k) {
  const t = todayKey();
  if (k === t) return 'Vandaag';
  if (k === addDays(t, 1)) return 'Morgen';
  if (k === addDays(t, -1)) return 'Gisteren';
  const diff = Math.round((parseKey(k) - parseKey(t)) / 864e5);
  if (diff > 1 && diff < 7) return fmt(k, { weekday: 'long' }).replace(/^./, (c) => c.toUpperCase());
  return fmt(k, { day: 'numeric', month: 'short' });
}

// ================= Status =================
const S = {
  house: false,
  me: null,
  members: [],
  colors: [],
  tasks: [],
  shopping: [],
  cal: {},            // "van|tot" -> {events, errors}
  calLoading: {},
  week: mondayOf(todayKey()),
  calFilter: 'all',
  taskTab: 'taken',
  taskFilter: 'all',
  haStatus: null,
  ha: { states: [], favorites: [], error: null, loaded: false },
  haEdit: false,
  haSearch: '',
  haBusy: new Set(),
  push: null,         // {publicKey, prefs, devices}
  pushEndpoint: null, // inschrijving van dit toestel
};
const member = (id) => S.members.find((m) => m.id === id);

// ================= API =================
async function api(path, { method = 'GET', body } = {}) {
  // Relatieve paden: zo werkt de app ook onder het ingress-adres van Home Assistant.
  const res = await fetch(path.replace(/^\//, ''), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') {
    S.house = false;
    S.me = null;
    render();
  } else if (res.status === 403) {
    S.me = null;
    render();
  }
  if (!res.ok) throw new Error(data.error || 'Er ging iets mis');
  return data;
}

async function loadMe() {
  const r = await api('/api/me');
  S.house = r.house;
  S.ingress = Boolean(r.ingress);
  S.addon = Boolean(r.addon);
  S.haName = r.haName || null;
  S.me = r.me || null;
  S.members = r.members || [];
  S.colors = r.colors || [];
}
const loadTasks = async () => { S.tasks = await api('/api/tasks'); };
const loadShopping = async () => { S.shopping = await api('/api/shopping'); };
async function loadHa() {
  if (!S.haStatus) S.haStatus = await api('/api/ha/status').catch((e) => ({ configured: true, ok: false, message: e.message }));
  if (!S.haStatus.configured) return;
  try {
    const r = await api('/api/ha/states');
    S.ha = { states: r.states, favorites: r.favorites, error: null, loaded: true };
  } catch (e) {
    S.ha = { ...S.ha, error: e.message, loaded: true };
  }
}
async function loadAll() {
  await Promise.all([loadTasks(), loadShopping(), loadHa()]);
}

async function ensureCalendar(from, to) {
  const k = `${from}|${to}`;
  if (S.cal[k] || S.calLoading[k]) return S.cal[k];
  S.calLoading[k] = true;
  try {
    S.cal[k] = await api(`/api/calendar?from=${from}&to=${to}`);
  } catch (e) {
    S.cal[k] = { events: [], errors: [{ error: e.message }] };
  } finally {
    delete S.calLoading[k];
    softRender();
  }
  return S.cal[k];
}

// ================= UI-bouwstenen =================
const ICON = {
  today: '<path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/><circle cx="12" cy="12" r="4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  tasks: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.2 1.2L6.8 5M3.5 12l1.2 1.2L6.8 11M3.5 18l1.2 1.2L6.8 17"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  power: '<path d="M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0"/>',
  thermo: '<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/>',
  blinds: '<path d="M4 4h16M5 4v16M19 4v16M5 8h14M5 12h14M5 16h14"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  play: '<path d="M7 5v14l12-7z"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="m12 14 4-5"/>',
  fan: '<circle cx="12" cy="12" r="2"/><path d="M12 10c0-4 1-7 4-7s2 5-2 7M14 12c4 0 7 1 7 4s-5 2-7-2M12 14c0 4-1 7-4 7s-2-5 2-7M10 12c-4 0-7-1-7-4s5-2 7 2"/>',
  door: '<path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M3 21h18M14 12h.01"/>',
  repeat: '<path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"/>',
  robot: '<rect x="4" y="8" width="16" height="12" rx="6"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/>',
};
const icon = (name, size = 22) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ICON.spark}</svg>`;

const avatar = (m, cls = '') => (m ? `<span class="avatar ${cls}" style="background:${esc(m.color)}" title="${esc(m.name)}">${esc(initials(m.name))}</span>` : '');

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 2600);
}

// Android-terugknop: sluit eerst een open venster in plaats van de pagina te verlaten.
let sheetOpen = false;
window.addEventListener('popstate', () => {
  if (sheetOpen) closeSheet(true);
});

function openSheet(title, body) {
  if (!sheetOpen) history.pushState({ sheet: true }, '');
  sheetOpen = true;
  $('#sheet-root').innerHTML = `
    <div class="backdrop" data-action="close-sheet"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="grab"></div>
      <div class="sheet-head"><h2>${esc(title)}</h2><button class="link" data-action="close-sheet">Sluit</button></div>
      ${body}
    </div>`;
  document.body.style.overflow = 'hidden';
}
function closeSheet(fromHistory = false) {
  const wasOpen = sheetOpen;
  sheetOpen = false;
  $('#sheet-root').innerHTML = '';
  document.body.style.overflow = '';
  if (wasOpen && !fromHistory && history.state?.sheet) history.back();
}

// ================= Routering & renderen =================
const TABS = [
  ['vandaag', 'Vandaag', 'today'],
  ['agenda', 'Agenda', 'calendar'],
  ['taken', 'Taken', 'tasks'],
  ['huis', 'Huis', 'home'],
  ['ik', 'Ik', 'user'],
];
const route = () => (location.hash.replace(/^#\/?/, '') || 'vandaag').split('/')[0];

function render() {
  const app = $('#app');
  const tabbar = $('#tabbar');
  if (!S.house) {
    tabbar.hidden = true;
    app.innerHTML = viewLogin();
    return;
  }
  if (!S.me) {
    tabbar.hidden = true;
    app.innerHTML = viewWho();
    return;
  }
  const r = route();
  tabbar.hidden = false;
  tabbar.innerHTML = TABS.map(([id, label, ic]) =>
    `<a href="#/${id}" ${r === id ? 'aria-current="page"' : ''}>${icon(ic, 26)}<span>${label}</span></a>`).join('');
  const views = { vandaag: viewToday, agenda: viewAgenda, taken: viewTasks, huis: viewHouse, ik: viewMe };
  app.innerHTML = (views[r] || viewToday)();
  render.pending = false;
}

// Herteken niet terwijl iemand aan het typen is; doe het na het typen.
function softRender() {
  const a = document.activeElement;
  if (a && $('#app').contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) {
    render.pending = true;
    return;
  }
  render();
}
document.addEventListener('focusout', () => setTimeout(() => render.pending && softRender(), 50));

// ================= Schermen =================
function viewLogin() {
  return `
  <form class="auth" data-form="login">
    <img class="logo" src="icons/icon.svg" alt="">
    <h1>Welkom thuis</h1>
    <p class="sub" style="color:var(--muted);margin:0 0 8px">Voer de pincode van het huis in.</p>
    <input class="input pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" aria-label="Pincode" required>
    <button class="btn block">Openen</button>
  </form>`;
}

function colorPicker(selected) {
  return `<input type="hidden" name="color" value="${esc(selected)}">
    <div class="colors">${S.colors.map((c) =>
      `<button type="button" data-action="pick-color" data-color="${c}" aria-pressed="${c === selected}" style="background:${c}" aria-label="Kleur ${c}"></button>`).join('')}</div>`;
}

function viewWho() {
  const free = S.colors.find((c) => !S.members.some((m) => m.color === c)) || S.colors[0];
  return `
  <div class="auth">
    <h1>Wie ben jij?</h1>
    ${S.haName ? `<p style="color:var(--muted);margin:0">Ingelogd in Home Assistant als <b>${esc(S.haName)}</b>. Kies je profiel; de volgende keer ben je meteen jezelf.</p>` : ''}
    ${S.members.length ? `<div class="card list">${S.members.map((m) => `
      <button class="row" data-action="select-member" data-id="${m.id}">${avatar(m)}<span class="grow title">${esc(m.name)}</span><span class="chev">${icon('right', 18)}</span></button>`).join('')}
    </div>` : ''}
    <div class="section-title">${S.members.length ? 'Of: ik ben nieuw' : 'Maak je profiel'}</div>
    <form class="card pad" data-form="new-member">
      <label class="field"><span>Naam</span><input class="input" name="name" required maxlength="40" autocomplete="given-name" value="${esc(S.members.length ? '' : (S.haName || ''))}"></label>
      <div class="field"><span>Jouw kleur</span>${colorPicker(free)}</div>
      <button class="btn block">Doe mee</button>
    </form>
  </div>`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return 'Goedenacht';
  if (h < 12) return 'Goedemorgen';
  if (h < 18) return 'Goedemiddag';
  return 'Goedenavond';
}

function eventOnDay(e, k) {
  if (e.allDay) return e.start <= k && (e.end || e.start) >= k;
  const ds = parseKey(k), de = parseKey(addDays(k, 1));
  const s = new Date(e.start), en = new Date(e.end || e.start);
  return s < de && (en > ds || +s === +en && s >= ds);
}

function eventRow(e, dayK) {
  const people = (e.memberIds || []).map(member).filter(Boolean);
  const color = people[0]?.color || 'var(--muted)';
  let time = 'hele dag';
  if (!e.allDay) {
    const startsBefore = keyOf(new Date(e.start)) < dayK;
    time = startsBefore ? '…' : fmtTime(e.start);
  }
  const meta = [
    !e.allDay && `tot ${keyOf(new Date(e.end)) > dayK ? relDay(keyOf(new Date(e.end))).toLowerCase() + ' ' : ''}${fmtTime(e.end)}`,
    e.location,
    e.source === 'agenda' ? people.map((p) => p.name).join(', ') : people.length ? people.map((p) => p.name).join(', ') : 'Iedereen',
  ].filter(Boolean).map(esc).join(' · ');
  return `
    <button class="event ${e.busyOnly ? 'busy' : ''}" data-action="open-event" data-id="${esc(e.id)}">
      <span class="time">${time}</span>
      <span class="bar" style="background:${esc(color)}"></span>
      <span class="grow"><span class="title">${esc(e.title)}</span> ${e.source === 'huis' ? '<span class="badge">Huis</span>' : ''}<br><span class="meta">${meta}</span></span>
    </button>`;
}

function calErrors(r) {
  if (!r?.errors?.length) return '';
  return r.errors.map((er) => {
    const who = member(er.memberId)?.name;
    return `<div class="warn">${esc(who ? `Agenda "${er.label}" van ${who}` : 'Agenda')} kon niet worden bijgewerkt: ${esc(er.error)}</div>`;
  }).join('');
}

function myOpenTasks() {
  const t = todayKey();
  return S.tasks
    .filter((x) => !x.done && (x.assigneeId === S.me.id || !x.assigneeId) && x.due && x.due <= t)
    .sort((a, b) => a.due.localeCompare(b.due));
}

function viewToday() {
  const t = todayKey();
  const cal = S.cal[`${t}|${addDays(t, 1)}`];
  if (!cal) ensureCalendar(t, addDays(t, 1));
  const todayEvents = cal ? cal.events.filter((e) => eventOnDay(e, t)) : null;
  const tomorrowEvents = cal ? cal.events.filter((e) => eventOnDay(e, addDays(t, 1))) : null;
  const tasks = myOpenTasks();
  const shopOpen = S.shopping.filter((s) => !s.done).length;
  const quick = S.ha.states.filter((s) => S.ha.favorites.includes(s.entity_id) && ['scene', 'script'].includes(s.domain));
  const persons = S.ha.states.filter((s) => s.domain === 'person');

  return `
  <div class="header"><div>
    <h1>${greeting()}, ${esc(S.me.name)}</h1>
    <div class="sub">${esc(fmt(t, { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
  </div>${avatar(S.me)}</div>

  <div class="stat-row">
    <a class="stat" href="#/agenda" style="text-decoration:none;color:inherit"><b>${todayEvents ? todayEvents.length : '–'}</b><span>afspraken vandaag</span></a>
    <a class="stat" href="#/taken" style="text-decoration:none;color:inherit"><b>${tasks.length}</b><span>taken voor jou</span></a>
    <button class="stat" data-action="goto-shopping"><b>${shopOpen}</b><span>boodschappen</span></button>
  </div>

  ${persons.length ? `<div class="section-title">Wie is er thuis</div>
  <div class="chips">${persons.map((p) => `<span class="chip"><span class="dot" style="background:${p.state === 'home' ? 'var(--ok)' : 'var(--line)'}"></span>${esc(p.name)} · ${esc(p.state === 'home' ? 'thuis' : p.state === 'not_home' ? 'weg' : p.state)}</span>`).join('')}</div>` : ''}

  <div class="section-title">Vandaag in huis</div>
  ${calErrors(cal)}
  <div class="card list">${todayEvents == null ? '<div class="empty">Laden…</div>' :
    todayEvents.length ? todayEvents.map((e) => eventRow(e, t)).join('') : '<div class="empty">Niets gepland vandaag</div>'}</div>

  ${tomorrowEvents?.length ? `<div class="section-title">Morgen</div>
  <div class="card list">${tomorrowEvents.map((e) => eventRow(e, addDays(t, 1))).join('')}</div>` : ''}

  <div class="section-title">Jouw taken <a class="link" href="#/taken">Alles</a></div>
  <div class="card list">${tasks.length ? tasks.slice(0, 6).map(taskRow).join('') : '<div class="empty">Niks dat vandaag moet 🎉</div>'}</div>

  ${quick.length ? `<div class="section-title">Snel <a class="link" href="#/huis">Huis</a></div>
  <div class="tiles">${quick.map(tile).join('')}</div>` : ''}`;
}

// ---------- Agenda ----------
function viewAgenda() {
  const from = S.week, to = addDays(S.week, 6);
  const cal = S.cal[`${from}|${to}`];
  if (!cal) ensureCalendar(from, to);
  const filtered = (cal?.events || []).filter((e) =>
    S.calFilter === 'all' || (e.memberIds || []).includes(S.calFilter) || (e.source === 'huis' && !(e.memberIds || []).length));
  const label = `${fmt(from, { day: 'numeric', month: 'short' })} – ${fmt(to, { day: 'numeric', month: 'short' })}`;
  const t = todayKey();
  const days = [...Array(7)].map((_, i) => addDays(from, i));

  return `
  <div class="header"><h1>Agenda</h1>
    <button class="btn ghost" style="min-height:36px;padding:6px 14px" data-action="week" data-dir="0">Vandaag</button></div>
  <div class="weeknav">
    <button class="icon-btn" data-action="week" data-dir="-1" aria-label="Vorige week">${icon('left')}</button>
    <span class="label">${esc(label)}</span>
    <button class="icon-btn" data-action="week" data-dir="1" aria-label="Volgende week">${icon('right')}</button>
  </div>
  <div class="chips">
    <button class="chip" data-action="cal-filter" data-id="all" aria-pressed="${S.calFilter === 'all'}">Iedereen</button>
    ${S.members.map((m) => `<button class="chip" data-action="cal-filter" data-id="${m.id}" aria-pressed="${S.calFilter === m.id}"><span class="dot" style="background:${esc(m.color)}"></span>${esc(m.name)}</button>`).join('')}
  </div>
  ${calErrors(cal)}
  ${!cal ? '<div class="card"><div class="empty">Agenda\'s laden…</div></div>' : days.map((k) => {
    const list = filtered.filter((e) => eventOnDay(e, k));
    return `<div class="day ${k === t ? 'today' : ''}">
      <h3>${esc(fmt(k, { weekday: 'long' }).replace(/^./, (c) => c.toUpperCase()))} <span class="date">${esc(fmt(k, { day: 'numeric', month: 'long' }))}</span></h3>
      <div class="card list">${list.length ? list.map((e) => eventRow(e, k)).join('') : `<button class="row meta" data-action="new-event" data-day="${k}" style="color:var(--muted)">Niets gepland · tik om toe te voegen</button>`}</div>
    </div>`;
  }).join('')}
  <button class="fab" data-action="new-event" aria-label="Nieuwe afspraak">${icon('plus', 28)}</button>`;
}

function memberChecks(selected = []) {
  return `<div class="chips" style="flex-wrap:wrap">${S.members.map((m) => `
    <label class="chip member-chip"><input type="checkbox" name="memberIds" value="${m.id}" ${selected.includes(m.id) ? 'checked' : ''} hidden><span class="dot" style="background:${esc(m.color)}"></span>${esc(m.name)}</label>`).join('')}</div>`;
}

function eventSheet(ev, day) {
  const now = new Date();
  const startH = new Date(now.getTime() + 36e5);
  startH.setMinutes(0, 0, 0);
  const d = day || todayKey();
  const e = ev || {
    title: '', allDay: false, memberIds: [S.me.id], location: '', notes: '',
    start: new Date(`${d}T${pad(startH.getHours())}:00`).toISOString(),
    end: new Date(new Date(`${d}T${pad(startH.getHours())}:00`).getTime() + 36e5).toISOString(),
  };
  const sd = e.allDay ? e.start : keyOf(new Date(e.start));
  const ed = e.allDay ? e.end || e.start : keyOf(new Date(e.end));
  openSheet(ev ? 'Afspraak bewerken' : 'Nieuwe afspraak', `
    <form data-form="event" data-id="${ev ? esc(ev.id) : ''}" class="form-event">
      <label class="field"><span>Wat</span><input class="input" name="title" value="${esc(e.title)}" required maxlength="120" placeholder="Bijv. verjaardag oma"></label>
      <label class="row card" style="margin-bottom:14px"><span class="grow">Hele dag</span>
        <span class="switch"><input type="checkbox" name="allDay" ${e.allDay ? 'checked' : ''}><span></span></span></label>
      <div class="two">
        <label class="field"><span>Begin</span><input class="input" type="date" name="startDate" value="${sd}" required></label>
        <label class="field timed"><span>Tijd</span><input class="input" type="time" name="startTime" value="${e.allDay ? '09:00' : timeOf(e.start)}"></label>
        <label class="field"><span>Einde</span><input class="input" type="date" name="endDate" value="${ed}" required></label>
        <label class="field timed"><span>Tijd</span><input class="input" type="time" name="endTime" value="${e.allDay ? '10:00' : timeOf(e.end)}"></label>
      </div>
      <div class="field"><span>Voor wie</span>${memberChecks(e.memberIds)}</div>
      <label class="field"><span>Waar</span><input class="input" name="location" value="${esc(e.location)}" maxlength="120"></label>
      <label class="field"><span>Notitie</span><textarea class="input" name="notes" maxlength="1000">${esc(e.notes)}</textarea></label>
      <button class="btn block">Bewaar</button>
      ${ev ? `<button type="button" class="btn danger block" data-action="delete-event" data-id="${esc(ev.id)}">Verwijder afspraak</button>` : ''}
    </form>`);
}

function eventDetails(e) {
  const people = (e.memberIds || []).map(member).filter(Boolean);
  const when = e.allDay
    ? (e.start === e.end ? fmt(e.start, { weekday: 'long', day: 'numeric', month: 'long' }) : `${fmt(e.start, { day: 'numeric', month: 'long' })} t/m ${fmt(e.end, { day: 'numeric', month: 'long' })}`)
    : `${new Date(e.start).toLocaleString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} – ${fmtTime(e.end)}`;
  openSheet(e.title, `
    <div class="card list">
      <div class="row"><span class="grow"><span class="meta">Wanneer</span><br>${esc(when)}</span></div>
      ${e.location ? `<div class="row"><span class="grow"><span class="meta">Waar</span><br>${esc(e.location)}</span></div>` : ''}
      <div class="row"><span class="grow"><span class="meta">Uit de agenda van</span><br>${esc(people.map((p) => p.name).join(', '))} · ${esc(e.calendarLabel || '')}</span>${people.map((p) => avatar(p)).join('')}</div>
    </div>
    <p class="hint">${e.busyOnly ? 'Deze agenda deelt alleen of iemand bezet is, geen details.' : 'Deze afspraak komt uit een gekoppelde agenda en pas je aan in die agenda zelf.'}</p>`);
}

// ---------- Taken & boodschappen ----------
function taskMeta(x) {
  const parts = [];
  if (x.due) parts.push(relDay(x.due));
  if (x.repeat && x.repeat !== 'none') parts.push({ daily: 'elke dag', weekly: 'elke week', monthly: 'elke maand' }[x.repeat]);
  const a = member(x.assigneeId);
  parts.push(a ? a.name : 'iedereen');
  return parts.map(esc).join(' · ');
}

function taskRow(x) {
  const overdue = !x.done && x.due && x.due < todayKey();
  return `<div class="row ${x.done ? 'done' : ''}">
    <button class="check ${x.done ? 'on' : ''}" data-action="toggle-task" data-id="${x.id}" aria-label="${x.done ? 'Niet klaar' : 'Klaar'}">${icon('check', 16)}</button>
    <button class="grow" style="background:none;border:0;text-align:left;padding:0" data-action="edit-task" data-id="${x.id}">
      <span class="title">${esc(x.title)}</span><br><span class="meta" ${overdue ? 'style="color:var(--danger)"' : ''}>${taskMeta(x)}</span>
    </button>
    ${avatar(member(x.assigneeId), 'sm')}
  </div>`;
}

function viewTasks() {
  const openTasks = S.tasks.filter((x) => !x.done);
  const shopOpen = S.shopping.filter((x) => !x.done);
  return `
  <div class="header"><h1>${S.taskTab === 'taken' ? 'Taken' : 'Boodschappen'}</h1></div>
  <div class="segmented">
    <button data-action="task-tab" data-tab="taken" aria-pressed="${S.taskTab === 'taken'}">Taken (${openTasks.length})</button>
    <button data-action="task-tab" data-tab="boodschappen" aria-pressed="${S.taskTab === 'boodschappen'}">Boodschappen (${shopOpen.length})</button>
  </div>
  ${S.taskTab === 'taken' ? viewTaskList() : viewShopping()}`;
}

function viewTaskList() {
  const t = todayKey();
  const mine = (x) => S.taskFilter === 'all' || x.assigneeId === S.me.id || (S.taskFilter === 'mine' && !x.assigneeId);
  const open = S.tasks.filter((x) => !x.done && mine(x)).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
  const groups = [
    ['Te laat', open.filter((x) => x.due && x.due < t)],
    ['Vandaag', open.filter((x) => x.due === t)],
    ['Binnenkort', open.filter((x) => x.due && x.due > t)],
    ['Zonder datum', open.filter((x) => !x.due)],
  ].filter(([, l]) => l.length);
  const done = S.tasks.filter((x) => x.done && mine(x)).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')).slice(0, 15);
  return `
  <form class="addbar" data-form="quick-task">
    <input class="input" name="title" placeholder="Nieuwe taak…" maxlength="120" required>
    <button class="btn" aria-label="Toevoegen">${icon('plus')}</button>
  </form>
  <div class="chips">
    <button class="chip" data-action="task-filter" data-f="all" aria-pressed="${S.taskFilter === 'all'}">Iedereen</button>
    <button class="chip" data-action="task-filter" data-f="mine" aria-pressed="${S.taskFilter === 'mine'}">Voor mij</button>
  </div>
  ${groups.length ? groups.map(([title, list]) => `
    <div class="section-title">${title}</div>
    <div class="card list">${list.map(taskRow).join('')}</div>`).join('') : '<div class="card"><div class="empty">Geen open taken. Lekker bezig!</div></div>'}
  ${done.length ? `<div class="section-title">Klaar <button class="link" data-action="clear-tasks">Wis klaar</button></div>
  <div class="card list">${done.map(taskRow).join('')}</div>` : ''}
  <button class="fab" data-action="new-task" aria-label="Nieuwe taak met details">${icon('plus', 28)}</button>`;
}

function taskSheet(x) {
  const v = x || { title: '', assigneeId: S.me.id, due: todayKey(), repeat: 'none' };
  openSheet(x ? 'Taak bewerken' : 'Nieuwe taak', `
    <form data-form="task" data-id="${x ? x.id : ''}">
      <label class="field"><span>Wat moet er gebeuren</span><input class="input" name="title" value="${esc(v.title)}" required maxlength="120" placeholder="Bijv. vuilnis buiten zetten"></label>
      <label class="field"><span>Wie</span><select class="input" name="assigneeId">
        <option value="">Iedereen</option>
        ${S.members.map((m) => `<option value="${m.id}" ${v.assigneeId === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
      </select></label>
      <div class="two">
        <label class="field"><span>Wanneer</span><input class="input" type="date" name="due" value="${esc(v.due || '')}"></label>
        <label class="field"><span>Herhalen</span><select class="input" name="repeat">
          ${[['none', 'Niet'], ['daily', 'Elke dag'], ['weekly', 'Elke week'], ['monthly', 'Elke maand']].map(([k, l]) => `<option value="${k}" ${v.repeat === k ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
      </div>
      <button class="btn block">Bewaar</button>
      ${x ? `<button type="button" class="btn danger block" data-action="delete-task" data-id="${x.id}">Verwijder taak</button>` : ''}
    </form>`);
}

function viewShopping() {
  const open = S.shopping.filter((x) => !x.done);
  const done = S.shopping.filter((x) => x.done);
  const row = (x) => `<div class="row ${x.done ? 'done' : ''}">
    <button class="check ${x.done ? 'on' : ''}" data-action="toggle-shop" data-id="${x.id}" aria-label="${x.done ? 'Terugzetten' : 'Gehaald'}">${icon('check', 16)}</button>
    <span class="grow title">${esc(x.title)}</span>
    <span class="meta">${esc(member(x.createdBy)?.name || '')}</span>
  </div>`;
  return `
  <form class="addbar" data-form="shop">
    <input class="input" name="title" placeholder="Wat moet er gehaald worden?" maxlength="80" required autocomplete="off">
    <button class="btn" aria-label="Toevoegen">${icon('plus')}</button>
  </form>
  <div class="card list">${open.length ? open.map(row).join('') : '<div class="empty">Het lijstje is leeg</div>'}</div>
  ${done.length ? `<div class="section-title">In het mandje <button class="link" data-action="clear-shop">Wis afgevinkt</button></div>
  <div class="card list">${done.map(row).join('')}</div>` : ''}`;
}

// ---------- Huis (Home Assistant) ----------
const DOMAIN_LABEL = {
  light: 'Lampen', switch: 'Schakelaars', fan: 'Ventilatoren', input_boolean: 'Hulpschakelaars', cover: 'Zonwering & gordijnen',
  lock: 'Sloten', climate: 'Klimaat', scene: 'Scènes', script: 'Scripts', media_player: 'Media', vacuum: 'Stofzuigers',
  sensor: 'Sensoren', binary_sensor: 'Meldingen & contacten', person: 'Personen', weather: 'Weer',
};
const DOMAIN_ICON = {
  light: 'bulb', switch: 'power', fan: 'fan', input_boolean: 'power', cover: 'blinds', lock: 'lock', climate: 'thermo',
  scene: 'spark', script: 'spark', media_player: 'play', vacuum: 'robot', sensor: 'gauge', binary_sensor: 'door', person: 'user', weather: 'today',
};
const TOGGLE = ['light', 'switch', 'fan', 'input_boolean'];

function stateText(s) {
  const map = { on: 'Aan', off: 'Uit', open: 'Open', closed: 'Dicht', opening: 'Gaat open', closing: 'Gaat dicht', locked: 'Op slot', unlocked: 'Open', playing: 'Speelt', paused: 'Gepauzeerd', idle: 'Stil', home: 'Thuis', not_home: 'Weg', unavailable: 'Niet bereikbaar', unknown: 'Onbekend', cleaning: 'Aan het zuigen', docked: 'In het station', heat: 'Verwarmen', cool: 'Koelen', auto: 'Automatisch' };
  if (s.domain === 'light' && s.state === 'on' && s.attrs.brightness) return `Aan · ${Math.round((s.attrs.brightness / 255) * 100)}%`;
  if (s.domain === 'binary_sensor') {
    const dc = s.device_class;
    if (['door', 'window', 'opening', 'garage_door'].includes(dc)) return s.state === 'on' ? 'Open' : 'Dicht';
    if (dc === 'motion' || dc === 'occupancy') return s.state === 'on' ? 'Beweging' : 'Rustig';
    if (dc === 'moisture') return s.state === 'on' ? 'Nat!' : 'Droog';
  }
  if (s.domain === 'climate') return `${s.attrs.current_temperature ?? '–'}° nu · ${map[s.state] || s.state}`;
  if (s.domain === 'cover' && s.attrs.current_position != null) return `${map[s.state] || s.state} · ${s.attrs.current_position}%`;
  if (s.domain === 'media_player' && s.attrs.media_title) return `${s.attrs.media_title}${s.attrs.media_artist ? ' – ' + s.attrs.media_artist : ''}`;
  if (s.domain === 'scene' || s.domain === 'script') return 'Tik om te starten';
  if (s.domain === 'weather') return `${s.state} · ${s.attrs.temperature ?? ''}°`;
  if (s.unit) {
    const n = Number(s.state);
    return `${Number.isFinite(n) ? Math.round(n * 10) / 10 : s.state} ${s.unit}`;
  }
  return map[s.state] || s.state;
}

function tile(s) {
  const on = ['on', 'open', 'unlocked', 'playing', 'home', 'heat', 'cool', 'cleaning'].includes(s.state);
  const busy = S.haBusy.has(s.entity_id);
  const base = `<span class="ico">${icon(DOMAIN_ICON[s.domain], 20)}</span><span><span class="name">${esc(s.name)}</span><br><span class="state">${esc(stateText(s))}</span></span>`;
  const id = esc(s.entity_id);
  if (s.domain === 'climate') {
    return `<div class="tile ${on ? 'on' : ''} ${busy ? 'busy' : ''}">${base.replace('</span></span>', ` · doel ${s.attrs.temperature ?? '–'}°</span></span>`)}
      <span class="ctrl"><button data-action="ha-temp" data-id="${id}" data-d="-1" aria-label="Kouder">−</button><button data-action="ha-temp" data-id="${id}" data-d="1" aria-label="Warmer">+</button></span></div>`;
  }
  if (s.domain === 'cover') {
    return `<div class="tile ${on ? 'on' : ''} ${busy ? 'busy' : ''}">${base}
      <span class="ctrl"><button data-action="ha" data-id="${id}" data-s="open_cover">Open</button><button data-action="ha" data-id="${id}" data-s="stop_cover">Stop</button><button data-action="ha" data-id="${id}" data-s="close_cover">Dicht</button></span></div>`;
  }
  if (s.domain === 'vacuum') {
    return `<div class="tile ${on ? 'on' : ''} ${busy ? 'busy' : ''}">${base}
      <span class="ctrl"><button data-action="ha" data-id="${id}" data-s="start">Start</button><button data-action="ha" data-id="${id}" data-s="return_to_base">Dock</button></span></div>`;
  }
  let action = '';
  if (TOGGLE.includes(s.domain)) action = 'data-action="ha" data-s="toggle"';
  else if (s.domain === 'scene' || s.domain === 'script') action = 'data-action="ha" data-s="turn_on"';
  else if (s.domain === 'lock') action = `data-action="ha" data-s="${s.state === 'locked' ? 'unlock' : 'lock'}" data-confirm="${s.state === 'locked' ? 'Slot openen?' : ''}"`;
  else if (s.domain === 'media_player') action = 'data-action="ha" data-s="media_play_pause"';
  const tag = action ? 'button' : 'div';
  return `<${tag} class="tile ${on ? 'on' : ''} ${busy ? 'busy' : ''}" ${action} data-id="${id}">${base}</${tag}>`;
}

function viewHouse() {
  const head = `<div class="header"><h1>Huis</h1>${S.ha.loaded && !S.ha.error ? `<button class="btn ghost" style="min-height:36px;padding:6px 14px" data-action="ha-edit">${S.haEdit ? 'Klaar' : 'Bewerk'}</button>` : ''}</div>`;
  if (!S.haStatus) {
    loadHa().then(softRender);
    return head + '<div class="card"><div class="empty">Verbinden met Home Assistant…</div></div>';
  }
  if (!S.haStatus.configured) {
    return head + `<div class="card pad">
      <p style="margin-top:0"><b>Home Assistant is nog niet gekoppeld.</b></p>
      <ol style="color:var(--muted);padding-left:20px;margin-bottom:0">
        <li>Open Home Assistant → je profiel (linksonder) → tabblad <i>Beveiliging</i>.</li>
        <li>Maak onderaan een <i>Token voor lange levensduur</i> aan.</li>
        <li>Zet <code>HA_URL</code> en <code>HA_TOKEN</code> in het <code>.env</code>-bestand van de server en herstart.</li>
      </ol></div>`;
  }
  if (S.ha.error) return head + `<div class="warn">Home Assistant reageert niet: ${esc(S.ha.error)}</div><button class="btn ghost block" data-action="ha-refresh">Opnieuw proberen</button>`;
  if (!S.ha.loaded) return head + '<div class="card"><div class="empty">Laden…</div></div>';

  if (S.haEdit) {
    const q = S.haSearch.toLowerCase();
    const list = S.ha.states.filter((s) => !q || s.name.toLowerCase().includes(q) || s.entity_id.includes(q));
    const byDomain = {};
    for (const s of list) (byDomain[s.domain] ||= []).push(s);
    return head + `
      <p class="hint">Kies wat er op het Huis-scherm staat. Dit geldt voor iedereen in huis. Scènes en scripts verschijnen ook op Vandaag.</p>
      <input class="input" type="search" placeholder="Zoek apparaat…" value="${esc(S.haSearch)}" data-input="ha-search" style="margin-bottom:8px">
      ${Object.keys(DOMAIN_LABEL).filter((d) => byDomain[d]).map((d) => `
        <div class="section-title">${DOMAIN_LABEL[d]}</div>
        <div class="card list">${byDomain[d].sort((a, b) => a.name.localeCompare(b.name)).map((s) => `
          <label class="row"><span class="grow"><span class="title">${esc(s.name)}</span><br><span class="meta">${esc(stateText(s))}</span></span>
          <span class="switch"><input type="checkbox" data-action="ha-fav" data-id="${esc(s.entity_id)}" ${S.ha.favorites.includes(s.entity_id) ? 'checked' : ''}><span></span></span></label>`).join('')}
        </div>`).join('') || '<div class="card"><div class="empty">Niets gevonden</div></div>'}`;
  }

  const favs = S.ha.favorites.map((id) => S.ha.states.find((s) => s.entity_id === id)).filter(Boolean);
  if (!favs.length) {
    return head + `<div class="card pad"><p style="margin:0 0 12px">Je hebt nog geen apparaten gekozen.</p><button class="btn block" data-action="ha-edit">Kies apparaten</button></div>`;
  }
  const groups = {};
  for (const s of favs) (groups[s.domain] ||= []).push(s);
  return head + Object.keys(DOMAIN_LABEL).filter((d) => groups[d]).map((d) => `
    <div class="section-title">${DOMAIN_LABEL[d]}</div>
    <div class="tiles">${groups[d].map(tile).join('')}</div>`).join('');
}

// ---------- Ik ----------
function viewMe() {
  const me = S.me;
  if (!viewMe.feed) api('/api/feed-url').then((r) => { viewMe.feed = r; softRender(); }).catch(() => {});
  const feed = viewMe.feed;
  return `
  <div class="header"><div><h1>${esc(me.name)}</h1><div class="sub">Jouw profiel en agenda's</div></div>${avatar(me)}</div>

  ${viewNotifications()}

  <div class="section-title">Mijn agenda's delen</div>
  <div class="card list">
    ${(me.calendars || []).map((c) => `
      <div class="row"><span class="grow"><span class="title">${esc(c.label)}</span><br>
        <span class="meta">${c.privacy === 'busy' ? 'Anderen zien alleen "bezet"' : 'Anderen zien alle details'}</span></span>
        <button class="link" data-action="cal-privacy" data-id="${c.id}">${c.privacy === 'busy' ? 'Toon details' : 'Alleen bezet'}</button>
        <button class="link" style="color:var(--danger);margin-left:10px" data-action="cal-remove" data-id="${c.id}">Verwijder</button>
      </div>`).join('') || '<div class="empty">Nog geen agenda gekoppeld</div>'}
  </div>
  <form class="card pad" style="margin-top:12px" data-form="calendar">
    <label class="field"><span>Agenda-link (https:// of webcal://)</span><input class="input" name="url" type="url" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="webcal://p01-caldav.icloud.com/…" required></label>
    <div class="two">
      <label class="field"><span>Naam</span><input class="input" name="label" placeholder="Werk, Privé…" maxlength="40"></label>
      <label class="field"><span>Wat zien anderen</span><select class="input" name="privacy"><option value="details">Alle details</option><option value="busy">Alleen bezet</option></select></label>
    </div>
    <button class="btn block">Koppel agenda</button>
  </form>
  <div class="card" style="margin-top:12px">
    <details class="help"><summary>Link vinden: iPhone / iCloud</summary><ol>
      <li>Open de Agenda-app en tik onderaan op <b>Agenda's</b>.</li>
      <li>Tik op het <b>ⓘ</b> naast de agenda die je wilt delen.</li>
      <li>Zet <b>Openbare agenda</b> aan en tik op <b>Deel link…</b> → <b>Kopieer</b>.</li>
      <li>Plak de link hierboven. De link is geheim: alleen wie hem heeft, kan meekijken.</li></ol></details>
    <details class="help" style="border-top:1px solid var(--line)"><summary>Link vinden: Google Agenda</summary><ol>
      <li>Ga op een computer naar calendar.google.com → ⚙️ <b>Instellingen</b>.</li>
      <li>Kies links je agenda en scroll naar <b>Agenda integreren</b>.</li>
      <li>Kopieer het <b>Geheime adres in iCal-indeling</b> en plak het hierboven.</li></ol></details>
    <details class="help" style="border-top:1px solid var(--line)"><summary>Link vinden: Outlook / Microsoft 365</summary><ol>
      <li>Open Outlook op het web → ⚙️ <b>Instellingen</b> → <b>Agenda</b> → <b>Gedeelde agenda's</b>.</li>
      <li>Onder <b>Een agenda publiceren</b>: kies je agenda en <i>Kan alle details zien</i> (of alleen beschikbaarheid) → <b>Publiceren</b>.</li>
      <li>Kopieer de <b>ICS</b>-link en plak hem hierboven. Werkagenda's kunnen door je werkgever geblokkeerd zijn.</li></ol></details>
  </div>

  <div class="section-title">Gezinsagenda in je ${isAndroid() ? 'Google Agenda' : 'telefoonagenda'}</div>
  <div class="card pad">
    <p style="margin-top:0">Abonneer je op de afspraken en taken die in deze app worden gemaakt. Ze verschijnen dan ook in je gewone agenda-app.</p>
    ${!feed ? '<div class="empty">Laden…</div>' : feed.ingress ? `
    <p class="hint" style="margin:0">Je agenda-app kan niet via Home Assistant meekijken. Gebruik het losse adres van Huis (poort 8765 van je Home Assistant, of je https-adres) en zet daar dit achter:</p>
    <div class="code">${esc(feed.path)}</div>
    <p class="hint" style="margin:10px 0 0">Bijvoorbeeld <code>http://homeassistant.local:8765${esc(feed.path)}</code>. Dat werkt alleen thuis; voor onderweg heb je https nodig (zie de documentatie).</p>` : isAndroid() ? `
    <a class="btn block" href="https://calendar.google.com/calendar/render?cid=${encodeURIComponent(feed.webcal)}" target="_blank" rel="noopener" style="text-decoration:none">Toevoegen aan Google Agenda</a>
    <p class="hint">Werkt de knop niet? Ga op calendar.google.com naar <b>Andere agenda's → + → Via URL</b> en plak het adres hieronder. Google moet de app via internet kunnen bereiken (lukt niet als je alleen Tailscale gebruikt) en ververst de agenda een paar keer per dag.</p>
    <div class="code">${esc(feed.https)}</div>` : `
    <a class="btn block" href="${esc(feed.webcal)}" style="text-decoration:none">Abonneer in Agenda</a>
    <p class="hint">Werkt de knop niet? iPhone: Agenda-app → Agenda's → Voeg agenda toe → Voeg agenda-abonnement toe. Andere apps: zoek naar "agenda toevoegen via URL" en plak:</p>
    <div class="code">${esc(feed.https)}</div>`}
  </div>

  <div class="section-title">Profiel</div>
  <form class="card pad" data-form="profile">
    <label class="field"><span>Naam</span><input class="input" name="name" value="${esc(me.name)}" maxlength="40" required></label>
    <div class="field"><span>Kleur</span>${colorPicker(me.color)}</div>
    <button class="btn ghost block">Bewaar profiel</button>
  </form>

  <div class="section-title">Huisgenoten</div>
  <div class="card list">${S.members.map((m) => `
    <div class="row">${avatar(m)}<span class="grow"><span class="title">${esc(m.name)}${m.id === me.id ? ' (jij)' : ''}</span><br>
    <span class="meta">${m.calendars.length ? `${m.calendars.length} agenda${m.calendars.length > 1 ? "'s" : ''} gedeeld` : 'nog geen agenda gedeeld'}</span></span></div>`).join('')}
  </div>
  <p class="hint">Nieuwe huisgenoot? Stuur het adres van deze app en de pincode; bij de eerste keer openen maken ze zelf hun profiel.</p>

  <div class="section-title">App op je ${isIOS() ? 'beginscherm' : 'startscherm'}</div>
  ${installHelp()}

  <div style="margin-top:24px;display:grid;gap:8px">
    <button class="btn ghost block" data-action="switch-member">Wissel van persoon</button>
    ${S.ingress ? '' : '<button class="btn ghost block" data-action="logout">Uitloggen</button>'}
    <button class="btn danger block" data-action="delete-me">Verwijder mijn profiel</button>
  </div>`;
}

// ---------- Meldingen ----------
const isStandalone = () => window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = () => /Android/i.test(navigator.userAgent);

// Chrome op Android (en desktop) biedt een eigen installatieknop aan.
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  softRender();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  toast('Huis is geïnstalleerd');
  softRender();
});

function installHelp() {
  if (S.ingress) {
    return `<div class="card pad"><p style="margin:0">Je gebruikt Huis via Home Assistant. Dat werkt ook in de Home Assistant-app op je telefoon: tik in het menu op <b>Huis</b>.</p>
      <p class="hint" style="margin:10px 0 0">Liever een losse app met eigen icoon en webmeldingen? Zie "Huis als losse app" in de documentatie van de add-on.</p></div>`;
  }
  if (isStandalone()) return '<div class="card pad"><p style="margin:0">✓ Huis is geïnstalleerd op dit toestel.</p></div>';
  if (installPrompt) {
    return `<div class="card pad"><p style="margin:0 0 12px">Zet Huis als app op je startscherm, met een eigen icoon en zonder adresbalk.</p>
      <button class="btn block" data-action="install">Installeer Huis</button></div>`;
  }
  const steps = isIOS()
    ? ['Open deze pagina in <b>Safari</b>.', 'Tik op de deelknop <b>⬆︎</b> onderin.', 'Kies <b>Zet op beginscherm</b>. Nu opent Huis als een echte app.']
    : isAndroid()
      ? ['Open deze pagina in <b>Chrome</b>.', 'Tik rechtsboven op het menu <b>⋮</b>.', 'Kies <b>App installeren</b> (of <b>Toevoegen aan startscherm</b>) en bevestig.']
      : ['Open deze pagina in <b>Chrome</b> of <b>Edge</b>.', 'Klik op het installatie-icoon rechts in de adresbalk.', 'Kies <b>Installeren</b>.'];
  return `<div class="card pad"><ol style="margin:0;padding-left:20px;color:var(--muted)">${steps.map((x) => `<li>${x}</li>`).join('')}</ol></div>`;
}

const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function loadPush() {
  [S.push, S.haInfo] = await Promise.all([api('/api/push'), api('/api/push/ha-info')]);
  S.pushEndpoint = null;
  // Niet wachten op serviceWorker.ready: binnen Home Assistant is er bewust geen service worker.
  const reg = !S.ingress && pushSupported() ? await navigator.serviceWorker.getRegistration() : null;
  if (reg) {
    const sub = await reg.pushManager.getSubscription();
    S.pushEndpoint = sub && S.push.devices.some((d) => d.endpoint === sub.endpoint) ? sub.endpoint : null;
  }
}

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function prefRow(key, title, desc) {
  return `<label class="row"><span class="grow"><span class="title">${title}</span><br><span class="meta">${desc}</span></span>
    <span class="switch"><input type="checkbox" data-action="push-pref" data-key="${key}" ${S.push.prefs[key] ? 'checked' : ''}><span></span></span></label>`;
}

function viewNotifications() {
  if (!S.push) {
    loadPush().then(softRender).catch(() => {});
    return '<div class="section-title">Meldingen</div><div class="card"><div class="empty">Laden…</div></div>';
  }
  let status;
  if (S.ingress) {
    status = `<p style="margin:0">Binnen Home Assistant komen meldingen via de <b>Home Assistant-app</b> op je telefoon. Kies hieronder je telefoon.</p>`;
  } else if (!window.isSecureContext) {
    status = `<p style="margin:0">Meldingen werken alleen via een beveiligde verbinding (<b>https://</b>). Zie het stappenplan in INSTALLEREN.md.</p>`;
  } else if (isIOS() && !isStandalone()) {
    status = `<p style="margin:0 0 8px">Op de iPhone werken meldingen alleen als Huis <b>op je beginscherm</b> staat (iOS 16.4 of nieuwer).</p>
      <ol style="margin:0;padding-left:20px;color:var(--muted)"><li>Tik in Safari op de deelknop <b>⬆︎</b>.</li><li>Kies <b>Zet op beginscherm</b>.</li><li>Open Huis via het nieuwe icoon en kom hier terug.</li></ol>`;
  } else if (!pushSupported()) {
    status = `<p style="margin:0">Deze browser ondersteunt geen pushmeldingen. ${isIOS() ? 'Update je iPhone naar iOS 16.4 of nieuwer.' : 'Gebruik een actuele versie van <b>Chrome</b>.'}</p>`;
  } else if (Notification.permission === 'denied') {
    const how = isIOS()
      ? '<b>Instellingen → Meldingen → Huis</b> op je iPhone'
      : isAndroid()
        ? (isStandalone() ? 'houd het Huis-icoon ingedrukt → <b>App-info → Meldingen</b>' : 'het slotje links in de adresbalk → <b>Machtigingen → Meldingen</b>')
        : 'het slotje links in de adresbalk → <b>Meldingen</b>';
    status = `<p style="margin:0">Meldingen zijn geblokkeerd. Zet ze aan via ${how} en kom terug.</p>`;
  } else if (!S.pushEndpoint) {
    status = `<p style="margin:0 0 12px">Krijg een seintje bij nieuwe taken, afspraken en je ochtendoverzicht.</p>
      <button class="btn block" data-action="push-on">Zet meldingen aan</button>
      ${isAndroid() && !isStandalone() ? '<p class="hint" style="margin:10px 0 0">Tip: installeer Huis eerst als app (onderaan deze pagina). Dan komen meldingen binnen onder de naam Huis.</p>' : ''}`;
  } else {
    status = `<div style="display:flex;gap:8px"><button class="btn ghost" style="flex:1" data-action="push-test">Stuur testmelding</button>
      <button class="btn ghost" style="flex:1" data-action="push-off">Zet uit</button></div>`;
  }
  const on = Boolean(S.push.active);
  const appName = (svc) => svc.replace(/^mobile_app_/, '').replace(/_/g, ' ');
  const haApp = S.push.haApps.length ? `
  <div class="card pad" style="margin-top:12px">
    <label class="field" style="margin:0"><span>Meldingen via de Home Assistant-app</span>
      <select class="input" data-action="push-ha-app">
        <option value="">Niet via de Home Assistant-app</option>
        ${S.push.haApps.map((a) => `<option value="${esc(a)}" ${S.push.haNotify === a ? 'selected' : ''}>${esc(appName(a))}</option>`).join('')}
      </select></label>
    ${S.ingress && on ? '<button class="btn ghost block" style="margin-top:12px" data-action="push-test">Stuur testmelding</button>' : ''}
  </div>` : S.ingress ? `<div class="card pad" style="margin-top:12px"><p class="hint" style="margin:0">Nog geen telefoon gevonden. Installeer de <b>Home Assistant-app</b> op je telefoon en log in; daarna verschijnt hij hier.</p></div>` : '';
  return `
  <div class="section-title">Meldingen ${on ? '<span class="badge" style="background:var(--ok);color:#fff">Aan</span>' : ''}</div>
  <div class="card pad">${status}</div>
  ${haApp}
  ${on ? `<div class="card list" style="margin-top:12px">
    ${prefRow('taskAssigned', 'Nieuwe taak voor mij', 'Als iemand je een taak geeft')}
    ${prefRow('eventAdded', 'Nieuwe gezinsafspraak', 'Als er een afspraak voor jou of iedereen bijkomt')}
    ${prefRow('eventReminder', 'Herinnering', '30 minuten voor een gezinsafspraak')}
    ${prefRow('dailySummary', 'Ochtendoverzicht', 'Je afspraken en taken van vandaag')}
    ${S.push.prefs.dailySummary ? `<label class="row"><span class="grow">Tijdstip overzicht</span>
      <input class="input" type="time" style="width:auto;min-height:40px;padding:6px 10px" data-action="push-time" value="${esc(S.push.prefs.summaryTime)}"></label>` : ''}
    ${prefRow('shopping', 'Boodschappen', 'Als iemand iets op de lijst zet')}
    ${prefRow('ha', 'Home Assistant', 'Meldingen uit je automatiseringen, zoals "de was is klaar"')}
  </div>
  <div class="card" style="margin-top:12px"><details class="help"><summary>Meldingen sturen vanuit Home Assistant</summary>
    ${S.haInfo ? `<p class="hint" style="margin:0 0 8px">Zet dit in <code>configuration.yaml</code> en herstart Home Assistant:</p>
    <div class="code" style="white-space:pre">rest_command:
  huis_melding:
    url: "${esc(S.haInfo.url)}"
    method: POST
    headers:
      Authorization: "Bearer ${esc(S.haInfo.token)}"
    content_type: "application/json"
    payload: >
      {"title": "{{ title }}", "message": "{{ message }}", "to": "{{ to | default('all') }}"}</div>
    <p class="hint" style="margin:10px 0 8px">Gebruik het daarna als actie in een automatisering:</p>
    <div class="code" style="white-space:pre;margin-bottom:14px">action: rest_command.huis_melding
data:
  title: Wasmachine
  message: De was is klaar!
  to: all   # of bijv. "${esc(S.me.name)}"</div>
    <p class="hint" style="margin:0 0 14px">${S.haInfo.addon ? 'Dit adres werkt binnen Home Assistant, je hoeft niets aan te passen.' : 'Draait Home Assistant op een ander apparaat? Vervang het adres dan door het lokale adres van de Huis-server, bijvoorbeeld <code>http://192.168.1.20:8080/api/notify</code>.'} Houd het token geheim.</p>` : '<p class="hint">Laden…</p>'}
  </details></div>` : ''}`;
}

// ================= Acties =================
const actions = {
  'close-sheet': () => closeSheet(),
  'pick-color'(el) {
    const form = el.closest('form');
    form.querySelector('[name=color]').value = el.dataset.color;
    form.querySelectorAll('[data-action=pick-color]').forEach((b) => b.setAttribute('aria-pressed', b === el));
  },
  async 'select-member'(el) {
    await api('/api/me/select', { method: 'POST', body: { memberId: el.dataset.id } });
    await start();
  },
  'goto-shopping'() {
    S.taskTab = 'boodschappen';
    location.hash = '#/taken';
  },
  // Agenda
  week(el) {
    const d = Number(el.dataset.dir);
    S.week = d === 0 ? mondayOf(todayKey()) : addDays(S.week, d * 7);
    render();
  },
  'cal-filter'(el) {
    S.calFilter = el.dataset.id;
    render();
  },
  'new-event'(el) {
    eventSheet(null, el.dataset.day);
  },
  'open-event'(el) {
    const all = Object.values(S.cal).flatMap((r) => r.events);
    const e = all.find((x) => x.id === el.dataset.id);
    if (!e) return;
    if (e.source === 'huis') eventSheet(e);
    else eventDetails(e);
  },
  async 'delete-event'(el) {
    if (!confirm('Afspraak verwijderen?')) return;
    await api(`/api/events/${el.dataset.id}`, { method: 'DELETE' });
    closeSheet();
    S.cal = {};
    render();
  },
  // Taken
  'task-tab'(el) {
    S.taskTab = el.dataset.tab;
    render();
  },
  'task-filter'(el) {
    S.taskFilter = el.dataset.f;
    render();
  },
  'new-task'() {
    taskSheet(null);
  },
  'edit-task'(el) {
    taskSheet(S.tasks.find((x) => x.id === el.dataset.id));
  },
  async 'toggle-task'(el) {
    const x = S.tasks.find((t) => t.id === el.dataset.id);
    x.done = !x.done;
    render();
    await api(`/api/tasks/${x.id}`, { method: 'PATCH', body: { done: x.done } });
    if (x.done) toast(x.repeat !== 'none' ? 'Klaar! De volgende staat al klaar.' : 'Klaar!');
    await loadTasks();
    softRender();
  },
  async 'delete-task'(el) {
    await api(`/api/tasks/${el.dataset.id}`, { method: 'DELETE' });
    closeSheet();
    await loadTasks();
    render();
  },
  async 'clear-tasks'() {
    await api('/api/tasks/clear-done', { method: 'POST' });
    await loadTasks();
    render();
  },
  async 'toggle-shop'(el) {
    const x = S.shopping.find((t) => t.id === el.dataset.id);
    x.done = !x.done;
    render();
    await api(`/api/shopping/${x.id}`, { method: 'PATCH', body: { done: x.done } });
  },
  async 'clear-shop'() {
    await api('/api/shopping/clear-done', { method: 'POST' });
    await loadShopping();
    render();
  },
  // Home Assistant
  async ha(el) {
    if (el.dataset.confirm && !confirm(el.dataset.confirm)) return;
    const id = el.dataset.id;
    const s = S.ha.states.find((x) => x.entity_id === id);
    // Direct laten zien, de echte status volgt.
    if (el.dataset.s === 'toggle') s.state = s.state === 'on' ? 'off' : 'on';
    S.haBusy.add(id);
    render();
    try {
      await api('/api/ha/service', { method: 'POST', body: { domain: s.domain, service: el.dataset.s, entity_id: id } });
      if (['scene', 'script'].includes(s.domain)) toast(`${s.name} gestart`);
    } finally {
      S.haBusy.delete(id);
      setTimeout(() => loadHa().then(softRender), 700);
    }
  },
  async 'ha-temp'(el) {
    const s = S.ha.states.find((x) => x.entity_id === el.dataset.id);
    const step = s.attrs.target_temp_step || 0.5;
    const next = Math.round(((s.attrs.temperature ?? 20) + Number(el.dataset.d) * step) * 10) / 10;
    s.attrs.temperature = Math.min(s.attrs.max_temp ?? 30, Math.max(s.attrs.min_temp ?? 5, next));
    render();
    clearTimeout(actions['ha-temp'].t);
    actions['ha-temp'].t = setTimeout(async () => {
      await api('/api/ha/service', { method: 'POST', body: { domain: 'climate', service: 'set_temperature', entity_id: s.entity_id, data: { temperature: s.attrs.temperature } } });
      loadHa().then(softRender);
    }, 600);
  },
  'ha-edit'() {
    S.haEdit = !S.haEdit;
    S.haSearch = '';
    render();
  },
  async 'ha-fav'(el) {
    const id = el.dataset.id;
    const favs = new Set(S.ha.favorites);
    if (el.checked) favs.add(id); else favs.delete(id);
    S.ha.favorites = [...favs];
    await api('/api/ha/favorites', { method: 'PUT', body: { favorites: S.ha.favorites } });
  },
  async 'ha-refresh'() {
    S.haStatus = null;
    await loadHa();
    render();
  },
  async install() {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    render();
  },
  // Meldingen
  async 'push-on'(el) {
    // Toestemming vragen moet direct in de tik gebeuren (iOS-eis), dus vóór elke await.
    const permission = Notification.requestPermission();
    el.disabled = true;
    el.textContent = 'Even geduld…';
    try {
      if ((await permission) !== 'granted') {
        toast('Geen toestemming gekregen voor meldingen');
        return render();
      }
      const reg = await navigator.serviceWorker.ready;
      const old = await reg.pushManager.getSubscription();
      const sub = old || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(S.push.publicKey) });
      await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
      await loadPush();
      render();
      await api('/api/push/test', { method: 'POST' }).catch(() => {});
      toast('Meldingen staan aan');
    } catch (e) {
      render();
      throw e;
    }
  },
  async 'push-off'() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
      await sub.unsubscribe().catch(() => {});
    }
    await loadPush();
    render();
    toast('Meldingen staan uit op dit toestel');
  },
  async 'push-ha-app'(el) {
    const r = await api('/api/push/ha-app', { method: 'PUT', body: { service: el.value } });
    await loadPush();
    render();
    if (r.haNotify) {
      await api('/api/push/test', { method: 'POST' }).catch(() => {});
      toast('Testmelding verstuurd via de Home Assistant-app');
    }
  },
  async 'push-test'() {
    await api('/api/push/test', { method: 'POST' });
    toast('Testmelding verstuurd');
  },
  async 'push-pref'(el) {
    S.push.prefs[el.dataset.key] = el.checked;
    const r = await api('/api/push/prefs', { method: 'PUT', body: { [el.dataset.key]: el.checked } });
    S.push.prefs = r.prefs;
    if (el.dataset.key === 'dailySummary') render();
  },
  async 'push-time'(el) {
    const r = await api('/api/push/prefs', { method: 'PUT', body: { summaryTime: el.value } });
    S.push.prefs = r.prefs;
    toast(`Ochtendoverzicht om ${r.prefs.summaryTime}`);
  },
  // Ik
  async 'cal-privacy'(el) {
    const c = S.me.calendars.find((x) => x.id === el.dataset.id);
    await api(`/api/members/me/calendars/${c.id}`, { method: 'PATCH', body: { privacy: c.privacy === 'busy' ? 'details' : 'busy' } });
    await loadMe();
    S.cal = {};
    render();
  },
  async 'cal-remove'(el) {
    if (!confirm('Deze agenda niet meer delen?')) return;
    await api(`/api/members/me/calendars/${el.dataset.id}`, { method: 'DELETE' });
    await loadMe();
    S.cal = {};
    render();
  },
  async 'switch-member'() {
    S.me = null;
    render();
  },
  async logout() {
    await api('/api/logout', { method: 'POST' });
    S.house = false;
    S.me = null;
    render();
  },
  async 'delete-me'() {
    if (!confirm('Je profiel en gekoppelde agenda\'s verwijderen? Taken en afspraken blijven bestaan.')) return;
    await api('/api/members/me', { method: 'DELETE' });
    await loadMe();
    render();
  },
};

const forms = {
  async login(f) {
    await api('/api/login', { method: 'POST', body: { pin: f.pin.value } });
    await start();
  },
  async 'new-member'(f) {
    await api('/api/members', { method: 'POST', body: { name: f.name.value, color: f.color.value } });
    await start();
    toast('Welkom! Koppel bij "Ik" je agenda.');
  },
  async event(f) {
    const allDay = f.allDay.checked;
    const body = {
      title: f.title.value,
      allDay,
      start: allDay ? f.startDate.value : new Date(`${f.startDate.value}T${f.startTime.value || '00:00'}`).toISOString(),
      end: allDay ? f.endDate.value || f.startDate.value : new Date(`${f.endDate.value || f.startDate.value}T${f.endTime.value || f.startTime.value || '00:00'}`).toISOString(),
      memberIds: [...f.querySelectorAll('[name=memberIds]:checked')].map((i) => i.value),
      location: f.location.value,
      notes: f.notes.value,
    };
    const id = f.dataset.id;
    await api(id ? `/api/events/${id}` : '/api/events', { method: id ? 'PATCH' : 'POST', body });
    closeSheet();
    S.cal = {};
    render();
    toast('Afspraak bewaard');
  },
  async 'quick-task'(f) {
    await api('/api/tasks', { method: 'POST', body: { title: f.title.value } });
    f.reset();
    await loadTasks();
    render();
    $('[data-form=quick-task] input')?.focus();
  },
  async task(f) {
    const body = { title: f.title.value, assigneeId: f.assigneeId.value || null, due: f.due.value || null, repeat: f.repeat.value };
    const id = f.dataset.id;
    await api(id ? `/api/tasks/${id}` : '/api/tasks', { method: id ? 'PATCH' : 'POST', body });
    closeSheet();
    await loadTasks();
    render();
  },
  async shop(f) {
    const title = f.title.value;
    f.reset();
    await api('/api/shopping', { method: 'POST', body: { title } });
    await loadShopping();
    render();
    $('[data-form=shop] input')?.focus();
  },
  async calendar(f) {
    const btn = f.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Agenda controleren…';
    try {
      const r = await api('/api/members/me/calendars', { method: 'POST', body: { url: f.url.value, label: f.label.value, privacy: f.privacy.value } });
      toast(`Gekoppeld: ${r.label} (${r.events} afspraken)`);
      await loadMe();
      S.cal = {};
      render();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Koppel agenda';
    }
  },
  async profile(f) {
    await api('/api/members/me', { method: 'PATCH', body: { name: f.name.value, color: f.color.value } });
    await loadMe();
    render();
    toast('Profiel bewaard');
  },
};

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
  e.preventDefault();
  try {
    await actions[el.dataset.action]?.(el, e);
  } catch (err) {
    toast(err.message);
  }
});
document.addEventListener('change', async (e) => {
  const el = e.target;
  if (!['INPUT', 'SELECT'].includes(el.tagName) || !el.dataset.action) return;
  try {
    await actions[el.dataset.action]?.(el, e);
  } catch (err) {
    toast(err.message);
  }
});
document.addEventListener('input', (e) => {
  if (e.target.dataset.input === 'ha-search') {
    S.haSearch = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const inp = $('[data-input=ha-search]');
    inp.focus();
    inp.setSelectionRange(pos, pos);
  }
});
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-form]');
  if (!f) return;
  e.preventDefault();
  try {
    await forms[f.dataset.form]?.(f);
  } catch (err) {
    toast(err.message);
  }
});
window.addEventListener('hashchange', () => {
  closeSheet(true);
  S.haEdit = false;
  render();
  window.scrollTo(0, 0);
});

// ================= Live bijwerken =================
let stream;
function connectStream() {
  stream?.close();
  stream = new EventSource('api/stream');
  stream.onmessage = async (msg) => {
    const { what } = JSON.parse(msg.data);
    if (what === 'tasks') await loadTasks();
    if (what === 'shopping') await loadShopping();
    if (what === 'members') await loadMe();
    if (what === 'calendar') { S.cal = {}; await loadMe(); }
    if (what === 'ha') await loadHa();
    if (S.me) softRender();
  };
}

// Home Assistant-status elke 10 seconden verversen op Huis en Vandaag.
setInterval(() => {
  if (document.hidden || !S.me || !S.haStatus?.configured || S.haEdit) return;
  if (['huis', 'vandaag'].includes(route())) loadHa().then(softRender);
}, 10000);

// Terug in de app (iOS pauzeert alles op de achtergrond): alles verversen.
document.addEventListener('visibilitychange', async () => {
  if (document.hidden || !S.me) return;
  S.cal = {};
  connectStream();
  await loadAll().catch(() => {});
  softRender();
});

// ================= Start =================
async function start() {
  try {
    await loadMe();
    if (S.house && S.me) {
      await loadAll();
      connectStream();
    }
  } catch (e) {
    toast(e.message);
  }
  render();
}

// Geen service worker binnen Home Assistant (ingress): daar regelt HA het laden.
start().then(() => {
  if ('serviceWorker' in navigator && !S.ingress) navigator.serviceWorker.register('sw.js').catch(() => {});
});
