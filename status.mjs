#!/usr/bin/env node
// Builds the dashboard data: session statuses, next bot action and recent bot runs,
// encrypted with DASHBOARD_PASSPHRASE so it can be published on a public GitHub Pages site.
//
// Usage: node status.mjs <output-file>

import { webcrypto as crypto } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import {
  DAY_MS, config, findTargetSessions, http, iri, isoDate, log, login, paris, parisToUtc, participants,
  registrationOpensAt,
} from './doinsport.mjs';

const env = process.env;
const OUT = process.argv[2] || 'data.json';
const PAST_DAYS = 14;
const FUTURE_DAYS = 21;
// Must match the cron entries in .github/workflows/book.yml (UTC).
const BOT_CRONS_UTC = ['16:20', '17:20'];
const BOT_LOOKAHEAD_MIN = Number(env.LOOKAHEAD_MINUTES || 90);

function botWakeFor(opensAt) {
  const day = isoDate(opensAt);
  return BOT_CRONS_UTC
    .map((t) => new Date(`${day}T${t}:00Z`))
    .filter((w) => w <= opensAt && opensAt - w <= BOT_LOOKAHEAD_MIN * 60_000)
    .sort((a, b) => a - b)[0] ?? null;
}

function expectedSlots(from, to) {
  const slots = [];
  for (let t = from; t <= to; t += DAY_MS) {
    const date = isoDate(t);
    const start = parisToUtc(date, config.time);
    if (config.days.includes(paris(start).day)) slots.push(start);
  }
  return slots;
}

async function sessionStatus(booking, me, now) {
  const start = new Date(booking.startAt);
  let list = null;
  try { list = await participants(booking); } catch (e) { log(`participants unavailable: ${e.message}`); }
  const mine = list?.find((p) => iri(p.user) === me['@id']);
  const count = list?.filter((p) => !p.canceled && p.confirmed !== false && !p.inQueue).length ?? null;

  let status;
  if (start < now) status = mine && !mine.canceled && !mine.inQueue ? 'played' : 'skipped';
  else if (mine?.canceled) status = 'cancelled';
  else if (mine?.inQueue) status = 'waitlist';
  else if (mine) status = 'booked';
  else status = registrationOpensAt(booking) > now ? 'upcoming' : 'open';

  return {
    start: start.toISOString(),
    end: booking.endAt,
    opensAt: registrationOpensAt(booking).toISOString(),
    status,
    count,
    capacity: booking.maxParticipantsCountLimit ?? null,
    court: booking.playgrounds?.map((p) => p.name).join(', ') || null,
  };
}

async function recentRuns() {
  const repo = env.GITHUB_REPOSITORY;
  if (!repo || !env.GITHUB_TOKEN) return [];
  const gh = async (path) => {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`GitHub ${path} -> ${res.status}`);
    return res.json();
  };
  const { workflow_runs: runs } = await gh(`/repos/${repo}/actions/workflows/book.yml/runs?per_page=15`);
  return Promise.all(runs.map(async (r) => {
    let outcomes = [];
    try {
      const { jobs } = await gh(`/repos/${repo}/actions/runs/${r.id}/jobs`);
      for (const job of jobs) {
        const annotations = await gh(`/repos/${repo}/check-runs/${job.id}/annotations`);
        outcomes.push(...annotations
          .filter((a) => a.title === 'Outcome')
          .map((a) => ({ level: a.annotation_level, message: a.message })));
      }
    } catch (e) {
      log(`annotations unavailable for run ${r.id}: ${e.message}`);
    }
    return {
      url: r.html_url,
      startedAt: r.run_started_at || r.created_at,
      updatedAt: r.updated_at,
      trigger: r.event,
      status: r.status,
      conclusion: r.conclusion,
      outcomes,
    };
  }));
}

async function encrypt(json, passphrase) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iterations = 250_000;
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt'],
  );
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(json));
  const b64 = (buf) => Buffer.from(buf).toString('base64');
  return { v: 1, kdf: 'PBKDF2-SHA256', iterations, salt: b64(salt), iv: b64(iv), data: b64(ct) };
}

async function main() {
  if (!env.DASHBOARD_PASSPHRASE) throw new Error('DASHBOARD_PASSPHRASE must be set');
  const now = new Date();
  const me = await login();

  const from = now.getTime() - PAST_DAYS * DAY_MS;
  const to = now.getTime() + FUTURE_DAYS * DAY_MS;
  const published = await findTargetSessions(isoDate(from), isoDate(to + DAY_MS));
  const sessions = [];
  for (const b of published) sessions.push(await sessionStatus(b, me, now));

  // Slots the club hasn't created yet still get booked once they appear.
  for (const start of expectedSlots(now.getTime(), to)) {
    if (start < now || sessions.some((s) => s.start === start.toISOString())) continue;
    sessions.push({
      start: start.toISOString(),
      opensAt: new Date(start - config.openDaysBefore * DAY_MS).toISOString(),
      status: 'unpublished',
    });
  }
  sessions.sort((a, b) => a.start.localeCompare(b.start));

  const nextSession = sessions.find((s) => ['upcoming', 'unpublished'].includes(s.status) && new Date(s.opensAt) > now);
  const nextAction = nextSession && {
    sessionStart: nextSession.start,
    opensAt: nextSession.opensAt,
    botWakeAt: botWakeFor(new Date(nextSession.opensAt))?.toISOString() ?? null,
  };

  const data = {
    generatedAt: now.toISOString(),
    target: { name: config.name, days: config.days, time: config.time },
    sessions,
    nextAction,
    runs: await recentRuns(),
  };
  writeFileSync(OUT, JSON.stringify(await encrypt(JSON.stringify(data), env.DASHBOARD_PASSPHRASE)));
  log(`Wrote ${OUT}: ${sessions.length} sessions, ${data.runs.length} runs`);
}

main().catch((e) => {
  console.error(new Date().toISOString(), 'FAILED:', e.message);
  process.exit(1);
});
