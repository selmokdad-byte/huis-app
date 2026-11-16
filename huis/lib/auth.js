// Inloggen met een gedeelde huis-pincode, daarna kies je wie je bent.
// De sessie staat in een ondertekende cookie (HMAC), geen database nodig.
import crypto from 'node:crypto';
import { db, save } from './store.js';
import { ingressUser } from './addon.js';

const COOKIE = 'huis_sessie';
const MAX_AGE_DAYS = 180;

function sign(value) {
  return crypto.createHmac('sha256', db().secret).update(value).digest('base64url');
}

export function makeCookie(session) {
  const payload = Buffer.from(JSON.stringify({ ...session, iat: Date.now() })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))])
  );
}

export function readSession(req) {
  const cookie = readCookieSession(req);
  // Via de zijbalk van Home Assistant: al ingelogd, en we herkennen de HA-gebruiker.
  const ha = ingressUser(req);
  if (ha) {
    const linked = ha.id && db().members.find((m) => m.haUserId === ha.id);
    return { house: true, ingress: true, haUserId: ha.id, haName: ha.name, memberId: linked?.id || cookie?.memberId || null };
  }
  return cookie;
}

function readCookieSession(req) {
  const raw = parseCookies(req.headers.cookie)[COOKIE];
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (Date.now() - s.iat > MAX_AGE_DAYS * 864e5) return null;
    return s;
  } catch {
    return null;
  }
}

export function setSession(req, res, session) {
  // Koppel de Home Assistant-gebruiker aan het gekozen lid, zodat je de volgende keer meteen jezelf bent.
  const ha = ingressUser(req);
  if (ha?.id) {
    for (const m of db().members) {
      if (m.haUserId === ha.id) delete m.haUserId;
    }
    const m = db().members.find((x) => x.id === session.memberId);
    if (m) m.haUserId = ha.id;
    save();
  }
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie(COOKIE, makeCookie(session), {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: MAX_AGE_DAYS * 864e5,
    path: '/',
  });
}

export function clearSession(req, res) {
  const ha = ingressUser(req);
  if (ha?.id) {
    for (const m of db().members) {
      if (m.haUserId === ha.id) delete m.haUserId;
    }
    save();
  }
  res.clearCookie(COOKIE, { path: '/' });
}

// Simpele rem op pincode raden: max 10 pogingen per 15 minuten per IP.
const attempts = new Map();
export function pinAllowed(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60e3);
  attempts.set(ip, list);
  return list.length < 10;
}
export function recordFailedPin(ip) {
  attempts.set(ip, [...(attempts.get(ip) || []), Date.now()]);
}

export function checkPin(pin) {
  const expected = String(process.env.HUIS_PIN || '');
  if (!expected) return false;
  const a = Buffer.from(String(pin));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Middleware: ingelogd met pincode (lid hoeft nog niet gekozen te zijn).
export function requireHouse(req, res, next) {
  const s = readSession(req);
  if (!s?.house) return res.status(401).json({ error: 'Niet ingelogd' });
  req.session = s;
  next();
}

// Middleware: ingelogd én als lid gekozen.
export function requireMember(req, res, next) {
  const s = readSession(req);
  if (!s?.house) return res.status(401).json({ error: 'Niet ingelogd' });
  const member = db().members.find((m) => m.id === s.memberId);
  if (!member) return res.status(403).json({ error: 'Kies eerst wie je bent' });
  req.session = s;
  req.member = member;
  next();
}
