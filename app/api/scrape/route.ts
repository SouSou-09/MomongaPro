import { cache } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';
import { scrapeAll } from '@/lib/scraper';
import type { ScrapeResult } from '@/lib/scraper';

export const runtime = 'nodejs';
export const maxDuration = 15;
export const dynamic = 'force-dynamic';

const CACHE_KEY = 'momon-ga:scrape:v1';
const TTL_MS = 5 * 60 * 1000; // serve cached data while it is < 5 min old

interface CacheShape {
  data: ScrapeResult;
  ts: number;
}

export async function GET(req: NextRequest) {
  const forceFresh = req.nextUrl.searchParams.get('fresh') === '1';

  if (!forceFresh) {
    try {
      const hit = await cache.get<CacheShape>(CACHE_KEY);
      if (hit && hit.data && hit.ts && Date.now() - hit.ts < TTL_MS) {
        return NextResponse.json(hit.data, {
          headers: { 'X-Cache': 'HIT', 'X-Scraped-At': hit.data.fetchedAt },
        });
      }
    } catch {
      /* Data Cache unavailable → live scrape below */
    }
  }

  const data = await scrapeAll();

  try {
    await cache.set(CACHE_KEY, { data, ts: Date.now() });
  } catch {
    /* ignore */
  }

  return NextResponse.json(data, {
    headers: { 'X-Cache': 'MISS', 'X-Scraped-At': data.fetchedAt },
  });
}
