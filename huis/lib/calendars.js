// Gedeelde agenda's: elk lid koppelt een of meer agenda-links (ICS / webcal).
// De server haalt ze op, pakt herhalende afspraken uit en voegt alles samen.
import ical from 'node-ical';
import { db } from './store.js';

const CACHE_MS = 10 * 60e3;
const cache = new Map(); // url -> {at, data, error}

export function normalizeUrl(u) {
  return String(u || '').trim().replace(/^webcals?:\/\//i, 'https://');
}

async function fetchCalendar(rawUrl, { force = false } = {}) {
  const url = normalizeUrl(rawUrl);
  const hit = cache.get(url);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'HuisApp/1.0 (+calendar sync)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Agenda gaf ${res.status}`);
    const text = await res.text();
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Dit is geen agenda-link (geen ICS)');
    const entry = { at: Date.now(), data: ical.sync.parseICS(text), error: null };
    cache.set(url, entry);
    return entry;
  } catch (e) {
    // Bij een fout houden we de vorige versie aan als die er is.
    const entry = { at: Date.now(), data: hit?.data || null, error: e.message };
    cache.set(url, entry);
    return entry;
  }
}

export async function testCalendar(url) {
  const r = await fetchCalendar(url, { force: true });
  if (r.error) return { ok: false, error: r.error };
  const events = Object.values(r.data).filter((c) => c.type === 'VEVENT').length;
  const name = r.data.vcalendar?.['WR-CALNAME'] || null;
  return { ok: true, events, name };
}

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function inclusiveEnd(start, end) {
  if (!end || +end <= +start) return dateKey(start);
  const d = new Date(end);
  d.setDate(d.getDate() - 1);
  return dateKey(d);
}

function textOf(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return v.val ?? String(v);
}

function expand(data, from, to) {
  const out = [];
  for (const ev of Object.values(data)) {
    if (ev.type !== 'VEVENT' || !ev.start) continue;
    if (ev.status === 'CANCELLED') continue;
    // Overrides (RECURRENCE-ID) worden via het basis-event uitgepakt.
    if (ev.recurrenceid && !ev.rrule) continue;
    let instances;
    try {
      instances = ical.expandRecurringEvent(ev, { from, to, expandOngoing: true });
    } catch {
      continue;
    }
    for (const inst of instances) {
      const e = inst.event || ev;
      out.push({
        uid: `${ev.uid}-${+inst.start}`,
        title: textOf(inst.summary || e.summary) || '(zonder titel)',
        allDay: inst.isFullDay,
        start: inst.isFullDay ? dateKey(inst.start) : inst.start.toISOString(),
        // Hele dag: in ICS is het einde exclusief, in de app inclusief.
        end: inst.isFullDay ? inclusiveEnd(inst.start, inst.end) : (inst.end || inst.start).toISOString(),
        location: textOf(e.location),
        transparent: e.transparency === 'TRANSPARENT',
      });
    }
  }
  return out;
}

// Alle afspraken in een periode, voor iedereen in huis.
export async function eventsBetween(from, to) {
  const { members, events } = db();
  const result = [];
  const errors = [];

  await Promise.all(
    members.flatMap((m) =>
      (m.calendars || []).map(async (cal) => {
        const r = await fetchCalendar(cal.url);
        if (r.error) errors.push({ memberId: m.id, calendarId: cal.id, label: cal.label, error: r.error });
        if (!r.data) return;
        for (const ev of expand(r.data, from, to)) {
          const busy = cal.privacy === 'busy';
          result.push({
            id: `ics-${cal.id}-${ev.uid}`,
            source: 'agenda',
            calendarLabel: cal.label,
            memberIds: [m.id],
            title: busy ? 'Bezet' : ev.title,
            location: busy ? '' : ev.location,
            start: ev.start,
            end: ev.end,
            allDay: ev.allDay,
            busyOnly: busy,
          });
        }
      })
    )
  );

  // Afspraken die in de app zelf zijn gemaakt (gezinsagenda)
  const fromKey = dateKey(from);
  const toKey = dateKey(to);
  for (const ev of events) {
    const s = ev.start;
    const e = ev.end || ev.start;
    const inRange = ev.allDay
      ? s <= toKey && e >= fromKey
      : new Date(s) <= to && new Date(e) >= from;
    if (inRange) result.push({ ...ev, source: 'huis' });
  }

  result.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  return { events: result, errors };
}

function sortKey(e) {
  // Hele-dag-afspraken bovenaan de dag
  if (e.allDay) return e.start + 'T00:00:00.000Z!';
  return e.start;
}

// ---- Export: de gezinsagenda als abonneerbare ICS-feed (webcal) ----

function icsEscape(s = '') {
  return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}
const icsDate = (key) => key.replace(/-/g, '');
const icsDateTime = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function addDays(key, n) {
  const d = new Date(key + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

function fold(line) {
  // ICS-regels mogen max 75 bytes zijn; vouw op tekengrenzen (UTF-8).
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > 74) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}

export function buildFeed(host) {
  const { events, tasks, members } = db();
  const name = (id) => members.find((m) => m.id === id)?.name;
  const now = icsDateTime(new Date().toISOString());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//HuisApp//NL',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Huis',
    'X-PUBLISHED-TTL:PT15M',
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
  ];
  for (const ev of events) {
    const who = (ev.memberIds || []).map(name).filter(Boolean).join(', ');
    lines.push('BEGIN:VEVENT', `UID:${ev.id}@${host}`, `DTSTAMP:${now}`);
    if (ev.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(ev.start)}`, `DTEND;VALUE=DATE:${icsDate(addDays(ev.end || ev.start, 1))}`);
    } else {
      lines.push(`DTSTART:${icsDateTime(ev.start)}`, `DTEND:${icsDateTime(ev.end || ev.start)}`);
    }
    lines.push(`SUMMARY:${icsEscape(ev.title)}`);
    if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`);
    const desc = [who && `Voor: ${who}`, ev.notes].filter(Boolean).join('\n');
    if (desc) lines.push(`DESCRIPTION:${icsEscape(desc)}`);
    lines.push('END:VEVENT');
  }
  for (const t of tasks) {
    if (!t.due || t.done) continue;
    const who = name(t.assigneeId);
    lines.push(
      'BEGIN:VEVENT',
      `UID:taak-${t.id}@${host}`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${icsDate(t.due)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(t.due, 1))}`,
      `SUMMARY:${icsEscape('✓ ' + t.title + (who ? ` (${who})` : ''))}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
