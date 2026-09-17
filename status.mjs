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

async function main() {
  const repo = env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('GITHUB_REPOSITORY must be set (owner/name)');
  const { workflow_runs: runs } = await gh(`/repos/${repo}/actions/workflows/book.yml/runs?per_page=15`);
  const result = await Promise.all(runs.map(async (r) => {
    const outcomes = [];
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
      trigger: r.event,
      status: r.status,
      conclusion: r.conclusion,
      outcomes,
    };
  }));
  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), runs: result }));
  log(`Wrote ${OUT}: ${result.length} runs`);
}

main().catch((e) => {
  console.error(new Date().toISOString(), 'FAILED:', e.message);
  process.exit(1);
});
