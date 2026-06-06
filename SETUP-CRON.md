# Free always-on ticking: cron-job.org → GitHub → Pages

Architecture (all free, no server, no card):

```
cron-job.org  ──every 15 min──▶  GitHub workflow_dispatch (tick.yml)
                                      │  marks book + commits data/vrp-paper.json
                                      ▼
                                 GitHub Pages  ──▶  https://mexrood.github.io/calmar-vrp-paper/
```

## 1. Create a fine-grained Personal Access Token (PAT)

You do this (it's a credential — keep it secret, never commit it).

1. GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token.
2. Repository access: **Only select repositories** → `calmar-vrp-paper`.
3. Permissions → Repository → **Actions: Read and write**. (Nothing else needed.)
4. Expiration: 90 days (renew later). Generate, copy the `github_pat_...` string.

## 2. Create the cron job at cron-job.org

1. Sign up at https://cron-job.org (free), → **Create cronjob**.
2. **URL:**
   ```
   https://api.github.com/repos/mexrood/calmar-vrp-paper/actions/workflows/tick.yml/dispatches
   ```
3. **Schedule:** every 15 minutes (`*/15 * * * *`).
4. **Request method:** POST.
5. **Headers** (Advanced → Headers):
   ```
   Accept: application/vnd.github+json
   Authorization: Bearer github_pat_YOUR_TOKEN_HERE
   X-GitHub-Api-Version: 2022-11-28
   User-Agent: cron-job.org
   ```
6. **Request body:**
   ```json
   {"ref":"master"}
   ```
7. Save. Use "Run now" once to test — you should see a green run appear in the
   repo's **Actions** tab, and a new `tick:` commit within ~30s.

## 3. Dashboard

GitHub Pages is already enabled (master branch, root). The dashboard is live at:

```
https://mexrood.github.io/calmar-vrp-paper/
```

It auto-refreshes every 60s; each cron tick commits new state and Pages rebuilds
(~1 min). Done — free, punctual, with the interface.

## Notes
- Public repo → unlimited Actions minutes, so 15-min cadence is free.
- To stop: pause the cron job at cron-job.org.
- The PAT only grants Actions read/write on this one repo — it cannot touch funds,
  other repos, or anything else. Still, treat it like a password.
