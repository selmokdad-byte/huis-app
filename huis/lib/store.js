// Eenvoudige JSON-opslag. Eén bestand, atomisch weggeschreven.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const FILE = path.join(DATA_DIR, 'huis.json');

const empty = () => ({
  members: [],      // {id, name, color, calendars: [{id, label, url, privacy}]}
  tasks: [],        // {id, title, assigneeId, due, done, doneAt, repeat, createdBy, createdAt}
  shopping: [],     // {id, title, done, createdBy, createdAt}
  events: [],       // {id, title, start, end, allDay, memberIds, location, notes, createdBy}
  haFavorites: [],  // entity_ids die op het Huis-scherm staan
  secret: null,     // voor sessie-cookies
  feedToken: null,  // voor de abonneerbare agenda-feed
  vapid: null,      // sleutels voor pushmeldingen
  notifyToken: null,// voor meldingen vanuit Home Assistant
  sentReminders: {},
});

let state;

export function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(FILE)) {
    state = { ...empty(), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } else {
    state = empty();
  }
  if (!state.secret) state.secret = crypto.randomBytes(32).toString('hex');
  for (const m of state.members) m.push ||= [];
  if (!state.feedToken) state.feedToken = crypto.randomBytes(18).toString('base64url');
  save();
  return state;
}

export function save() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

export function db() {
  return state;
}

export const newId = () => crypto.randomBytes(8).toString('hex');
