import * as cheerio from 'cheerio';

/* ---------------------------------- Types ---------------------------------- */

export type Category = 'fanzine' | 'magazine' | 'trend' | 'popularity';

export interface WorkItem {
  id: string;
  title: string;
  url: string;
  image?: string;
  price?: string;
  rank?: number;
}

export interface CategoryResult {
  category: Category;
  label: string;
  sourceUrl: string;
  ok: boolean;
  count: number;
  items: WorkItem[];
  error?: string;
  durationMs?: number;
}

export interface ScrapeResult {
  fetchedAt: string;
  base: string;
  categories: Record<Category, CategoryResult>;
}

export const CATEGORIES: { category: Category; label: string; path: string }[] = [
  { category: 'fanzine', label: '同人誌', path: '/fanzine/' },
  { category: 'magazine', label: '商業誌', path: '/magazine/' },
  { category: 'trend', label: '急上昇', path: '/trend/' },
  { category: 'popularity', label: '人気', path: '/popularity/' },
];

/* ------------------------------ Configuration ------------------------------ */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** Source base URL candidates (first reachable one wins).
 *  Override with the MOMON_GA_BASE_URL environment variable. */
const DEFAULT_BASES = ['https://momon-ga.com', 'https://momon-ga.me'];

/** Paths that are navigation / system links, never work pages */
const SKIP_PATH_RE =
  /\/(search|page|pages|author|authors|tag|tags|genre|genres|category|categories|series|about|company|contact|help|faq|support|privacy|terms|policy|sitemap|feed|rss|login|log-in|signup|sign-up|user|users|account|admin|cart|checkout|wp-admin|wp-login|wp-content|wp-includes)\b/;

/** Anchor texts that are obviously not work titles */
const JUNK_TITLE_RE =
  /^(詳細|詳しく|続きを読む|もっと見る|もっと|すべて|一覧|最新|top|home|ホーム|閉じる|close|×|new|read\s?more|view\s?all)$/i;

/* ------------------------------- Basic helpers ------------------------------ */

export function configBases(): string[] {
  const env = (process.env.MOMON_GA_BASE_URL || '').trim().replace(/\/+$/, '');
  const bases: string[] = [];
  if (env) bases.push(env);
  for (const b of DEFAULT_BASES) {
    if (!bases.includes(b)) bases.push(b);
  }
  return bases;
}

export async function fetchHtml(
  url: string,
  timeoutMs = 7000,
): Promise<{ html: string; finalUrl: string }> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
    },
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  if (!html || html.trim().length < 200) throw new Error('Empty HTML response');
  return { html, finalUrl: res.url || url };
}

/** Pick the first base URL that looks like a real website (has <a> tags). */
export async function detectBase(): Promise<string> {
  const bases = configBases();
  for (const b of bases) {
    try {
      const { html } = await fetchHtml(b + '/', 3000);
      if (/<a[\s>]/i.test(html)) return b;
    } catch {
      /* try next candidate */
    }
  }
  return bases[0];
}

function hashId(url: string): string {
  let h = 5381;
  for (let i = 0; i < url.length; i++) {
    h = ((h << 5) + h + url.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

function normalizeUrl(raw: string, pageUrl: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /^(#|javascript:|mailto:|tel:)/i.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed, pageUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

/* ------------------------------ HTML extraction ---------------------------- */

type J = cheerio.Cheerio<any>;

function isListContainer(el: J): boolean {
  return el.find('a[href]').length > 5;
}

/** Find the smallest "card" element that holds one work. */
function findCard(a: J): J {
  const tight = a.closest('li, article, tr, blockquote, figure');
  if (tight.length > 0 && !isListContainer(tight)) return tight;

  let cur = a.parent();
  for (let i = 0; i < 4 && cur.length > 0; i++) {
    const cls = String(cur.attr('class') || '').toLowerCase();
    if (/(card|item|work|entry|book|product|cell|tile|figure)/.test(cls) && !isListContainer(cur)) {
      return cur;
    }
    cur = cur.parent();
  }
  const p = a.parent();
  return p.length > 0 && !isListContainer(p) ? p : a;
}

/**
 * Generic extraction that does not depend on the exact CSS class names:
 *  1. collect same-site <a> links that are not nav/system pages
 *  2. prefer links containing a thumbnail <img>
 *  3. from the card: image, title (heading > alt > anchor text), price (¥/円)
 *  4. for trend/popularity: rank from "N位"/"#N" text, otherwise list order
 */
export function parseWorkItems(html: string, pageUrl: string, category: Category): WorkItem[] {
  const $ = cheerio.load(html);
  $(
    'script, style, noscript, svg, iframe, template, header, footer, nav, aside, [class*="sidebar"], [class*="modal"], [class*="dialog"], [class*="cookie"], [class*="banner-ad"]',
  ).remove();

  let pageHost = '';
  try {
    pageHost = new URL(pageUrl).host;
  } catch {
    return [];
  }
  const allowHosts = new Set<string>([pageHost]);
  for (const b of configBases()) {
    try {
      allowHosts.add(new URL(b).host);
    } catch {
      /* ignore */
    }
  }

  // 1. Candidate anchors
  const candidates: J[] = [];
  $('a[href]').each((_, el) => {
    const a = $(el);
    const normalized = normalizeUrl(a.attr('href') || '', pageUrl);
    if (!normalized) return;
    const host = new URL(normalized).host;
    if (!allowHosts.has(host) && !/momon-ga\./i.test(host)) return;
    if (SKIP_PATH_RE.test(new URL(normalized).pathname)) return;
    candidates.push(a);
  });

  const items: WorkItem[] = [];
  const seen = new Set<string>();
  const wantRank = category === 'trend' || category === 'popularity';
  let rankCounter = 0;

  const processAnchor = (a: J) => {
    const normalized = normalizeUrl(a.attr('href') || '', pageUrl);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);

    const card = findCard(a);

    // Image
    let image: string | undefined;
    const img = card.find('img').first();
    if (img.length > 0) {
      const src =
        img.attr('src') ||
        img.attr('data-src') ||
        img.attr('data-lazy-src') ||
        img.attr('data-original') ||
        img.attr('data-cfsrc') ||
        '';
      if (src.trim()) {
        try {
          image = new URL(src.trim(), pageUrl).toString();
        } catch {
          image = src.trim();
        }
      }
    }

    // Title
    let title = '';
    const heading = card
      .find('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="name"], [class*="caption"]')
      .first();
    if (heading.length > 0) {
      title = heading.text().replace(/\s+/g, ' ').trim();
    }
    if (title.length < 3) {
      const alt = (a.find('img').first().attr('alt') || '').trim();
      const anchorTitle = (a.attr('title') || '').trim();
      const anchorText = a.text().replace(/\s+/g, ' ').trim();
      if (alt.length >= 3) title = alt;
      else if (anchorTitle.length >= 3) title = anchorTitle;
      else title = anchorText;
    }
    title = title.replace(/\s+/g, ' ').trim();
    if (title.length < 3) return;
    if (JUNK_TITLE_RE.test(title)) return;
    if (/^[\d\s.,、|ー—-]+$/.test(title)) return;
    if (title.length > 120) title = `${title.slice(0, 120)}…`;

    // Price
    const cardText = card.text().replace(/\s+/g, ' ');
    const priceMatch =
      cardText.match(/(?:¥|￥)\s?[\d,]+(?:\.\d+)?/) ||
      cardText.match(/\b\d{2,}(?:,\d{3})*(?:\.\d+)?\s?円/);
    const price = priceMatch ? priceMatch[0].replace(/\s+/g, '') : undefined;

    // Rank (急上昇 / 人気 only)
    let rank: number | undefined;
    if (wantRank) {
      const rankMatch = cardText.match(/#?\s?(\d{1,3})\s*位/) || cardText.match(/^#(\d{1,3})\b/);
      const parsed = rankMatch ? parseInt(rankMatch[1], 10) : NaN;
      rank = Number.isFinite(parsed) && parsed >= 1 ? parsed : ++rankCounter;
    }

    items.push({
      id: hashId(normalized),
      title,
      url: normalized,
      image,
      price,
      rank,
    });
  };

  // 2. Pass 1: anchors that contain a thumbnail image
  const withImage = candidates.filter((a) => a.find('img').length > 0);
  for (const a of withImage) processAnchor(a);

  // 3. Pass 2 (fallback): text-only links
  if (items.length < 3) {
    for (const a of candidates) {
      if (a.find('img').length > 0) continue;
      if (a.text().trim().length >= 4) processAnchor(a);
    }
  }

  return items.slice(0, 300);
}

/* ------------------------------ Whole scrape ------------------------------- */

export async function scrapeAll(): Promise<ScrapeResult> {
  const base = await detectBase();

  const results = await Promise.all(
    CATEGORIES.map(async (c): Promise<CategoryResult> => {
      const sourceUrl = base + c.path;
      const started = Date.now();
      try {
        const { html } = await fetchHtml(sourceUrl, 7000);
        const items = parseWorkItems(html, sourceUrl, c.category);
        return {
          category: c.category,
          label: c.label,
          sourceUrl,
          ok: true,
          count: items.length,
          items,
          durationMs: Date.now() - started,
        };
      } catch (e: unknown) {
        return {
          category: c.category,
          label: c.label,
          sourceUrl,
          ok: false,
          count: 0,
          items: [],
          error: e instanceof Error ? e.message : String(e),
          durationMs: Date.now() - started,
        };
      }
    }),
  );

  const categories = {} as Record<Category, CategoryResult>;
  for (const r of results) categories[r.category] = r;

  return {
    fetchedAt: new Date().toISOString(),
    base,
    categories,
  };
}
