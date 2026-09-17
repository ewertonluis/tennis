#!/usr/bin/env node
// Auto-booking for Mouratoglou Country Club (Doinsport) group sessions.
//
// Usage:
//   node book.mjs                  scheduled mode: book target sessions whose registration opens soon
//   node book.mjs --date 2026-09-21  book the target session on that date right now
//   node book.mjs --list           list upcoming target sessions (no login needed)
//   add --dry-run to do everything except the actual registration

const API = 'https://api-blockout.doinsport.club';
const CLUB_ID = '652b9a65-0756-4f08-9b30-e20130aeea42';
const WHITE_LABEL_ID = '472ed15e-b862-4ffd-b81e-1fa8a89b6148';
const TZ = 'Europe/Paris';

const env = process.env;
const EMAIL = env.DOIN_EMAIL;
const PASSWORD = env.DOIN_PASSWORD;
const TARGET_NAME = env.TARGET_NAME || 'Permanence adultes';
const TARGET_DAYS = (env.TARGET_DAYS || 'Mon,Wed').split(',').map((d) => d.trim());
const TARGET_TIME = env.TARGET_TIME || '19:30';
// Used only when the API does not expose the registration opening delay.
const OPEN_DAYS_BEFORE = Number(env.OPEN_DAYS_BEFORE || 7);
// Scheduled mode only handles sessions whose registration opens within this window.
const LOOKAHEAD_MIN = Number(env.LOOKAHEAD_MINUTES || 90);
// How long to keep retrying after the expected opening time.
const RETRY_FOR_SEC = Number(env.RETRY_FOR_SECONDS || 180);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run') || env.DRY_RUN === 'true';
const LIST = args.includes('--list');
const DATE = args.includes('--date') ? args[args.indexOf('--date') + 1] : env.BOOK_DATE || '';

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const log = (...a) => console.log(new Date().toISOString(), ...a);
const members = (d) => (Array.isArray(d) ? d : d?.['hydra:member'] ?? []);
const iri = (x) => (typeof x === 'string' ? x : x?.['@id']);

function paris(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  return { day: parts.weekday, date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

let token = null;

async function http(method, path, body) {
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

async function login() {
  if (!EMAIL || !PASSWORD) throw new Error('DOIN_EMAIL and DOIN_PASSWORD must be set');
  token = null;
  const data = await http('POST', '/client_login_check', {
    username: EMAIL,
    password: PASSWORD,
    clubWhiteLabel: `/clubs/white-labels/${WHITE_LABEL_ID}`,
    origin: 'white_label_app',
  });
  token = data.token;
  if (!token) throw new Error('Login succeeded but no token returned');
  const me = await http('GET', '/me');
  log(`Logged in as ${me.firstName ?? ''} ${me.lastName ?? ''} (${me['@id']})`);
  return me;
}

async function findTargetSessions(fromDate, toDate) {
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
    return b.name?.trim() === TARGET_NAME && !b.canceled && TARGET_DAYS.includes(p.day) && p.time === TARGET_TIME;
  });
}

function registrationOpensAt(booking) {
  const start = new Date(booking.startAt).getTime();
  const delay = booking.startRegistrationDelay || booking.registrationTimeBeforeStart;
  const ms = delay ? delay * 1000 : OPEN_DAYS_BEFORE * 24 * 3600 * 1000;
  return new Date(start - ms);
}

async function myParticipation(booking, me) {
  const data = await http('GET', `/clubs/bookings/participants?booking.id=${booking.id}&itemsPerPage=200`);
  return members(data).find((p) => iri(p.user) === me['@id']);
}

async function register(booking, me) {
  if (DRY_RUN) {
    log(`[dry-run] Would register for ${booking.name} ${booking.startAt}`);
    return;
  }
  const participant = await http('POST', '/clubs/bookings/participants', {
    booking: booking['@id'] ?? `/clubs/bookings/${booking.id}`,
    user: me['@id'],
    subscriptionCard: null,
    paymentMethod: 'per_participant',
    accompanyingParticipants: [],
  });
  const cart = await http('POST', '/payments/carts', { items: [{ product: participant['@id'] }] });
  if (cart.restToPay > 0) {
    throw new Error(`Registered but payment of ${cart.restToPay / 100} is required - finish it in the app`);
  }
  if (participant.confirmed === false) {
    const confirmed = await http('PUT', participant['@id'], { confirmed: true });
    if (confirmed.confirmed !== true) throw new Error('Confirmation was not accepted');
  }
  log(participant.inQueue ? 'Session full: added to the WAITING LIST' : 'Booked!');
}

async function bookWithRetry(booking, me, opensAt) {
  const deadline = opensAt.getTime() + RETRY_FOR_SEC * 1000;
  for (let attempt = 1; ; attempt++) {
    try {
      await register(booking, me);
      return;
    } catch (e) {
      if (e.status === 401) { await login(); continue; }
      if (Date.now() > deadline) throw e;
      log(`Attempt ${attempt} failed (${e.message}), retrying`);
      await sleep(1000);
    }
  }
}

async function handle(booking, me, { waitForOpening }) {
  const label = `${booking.name} on ${paris(new Date(booking.startAt)).date} ${TARGET_TIME}`;
  const existing = await myParticipation(booking, me);
  if (existing) {
    log(`${label}: already ${existing.canceled ? 'cancelled by you (skipping)' : 'registered'}`);
    return true;
  }
  const opensAt = registrationOpensAt(await http('GET', `/clubs/bookings/${booking.id}`));
  if (waitForOpening && opensAt > Date.now()) {
    log(`${label}: registration opens ${opensAt.toISOString()}, waiting`);
    await sleep(opensAt - Date.now() - 60_000);
    me = await login(); // fresh token right before opening
    await sleep(opensAt - Date.now() + 200);
  }
  log(`${label}: registering`);
  await bookWithRetry(booking, me, waitForOpening ? opensAt : new Date());
  return true;
}

async function main() {
  const day = 24 * 3600 * 1000;
  const today = new Date().toISOString().slice(0, 10);

  if (LIST) {
    const sessions = await findTargetSessions(today, new Date(Date.now() + 21 * day).toISOString().slice(0, 10));
    for (const b of sessions) {
      const p = paris(new Date(b.startAt));
      log(`${p.day} ${p.date} ${p.time}  ${b.name}  (id ${b.id}, max ${b.maxParticipantsCountLimit})`);
    }
    return;
  }

  let me = await login();

  if (DATE) {
    const next = new Date(new Date(DATE).getTime() + day).toISOString().slice(0, 10);
    const [booking] = await findTargetSessions(DATE, next);
    if (!booking) throw new Error(`No ${TARGET_NAME} session found on ${DATE}`);
    await handle(booking, me, { waitForOpening: false });
    return;
  }

  // Scheduled mode: sessions whose registration opens between now-RETRY and now+LOOKAHEAD.
  const sessions = await findTargetSessions(today, new Date(Date.now() + 15 * day).toISOString().slice(0, 10));
  const due = sessions.filter((b) => {
    const opensAt = registrationOpensAt(b).getTime();
    return opensAt <= Date.now() + LOOKAHEAD_MIN * 60_000 && opensAt >= Date.now() - RETRY_FOR_SEC * 1000;
  });
  if (!due.length) {
    log('No target session opens for registration in the next', LOOKAHEAD_MIN, 'minutes');
    return;
  }
  for (const b of due) await handle(b, me, { waitForOpening: true });
}

main().catch((e) => {
  console.error(new Date().toISOString(), 'FAILED:', e.message);
  process.exit(1);
});
