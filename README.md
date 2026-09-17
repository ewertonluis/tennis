# Tennis auto-booking

Books **Permanence adultes** (Mon & Wed, 19:30) at Mouratoglou Country Club on Doinsport
the moment registration opens, using GitHub Actions.

## Setup
1. Push this folder to a GitHub repository (private is fine).
2. Repo → Settings → Secrets and variables → Actions → add `DOIN_EMAIL` and `DOIN_PASSWORD`.
3. Actions → "Book tennis" → Run workflow with a date that's already open and **dry run** on, to check login.
4. Run it again with dry run off on a session you actually want, to check a real booking works.

Failed runs trigger GitHub's email notification.

## Settings (environment variables)
| Variable | Default |
|---|---|
| `TARGET_NAME` | `Permanence adultes` |
| `TARGET_DAYS` | `Mon,Wed` |
| `TARGET_TIME` | `19:30` |
| `OPEN_DAYS_BEFORE` | `7` |

## Local
```sh
node book.mjs --list
DOIN_EMAIL=... DOIN_PASSWORD=... node book.mjs --date 2026-09-21 --dry-run
```
