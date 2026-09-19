# Tennis auto-booking

Books **Permanence adultes** (Mon & Wed, 19:30) at Mouratoglou Country Club on Doinsport
the moment registration opens, using GitHub Actions.

## Setup
1. Push this folder to a GitHub repository (private is fine).
2. Repo → Settings → Secrets and variables → Actions → add `DOIN_EMAIL` and `DOIN_PASSWORD`.
3. Actions → "Book tennis" → Run workflow with a date that's already open and **dry run** on, to check login.
4. Run it again with dry run off on a session you actually want, to check a real booking works.

Failed runs trigger GitHub's email notification.

## Checks every 15 minutes
GitHub's own schedule has started runs 2-3.5 hours late, so the bot is started from outside every 15 minutes,
with GitHub's schedule (12:05/13:05 UTC, then waiting up to 5.5 hours) as a backup. Each check:
- registers at the exact opening time when a planned session opens within 20 minutes;
- books any planned session whose registration is already open and that you haven't booked or cancelled.
  The club sometimes creates Monday/Wednesday sessions hours or days after their registration should have opened;
  these get booked within 15 minutes of appearing.

1. GitHub → Settings → Developer settings → Fine-grained tokens → new token: this repository only,
   permission **Actions: read and write**.
2. On [cron-job.org](https://cron-job.org) (free), create a job:
   - URL: `https://api.github.com/repos/ewertonluis/tennis/actions/workflows/book.yml/dispatches`
   - Schedule: **every 15 minutes**, time zone **Europe/Paris** (19:15 is one of the checks)
   - Advanced → method **POST**, headers `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`,
     `Content-Type: application/json`, body `{"ref":"main","inputs":{"dry_run":"false","source":"cron"}}`
     (without `dry_run` the run defaults to a dry run; `source` shows it as Scheduled on the dashboard)
3. Use "Test run": it should answer **204**, and a new run appears in Actions within seconds.

While a run waits for an opening, later checks queue behind it (GitHub cancels all but the latest queued one).

## Dashboard
https://ewertonluis.github.io/tennis/ — sign in with your club (Doinsport) account.

- Live sessions for every weekday (including Friday's *Permanence adultes débutants*): spots left, full / waiting list, and your status.
- Book, join the waiting list or cancel directly. The weekly limit (2) is enforced.
- Countdown to the next registration the bot will grab, plus the last 8 days of bot runs that booked or failed.
- Change a week's plan before registration opens: **Skip this week** on a Monday/Wednesday, then **Bot books this**
  on another session that week. This edits `plan.json` in the repo, so the first time it asks for a fine-grained
  GitHub token (this repo only, Contents: read and write), which it keeps only in that browser.

The page talks to Doinsport straight from your browser; only a sign-in token is kept on the device.
The **Dashboard** workflow publishes the page and `runs.json` (bot activity) every 2 hours and after each bot run
that booked something or failed.

## Week-by-week plan
`plan.json` lists Paris dates the bot should skip or book on top of `TARGET_DAYS`:
```json
{ "skip": ["2026-09-28"], "add": ["2026-10-01"] }
```
The bot reads it again right before registering, so a skip still counts if it lands after the run has started.
An addition saved after its registration opened is booked at the next check.

## Settings (environment variables)
| Variable | Default |
|---|---|
| `TARGET_NAME` | `Permanence adultes` (what `TARGET_DAYS` books) |
| `SESSION_NAMES` | `Permanence adultes,Permanence adultes débutants` (bookable via the plan, counted in the weekly limit) |
| `TARGET_DAYS` | `Mon,Wed` |
| `TARGET_TIME` | `19:30` |
| `OPEN_DAYS_BEFORE` | `8` |
| `MAX_PER_WEEK` | `2` (bot skips a week that already has this many) |

## Local
```sh
node book.mjs --list
GITHUB_REPOSITORY=ewertonluis/tennis node status.mjs dashboard/runs.json
DOIN_EMAIL=... DOIN_PASSWORD=... node book.mjs --date 2026-09-21 --dry-run
```
