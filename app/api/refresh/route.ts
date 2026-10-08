import { cache } from 'next/cache';
import { NextResponse } from 'next/server';
import { scrapeAll } from '@/lib/scraper';
import type { ScrapeResult } from '@/lib/scraper';

export const runtime = 'nodejs';
export const maxDuration = 15;
export const dynamic = 'force-dynamic';

const CACHE_KEY = 'momon-ga:scrape:v1';

interface CacheShape {
  data: ScrapeResult;
  ts: number;
}

async function refresh() {
  const data = await scrapeAll();
  try {
    await cache.set(CACHE_KEY, { data, ts: Date.now() });
  } catch {
    /* ignore */
  }
  return NextResponse.json(data, {
    headers: {
      'X-Cache': 'REFRESH',
      'X-Scraped-At': data.fetchedAt,
      'Cache-Control': 'no-store',
    },
  });
}

export async function GET() {
  return refresh();
}

export async function POST() {
  return refresh();
}
