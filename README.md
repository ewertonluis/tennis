# Tennis auto-booking

Books **Permanence adultes** (Mon & Wed, 19:30) at Mouratoglou Country Club on Doinsport
the moment registration opens, using GitHub Actions.

## Setup
1. Push this folder to a GitHub repository (private is fine).
2. Repo → Settings → Secrets and variables → Actions → add `DOIN_EMAIL` and `DOIN_PASSWORD`.
3. Actions → "Book tennis" → Run workflow with a date that's already open and **dry run** on, to check login.
4. Run it again with dry run off on a session you actually want, to check a real booking works.

Failed runs trigger GitHub's email notification.

## Dashboard
https://ewertonluis.github.io/tennis/ — sign in with your club (Doinsport) account.

- Live sessions for every weekday: spots left, full / waiting list, and your status.
- Book, join the waiting list or cancel directly. The weekly limit (2) is enforced.
- Countdown to the next registration the bot will grab, plus recent bot runs.

The page talks to Doinsport straight from your browser; only a sign-in token is kept on the device.
The **Dashboard** workflow publishes the page and `runs.json` (bot activity) every 2 hours and after each bot run.

## Settings (environment variables)
| Variable | Default |
|---|---|
| `TARGET_NAME` | `Permanence adultes` |
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
