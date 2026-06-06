# Deploy the VRP paper book to Fly.io

Always-on server: ticks the book every **15 minutes** and serves the dashboard at a
public URL. State lives on a persistent Fly volume, so history survives restarts.

> You run these (they need your Fly login). I can't auth into your account.
> No real money, no exchange keys — this only reads public Deribit quotes.

## One-time setup

```bash
# 1. Install flyctl (Windows PowerShell)
iwr https://fly.io/install.ps1 -useb | iex

# 2. Log in / sign up (opens browser). Fly asks for a card but the tiny
#    shared-cpu-1x/256MB machine + 1GB volume fit the free allowance.
fly auth login

cd D:/Projects/calmar-vrp-paper

# 3. Create the app from fly.toml WITHOUT deploying yet (so we can add the volume).
#    If the name "calmar-vrp-paper" is taken, flyctl will suggest a new one —
#    accept it; it also updates fly.toml.
fly launch --no-deploy --copy-config --name calmar-vrp-paper --region ams

# 4. Create the persistent volume the state lives on (1GB is plenty).
fly volumes create vrp_data --region ams --size 1 --yes

# 5. Deploy.
fly deploy
```

## After deploy

```bash
fly open          # opens the dashboard URL (https://<app>.fly.dev)
fly logs          # watch the 15-min ticks: [tick:interval] ... eq $... Δ ...
fly status        # machine health
```

The dashboard auto-refreshes every 60s; the server ticks every 15 min. Done.

## Redeploy after code changes

```bash
git pull          # if changes came from elsewhere
fly deploy        # volume state is preserved (only seeded when empty)
```

## Notes
- Tick cadence is `TICK_MS` (default 900000 = 15 min). Change in fly.toml `[env]`.
- The machine MUST stay on (`auto_stop_machines = false`) — it's a ticking process.
- This is the paper (no-money) demo. The real bot is a separate, key-holding build.
