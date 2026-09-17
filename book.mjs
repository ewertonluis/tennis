#!/usr/bin/env node
// Auto-booking for Mouratoglou Country Club (Doinsport) group sessions.
//
// Usage:
//   node book.mjs                  scheduled mode: book target sessions whose registration opens soon
//   node book.mjs --date 2026-09-21  book the target session on that date right now
//   node book.mjs --list           list upcoming target sessions (no login needed)
//   add --dry-run to do everything except the actual registration

import {
  DAY_MS, bookedInWeek, config, findTargetSessions, http, isoDate, log, login, myParticipation, paris,
  registrationOpensAt, sleep,
} from './doinsport.mjs';

const env = process.env;
// Scheduled mode only handles sessions whose registration opens within this window.
const LOOKAHEAD_MIN = Number(env.LOOKAHEAD_MINUTES || 90);
// How long to keep retrying after the expected opening time.
const RETRY_FOR_SEC = Number(env.RETRY_FOR_SECONDS || 180);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run') || env.DRY_RUN === 'true';
const LIST = args.includes('--list');
const DATE = args.includes('--date') ? args[args.indexOf('--date') + 1] : env.BOOK_DATE || '';

// Outcome lines the dashboard reads back from the run's annotations.
function outcome(level, message) {
  log(message);
  if (env.GITHUB_ACTIONS) console.log(`::${level} title=Outcome::${message}`);
}

async function register(booking, me, label) {
  if (DRY_RUN) {
    outcome('notice', `Dry run: would register for ${label}`);
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
  outcome('notice', participant.inQueue ? `Waiting list: ${label}` : `Booked: ${label}`);
}

async function bookWithRetry(booking, me, label, opensAt) {
  const deadline = opensAt.getTime() + RETRY_FOR_SEC * 1000;
  for (let attempt = 1; ; attempt++) {
    try {
      await register(booking, me, label);
      return;
    } catch (e) {
      if (e.status === 401) { me = await login(); continue; }
      if (Date.now() > deadline) throw new Error(`${label}: ${e.message}`);
      log(`Attempt ${attempt} failed (${e.message}), retrying`);
      await sleep(1000);
    }
  }
}

async function handle(booking, me, { waitForOpening }) {
  const p = paris(new Date(booking.startAt));
  const label = `${booking.name} ${p.day} ${p.date} ${p.time}`;
  const existing = await myParticipation(booking, me);
  if (existing) {
    outcome('notice', `Already ${existing.canceled ? 'cancelled by you, skipped' : 'registered'}: ${label}`);
    return;
  }
  const booked = await bookedInWeek(new Date(booking.startAt), me);
  if (booked >= config.maxPerWeek) {
    outcome('notice', `Skipped, you already have ${booked} sessions that week: ${label}`);
    return;
  }
  const opensAt = registrationOpensAt(await http('GET', `/clubs/bookings/${booking.id}`));
  if (waitForOpening && opensAt > Date.now()) {
    log(`${label}: registration opens ${opensAt.toISOString()}, waiting`);
    await sleep(opensAt - Date.now() - 60_000);
    me = await login(); // fresh token right before opening
    await sleep(opensAt - Date.now() + 200);
  }
  log(`${label}: registering`);
  await bookWithRetry(booking, me, label, waitForOpening ? opensAt : new Date());
}

async function main() {
  const today = isoDate(Date.now());

  if (LIST) {
    for (const b of await findTargetSessions(today, isoDate(Date.now() + 21 * DAY_MS))) {
      const p = paris(new Date(b.startAt));
      log(`${p.day} ${p.date} ${p.time}  ${b.name}  (id ${b.id}, max ${b.maxParticipantsCountLimit})`);
    }
    return;
  }

  const me = await login();

  if (DATE) {
    const [booking] = await findTargetSessions(DATE, isoDate(new Date(DATE).getTime() + DAY_MS));
    if (!booking) throw new Error(`No ${config.name} session found on ${DATE}`);
    await handle(booking, me, { waitForOpening: false });
    return;
  }

  // Scheduled mode: sessions whose registration opens between now-RETRY and now+LOOKAHEAD.
  const sessions = await findTargetSessions(today, isoDate(Date.now() + 15 * DAY_MS));
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
  if (env.GITHUB_ACTIONS) console.log(`::error title=Outcome::${e.message}`);
  process.exit(1);
});
