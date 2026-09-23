# Family Schedule

A small shared calendar for one household. Week board with a column per day, each family member gets a color, tap any day to add an event, and an optional shared passcode keeps strangers out. Node.js + Express, no build step, one static page.

Storage picks itself:
- **SQLite** (default) — zero setup, stores to `data/schedule.db`. Ideal locally, or on Railway with a volume.
- **Postgres** — used automatically when `DATABASE_URL` is set. This is the right choice on Render's free tier, where the filesystem is wiped on every deploy/restart.

## Run it locally

```bash
npm install
npm start          # http://localhost:3000
```

Optional passcode:

```bash
FAMILY_PASSWORD=pizza4dinner npm start
```

## Environment variables

| Variable | Purpose |
|---|---|
| `PORT` | Port to listen on (Render/Railway set this for you) |
| `FAMILY_PASSWORD` | If set, everyone must enter this passcode once per browser |
| `DATABASE_URL` | Postgres connection string; switches storage to Postgres |
| `DB_PATH` | SQLite file path (default `./data/schedule.db`) |
| `PGSSL` | Set to `disable` if your Postgres doesn't use TLS |

## Push to GitHub

```bash
cd family-schedule
git init
git add .
git commit -m "Family schedule app"
gh repo create family-schedule --private --source=. --push
# or create the repo on github.com and:
# git remote add origin https://github.com/YOURNAME/family-schedule.git
# git push -u origin main
```

## Deploy on Render (free tier)

Render's free web services work fine for this, with two caveats: they spin down after ~15 minutes idle (first visit after that takes up to a minute), and the disk is ephemeral — so use Postgres, not SQLite, or your calendar resets on every deploy.

1. Create a free Postgres database. Either a Render Postgres instance, or an external free one like Neon (neon.tech) — copy its connection string.
2. In the Render dashboard: **New → Web Service → connect your GitHub repo**. Render reads `render.yaml` and fills in build (`npm install`) and start (`npm start`) automatically.
3. Under **Environment**, set:
   - `DATABASE_URL` = your Postgres connection string
   - `FAMILY_PASSWORD` = whatever passcode the family should use
4. Deploy. Your app lands at `https://family-schedule-xxxx.onrender.com`.

## Deploy on Railway

Railway no longer has an ongoing free tier — new accounts get a one-time trial credit, then it's the $5/month Hobby plan. If you're paying anyway, it's a very smooth setup and SQLite works with a volume:

**Option A — SQLite + volume**
1. **New Project → Deploy from GitHub repo**, pick this repo. Railway auto-detects Node and runs `npm start`.
2. On the service: **Add Volume**, mount path `/data`.
3. Add variables: `DB_PATH=/data/schedule.db` and `FAMILY_PASSWORD=...`
4. Under **Settings → Networking**, generate a public domain.

**Option B — Postgres**
1. Same repo deploy, then **Add → Database → PostgreSQL** in the project.
2. On the web service, add a variable reference: `DATABASE_URL = ${{Postgres.DATABASE_URL}}`, plus `FAMILY_PASSWORD`.

## API (if you want to script against it)

```
GET    /api/members
POST   /api/members            { name, color }
DELETE /api/members/:id        (their events become "Everyone")
GET    /api/events?from=YYYY-MM-DD&to=YYYY-MM-DD
POST   /api/events             { title, date, member_id?, start_time?, end_time?, notes? }
PUT    /api/events/:id
DELETE /api/events/:id
POST   /api/login              { password }
```

Times are `HH:MM` 24-hour strings; leave them off for all-day events.

## Ideas for later

Recurring events, iCal export (`/calendar.ics` for phone subscriptions), week-ahead email digest, drag-to-move between days.
