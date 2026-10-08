'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Category, ScrapeResult, WorkItem } from '@/lib/scraper';

const TABS: { key: Category; label: string; icon: string }[] = [
  { key: 'fanzine', label: '同人誌', icon: '📖' },
  { key: 'magazine', label: '商業誌', icon: '📚' },
  { key: 'trend', label: '急上昇', icon: '📈' },
  { key: 'popularity', label: '人気', icon: '🔥' },
];

const AUTO_REFRESH_MS = 5 * 60 * 1000; // client re-polls every 5 minutes

function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export default function HomePage() {
  const [data, setData] = useState<ScrapeResult | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Category>('fanzine');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<WorkItem | null>(null);

  // Initial load + silent auto-refresh every 5 minutes
  useEffect(() => {
    let mounted = true;
    const load = () => {
      fetch('/api/scrape', { cache: 'no-store' })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<ScrapeResult>;
        })
        .then((json) => {
          if (!mounted) return;
          setData(json);
          setError(null);
          setInitialLoading(false);
        })
        .catch((e: unknown) => {
          if (!mounted) return;
          setError(e instanceof Error ? e.message : String(e));
          setInitialLoading(false);
        });
    };
    load();
    const timer = setInterval(load, AUTO_REFRESH_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const manualRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/refresh', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ScrapeResult;
      setData(json);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Close modal with Esc
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  const current = data ? data.categories[tab] : undefined;

  const items = useMemo(() => {
    if (!current) return [] as WorkItem[];
    const q = query.trim().toLowerCase();
    if (!q) return current.items;
    return current.items.filter(
      (w) =>
        w.title.toLowerCase().includes(q) ||
        (w.price && w.price.toLowerCase().includes(q)),
    );
  }, [current, query]);

  const allOk = data ? TABS.every((t) => data.categories[t.key]?.ok) : false;

  return (
    <div className="shell">
      <header className="head">
        <div className="logo" aria-hidden>🐿️</div>
        <div>
          <h1>
            モモニガ <span className="grad">ウォッチャー</span>
          </h1>
          <p className="dim">
            momon-ga の <b>同人誌</b> / <b>商業誌</b> / <b>急上昇</b> / <b>人気</b> を自動スクレイピングして一覧表示
          </p>
        </div>
      </header>

      <nav className="tabs" aria-label="カテゴリー">
        {TABS.map((t) => {
          const c = data ? data.categories[t.key] : undefined;
          const count = c ? c.count : null;
          return (
            <button
              key={t.key}
              type="button"
              className={tab === t.key ? 'tab active' : 'tab'}
              onClick={() => setTab(t.key)}
            >
              <span aria-hidden>{t.icon}</span>
              {t.label}
              {count !== null && <span className="count">{count}</span>}
            </button>
          );
        })}
      </nav>

      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="タイトルで検索…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="作品検索"
        />
        <div className="toolbar-right">
          <span className="statusbar">
            <span className={allOk ? 'dot' : 'dot bad'} aria-hidden />
            更新: {formatDateTime(data ? data.fetchedAt : undefined)}（5分毎 自動）
          </span>
          <button
            type="button"
            className="refresh-btn"
            onClick={manualRefresh}
            disabled={refreshing}
          >
            {refreshing ? '更新中…' : '今すぐ更新'}
          </button>
        </div>
      </div>

      {error && (
        <div className="error-box" role="alert">
          <strong>エラー: {error}</strong>
          <p className="dim small">
            直近のデータがある場合は引き続き表示しています。なければ
            <button className="linklike" onClick={manualRefresh}> 再取得</button>
            してください。
          </p>
        </div>
      )}

      {initialLoading ? (
        <div className="grid" aria-busy="true">
          {Array.from({ length: 12 }).map((_, i) => (
            <div className="skel" key={i}>
              <div className="skel-thumb" />
              <div className="skel-lines">
                <div />
                <div style={{ width: '60%' }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          {current && !current.ok && (
            <div className="error-box" role="alert">
              <strong>「{current.label}」の取得に失敗しました</strong>
              <p>{current.error}</p>
              <p className="dim small">ソース: {current.sourceUrl}</p>
            </div>
          )}

          {current && current.ok && current.count === 0 && (
            <div className="empty">
              <div className="empty-emoji" aria-hidden>🔍</div>
              <p>作品が見つかりませんでした。</p>
              <p className="dim small">
                サイトのHTML構造が変わった可能性があります。
                <a className="linklike" href="/api/scrape/debug" target="_blank" rel="noreferrer">
                  デバッグ情報
                </a>
                を確認し、必要なら <code>lib/scraper.ts</code> の抽出ロジックを調整してください。
              </p>
            </div>
          )}

          {current && current.ok && current.count > 0 && items.length === 0 && (
            <div className="empty">
              <div className="empty-emoji" aria-hidden>🫥</div>
              <p>「{query}」に一致する作品はありません</p>
            </div>
          )}

          {current && current.ok && items.length > 0 && (
            <div className="grid">
              {items.map((item) => (
                <article
                  key={item.id}
                  className="card"
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelected(item)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelected(item);
                    }
                  }}
                >
                  <div className="thumb">
                    {item.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.image}
                        alt={item.title}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="noimg" aria-hidden>📕</div>
                    )}
                    {item.rank !== undefined && (
                      <span className={item.rank <= 3 ? 'rank top' : 'rank'}>
                        {'#'}
                        {item.rank}
                      </span>
                    )}
                    <a
                      className="open"
                      href={item.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      title="元のページで開く"
                      onClick={(e) => e.stopPropagation()}
                    >
                      ↗
                    </a>
                  </div>
                  <div className="meta">
                    <h3 title={item.title}>{item.title}</h3>
                    {item.price && <span className="price">{item.price}</span>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      <footer className="foot">
        <div className="cats-status">
          {TABS.map((t) => {
            const c = data ? data.categories[t.key] : undefined;
            const cls = !c ? 'chip' : c.ok ? 'chip ok' : 'chip err';
            const txt = !c
              ? `${t.label}: …`
              : c.ok
                ? `${t.label}: ${c.count}作品`
                : `${t.label}: 取得エラー`;
            return (
              <span key={t.key} className={cls}>
                {txt}
              </span>
            );
          })}
        </div>
        <p className="dim small">
          ソース: {data ? data.base : '…'} ・ 最終スクレイプ: {formatDateTime(data ? data.fetchedAt : undefined)}（Asia/Tokyo）
          ・ <a className="linklike" href="/api/scrape" target="_blank" rel="noreferrer">JSON</a>
          ・ <a className="linklike" href="/api/scrape/debug" target="_blank" rel="noreferrer">デバッグ</a>
        </p>
      </footer>

      {selected && (
        <div className="overlay" onClick={() => setSelected(null)} role="dialog" aria-modal="true">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="close" onClick={() => setSelected(null)} aria-label="閉じる">
              ×
            </button>
            {selected.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selected.image} alt={selected.title} referrerPolicy="no-referrer" />
            ) : (
              <div className="noimg modal-noimg" aria-hidden>📕</div>
            )}
            <div className="modal-body">
              <h2>{selected.title}</h2>
              <div className="modal-row">
                {selected.rank !== undefined && (
                  <span className="rank-badge">
                    {'#'}
                    {selected.rank} 位
                  </span>
                )}
                {selected.price && <span className="price">{selected.price}</span>}
              </div>
              <a className="btn" href={selected.url} target="_blank" rel="noreferrer noopener">
                元のページを開く ↗
              </a>
              <p className="dim small url">{selected.url}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
