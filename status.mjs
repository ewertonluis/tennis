#!/usr/bin/env node
// Writes recent booking-bot runs (with their outcome annotations) for the dashboard.
// Session data is fetched live by the dashboard itself.
//
// Usage: node status.mjs <output-file>

import { writeFileSync } from 'node:fs';
import { log } from './doinsport.mjs';

const env = process.env;
const OUT = process.argv[2] || 'runs.json';

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${path} -> ${res.status}`);
  return res.json();
}

// The runs.json currently on GitHub Pages, so runs already looked up are not fetched again
// (the bot checks every 15 minutes; most runs have nothing to report).
async function published(repo) {
  const [owner, name] = repo.split('/');
  try {
    const res = await fetch(`https://${owner.toLowerCase()}.github.io/${name}/runs.json`, { cache: 'no-store' });
    return res.ok ? await res.json() : {};
  } catch {
    return {};
  }
}

async function outcomesOf(repo, run) {
  const outcomes = [];
  const { jobs } = await gh(`/repos/${repo}/actions/runs/${run.id}/jobs`);
  for (const job of jobs) {
    const annotations = await gh(`/repos/${repo}/check-runs/${job.id}/annotations`);
    outcomes.push(...annotations
      .filter((a) => a.title === 'Outcome')
      .map((a) => ({ level: a.annotation_level, message: a.message })));
  }
  return outcomes;
}

async function main() {
  const repo = env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('GITHUB_REPOSITORY must be set (owner/name)');
  // Last 8 days: one full registration cycle.
  const since = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const { workflow_runs: batch } = await gh(
      `/repos/${repo}/actions/workflows/book.yml/runs?per_page=100&page=${page}&created=>=${since}`);
    all.push(...batch);
    if (batch.length < 100) break;
  }
  // Checks queued behind a run waiting for an opening get cancelled by GitHub; they did nothing.
  const runs = all.filter((r) => !['cancelled', 'skipped'].includes(r.conclusion));

  const prev = await published(repo);
  const known = new Map((prev.runs || []).filter((r) => r.id && r.status === 'completed').map((r) => [r.id, r]));
  const idleBefore = new Set(prev.idle || []);

  let fetched = 0;
  const result = await Promise.all(runs.map(async (r) => {
    const done = r.status === 'completed';
    if (done && idleBefore.has(r.id)) return { id: r.id, idle: true };
    if (done && known.has(r.id)) return known.get(r.id);
    let outcomes = [];
    if (done) {
      try {
        outcomes = await outcomesOf(repo, r);
        fetched++;
      } catch (e) {
        log(`annotations unavailable for run ${r.id}: ${e.message}`);
      }
    }
    if (done && r.conclusion === 'success' && !outcomes.length) return { id: r.id, idle: true };
    return {
      id: r.id,
      url: r.html_url,
      startedAt: r.run_started_at || r.created_at,
      // Runs started by the external scheduler come through the API but are scheduled checks.
      trigger: r.event === 'schedule' || r.display_title?.endsWith('(scheduled)') ? 'schedule' : r.event,
      status: r.status,
      conclusion: r.conclusion,
      outcomes,
    };
  }));

  const last = runs.find((r) => r.status === 'completed');
  writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    lastCheck: last ? { startedAt: last.run_started_at || last.created_at, url: last.html_url } : null,
    allRunsUrl: `https://github.com/${repo}/actions/workflows/book.yml`,
    runs: result.filter((r) => !r.idle),
    idle: result.filter((r) => r.idle).map((r) => r.id),
  }));
  log(`Wrote ${OUT}: ${result.length} runs, ${fetched} looked up`);
}

main().catch((e) => {
  console.error(new Date().toISOString(), 'FAILED:', e.message);
  process.exit(1);
});
