// Shared Doinsport API helpers for Mouratoglou Country Club.

export const API = 'https://api-blockout.doinsport.club';
export const CLUB_ID = '652b9a65-0756-4f08-9b30-e20130aeea42';
const WHITE_LABEL_ID = '472ed15e-b862-4ffd-b81e-1fa8a89b6148';
export const TZ = 'Europe/Paris';

const env = process.env;
export const config = {
  email: env.DOIN_EMAIL,
  password: env.DOIN_PASSWORD,
  name: env.TARGET_NAME || 'Permanence adultes',
  days: (env.TARGET_DAYS || 'Mon,Wed').split(',').map((d) => d.trim()),
  time: env.TARGET_TIME || '19:30',
  // Used only when the API does not expose the registration opening delay.
  openDaysBefore: Number(env.OPEN_DAYS_BEFORE || 8),
};

export const DAY_MS = 24 * 3600 * 1000;
export const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
export const log = (...a) => console.log(new Date().toISOString(), ...a);
export const members = (d) => (Array.isArray(d) ? d : d?.['hydra:member'] ?? []);
export const iri = (x) => (typeof x === 'string' ? x : x?.['@id']);
export const isoDate = (d) => new Date(d).toISOString().slice(0, 10);

export function paris(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  return { day: parts.weekday, date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

// Converts a Paris wall-clock date + time ("2026-09-21", "19:30") to a UTC Date.
export function parisToUtc(date, time) {
  const guess = new Date(`${date}T${time}:00Z`);
  const p = paris(guess);
  const offset = new Date(`${p.date}T${p.time}:00Z`) - guess;
  return new Date(guess.getTime() - offset);
}

let token = null;

export async function http(method, path, body) {
  const res = await fetch(path.startsWith('http') ? path : API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/ld+json',
      'X-Locale': 'fr',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    const msg = data?.['hydra:description'] || data?.detail || data?.message || text.slice(0, 300);
    const err = new Error(`${method} ${path} -> ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function login() {
  if (!config.email || !config.password) throw new Error('DOIN_EMAIL and DOIN_PASSWORD must be set');
  token = null;
  const data = await http('POST', '/client_login_check', {
    username: config.email,
    password: config.password,
    clubWhiteLabel: `/clubs/white-labels/${WHITE_LABEL_ID}`,
    origin: 'white_label_app',
  });
  token = data.token;
  if (!token) throw new Error('Login succeeded but no token returned');
  const me = await http('GET', '/me');
  log(`Logged in (${me['@id']})`);
  return me;
}

export async function findTargetSessions(fromDate, toDate) {
  const sessions = [];
  for (let page = 1; ; page++) {
    const q = `activityType=lesson&club.id=${CLUB_ID}&startAt[after]=${fromDate}&startAt[before]=${toDate}` +
      `&order[startAt]=asc&itemsPerPage=200&page=${page}`;
    const batch = members(await http('GET', `/clubs/bookings?${q}`));
    sessions.push(...batch);
    if (batch.length < 200) break;
  }
  return sessions.filter((b) => {
    const p = paris(new Date(b.startAt));
    return b.name?.trim() === config.name && !b.canceled && config.days.includes(p.day) && p.time === config.time;
  });
}

export function registrationOpensAt(booking) {
  const start = new Date(booking.startAt).getTime();
  const delay = booking.startRegistrationDelay || booking.registrationTimeBeforeStart;
  return new Date(start - (delay ? delay * 1000 : config.openDaysBefore * DAY_MS));
}

export async function participants(booking) {
  return members(await http('GET', `/clubs/bookings/participants?booking.id=${booking.id}&itemsPerPage=200`));
}

export async function myParticipation(booking, me) {
  return (await participants(booking)).find((p) => iri(p.user) === me['@id']);
}
