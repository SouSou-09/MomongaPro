# モモニガウォッチャー (Momon-ga Watcher)

Continuously scrapes momon-ga (https://momon-ga.com / https://momon-ga.me) and displays:
- 同人誌 `/fanzine/`
- 商業誌 `/magazine/`
- 急上昇 `/trend/`
- 人気 `/popularity/`

## How it stays "always fresh"
- **Vercel Cron** (`vercel.json`) hits `/api/refresh` every 15 minutes → live scrape → stored in Vercel Data Cache.
- `/api/scrape` returns cached data while it is under 5 minutes old, otherwise scrapes live and re-caches.
- The web UI re-fetches every 5 minutes and has a "今すぐ更新" button.
- Scraping runs server-side (cheerio, parallel page fetches, ~1–10 s).

## Local development
    npm install
    npm run dev
    # http://localhost:3000

## Deploy to Vercel
1. Push this folder to a GitHub repository.
2. vercel.com → **Add New → Project** → import the repo (Next.js is auto-detected).
3. (Optional) Add env var `MOMON_GA_BASE_URL` = `https://momon-ga.me`
   (forces one domain; default auto-detects .com then .me).
4. Deploy. The cron starts automatically.

## Endpoints
- `GET /api/scrape` — cached JSON (5 min TTL), `?fresh=1` to force live scrape
- `GET|POST /api/refresh` — forced live scrape + cache update (cron target)
- `GET /api/scrape/debug` — raw HTML + anchor list per page (`?page=trend` to narrow)

## If the site's HTML changes
Open `/api/scrape/debug`, check the anchor list, and tune the heuristics in
`lib/scraper.ts` (`parseWorkItems`): title fallbacks, price regex, card detection.

## Plan notes
- Hobby: function max duration is small — scrape is parallelized to fit in 15 s.
- Hobby: cron executions are limited (about 2,000/month) — `*/15` uses 960/month.
