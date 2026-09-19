# Tennis auto-booking

Books **Permanence adultes** (Mon & Wed, 19:30) at Mouratoglou Country Club on Doinsport
the moment registration opens, using GitHub Actions.

## Setup
1. Push this folder to a GitHub repository (private is fine).
2. Repo → Settings → Secrets and variables → Actions → add `DOIN_EMAIL` and `DOIN_PASSWORD`.
3. Actions → "Book tennis" → Run workflow with a date that's already open and **dry run** on, to check login.
4. Run it again with dry run off on a session you actually want, to check a real booking works.

Failed runs trigger GitHub's email notification.

## Exact-time trigger
GitHub's own schedule has started runs 2-3.5 hours late, so the bot is started from outside at a fixed time,
with GitHub's schedule (12:05/13:05 UTC, then waiting up to 5.5 hours) as a backup.

1. GitHub → Settings → Developer settings → Fine-grained tokens → new token: this repository only,
   permission **Actions: read and write**.
2. On [cron-job.org](https://cron-job.org) (free), create a job:
   - URL: `https://api.github.com/repos/ewertonluis/tennis/actions/workflows/book.yml/dispatches`
   - Schedule: every day at **19:15**, time zone **Europe/Paris**
   - Advanced → method **POST**, headers `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`,
     body `{"ref":"main","inputs":{"dry_run":"false"}}` (without it the run defaults to a dry run)
3. Use "Test run": a new **Manual** run should appear in Actions within seconds.

If the backup run is already waiting for that opening, the triggered run queues behind it and finds you registered.

## Dashboard
https://ewertonluis.github.io/tennis/ — sign in with your club (Doinsport) account.

- Live sessions for every weekday (including Friday's *Permanence adultes débutants*): spots left, full / waiting list, and your status.
- Book, join the waiting list or cancel directly. The weekly limit (2) is enforced.
- Countdown to the next registration the bot will grab, plus recent bot runs.
- Change a week's plan before registration opens: **Skip this week** on a Monday/Wednesday, then **Bot books this**
  on another session that week. This edits `plan.json` in the repo, so the first time it asks for a fine-grained
  GitHub token (this repo only, Contents: read and write), which it keeps only in that browser.

The page talks to Doinsport straight from your browser; only a sign-in token is kept on the device.
The **Dashboard** workflow publishes the page and `runs.json` (bot activity) every 2 hours and after each bot run.

## Week-by-week plan
`plan.json` lists Paris dates the bot should skip or book on top of `TARGET_DAYS`:
```json
{ "skip": ["2026-09-28"], "add": ["2026-10-01"] }
```
The bot reads it again right before registering, so a skip still counts if it lands after the run has started.
An addition has to be saved before the 19:15 trigger on the day its registration opens.

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
