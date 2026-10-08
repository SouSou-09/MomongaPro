import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import { CATEGORIES, configBases, fetchHtml } from '@/lib/scraper';

export const runtime = 'nodejs';
export const maxDuration = 15;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const only = req.nextUrl.searchParams.get('page'); // fanzine | magazine | trend | popularity

  const bases = configBases();
  let base = bases[0];
  for (const b of bases) {
    try {
      const { html } = await fetchHtml(b + '/', 3000);
      if (/<a[\s>]/i.test(html)) {
        base = b;
        break;
      }
    } catch {
      /* next */
    }
  }

  const targets =
    only && only !== 'all' ? CATEGORIES.filter((c) => c.category === only) : CATEGORIES;

  const pages = await Promise.all(
    targets.map(async (c) => {
      const url = base + c.path;
      try {
        const { html, finalUrl } = await fetchHtml(url, 6000);
        const $ = cheerio.load(html);
        const anchors: { href: string; text: string; hasImg: boolean; cls: string }[] = [];
        $('a[href]').slice(0, 150).each((_, el) => {
          const a = $(el);
          anchors.push({
            href: a.attr('href') || '',
            text: a.text().replace(/\s+/g, ' ').trim().slice(0, 80),
            hasImg: a.find('img').length > 0,
            cls: String(a.attr('class') || '').slice(0, 100),
          });
        });
        return {
          category: c.category,
          url,
          finalUrl,
          ok: true,
          htmlLength: html.length,
          htmlHead: html.slice(0, 12000),
          anchorCount: $('a[href]').length,
          anchors,
        };
      } catch (e: unknown) {
        return {
          category: c.category,
          url,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );

  return NextResponse.json({
    base,
    generatedAt: new Date().toISOString(),
    hint: 'If anchors have no img and no readable title, tune parseWorkItems() in lib/scraper.ts.',
    pages,
  });
}
