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
`dashboard/index.html` is published to GitHub Pages by the **Dashboard** workflow, every 2 hours and
after every booking run. It shows which sessions are booked, the next registration the bot will grab
(with a countdown), and recent bot runs. The data is encrypted, so only someone with the passphrase can read it.

1. Add a secret `DASHBOARD_PASSPHRASE` (any long phrase you'll remember).
2. Settings → Pages → Source: **GitHub Actions**. On a free GitHub plan the repository must be public
   (your passwords stay in secrets; run logs become public).
3. Actions → Dashboard → Run workflow, then open `https://<user>.github.io/tennis/`.

## Settings (environment variables)
| Variable | Default |
|---|---|
| `TARGET_NAME` | `Permanence adultes` |
| `TARGET_DAYS` | `Mon,Wed` |
| `TARGET_TIME` | `19:30` |
| `OPEN_DAYS_BEFORE` | `8` |

## Local
```sh
node book.mjs --list
DOIN_EMAIL=... DOIN_PASSWORD=... DASHBOARD_PASSPHRASE=... node status.mjs dashboard/data.json
DOIN_EMAIL=... DOIN_PASSWORD=... node book.mjs --date 2026-09-21 --dry-run
```
