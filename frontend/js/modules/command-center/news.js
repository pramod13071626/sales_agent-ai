// Google News widget — recent articles already captured in Postgres
// (Post.channel == 'news', scraped from Google News RSS per account and per
// executive by the content pipeline) surfaced as one cross-account feed instead
// of requiring a rep to open each account's own Content tab to see it.
// /api/news ranks by the article's own date and filters by account server-side.
import { esc } from './utils.js';
import { renderSkeleton } from '../skeleton.js';
import { ccState } from './state.js';

const STALE_DAYS = 7;
const newsByAccount = new Map();   // account id ('' = all) -> Promise<{articles, last_scraped}>

function loadNews(accountId) {
  const key = accountId ? String(accountId) : '';
  if (!newsByAccount.has(key)) {
    const params = new URLSearchParams({ limit: '20' });
    if (accountId) params.set('account_id', accountId);
    const p = fetch(`/api/news?${params}`)
      .then(res => { if (!res.ok) throw new Error(`Failed to load news (${res.status})`); return res.json(); })
      .catch(err => { newsByAccount.delete(key); throw err; });   // let the next render retry
    newsByAccount.set(key, p);
  }
  return newsByAccount.get(key);
}

function daysAgo(iso) {
  return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null;
}

function timeAgo(iso) {
  if (!iso) return '';
  const days = daysAgo(iso);
  if (days <= 0) return 'today';
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}

export async function renderNewsFeed() {
  const list = document.getElementById('ccNewsList');
  if (!list) return;
  list.innerHTML = renderSkeleton('feed-rows');

  const accountId = ccState.activeAccountId;
  let data;
  try {
    data = await loadNews(accountId);
  } catch (err) {
    console.error(err);
    list.innerHTML = '<li class="cc-drawer-empty">Could not load news.</li>';
    return;
  }
  if (ccState.activeAccountId !== accountId) return;   // filter changed while loading

  const articles = data.articles || [];
  if (!articles.length) {
    list.innerHTML = '<li class="cc-drawer-empty">No recent news captured yet for the selected account.</li>';
    return;
  }

  // News only arrives when the content pipeline's scrape runs — say so when it's old.
  const scrapedDays = daysAgo(data.last_scraped);
  const staleNote = scrapedDays !== null && scrapedDays >= STALE_DAYS
    ? `<li class="cc-drawer-empty cc-news-stale"><i class="fa-solid fa-clock-rotate-left"></i> News last fetched ${scrapedDays} days ago — run the content pipeline scrape to refresh.</li>`
    : '';

  list.innerHTML = staleNote + articles.map(a => `
    <li class="cc-feed-row">
      <div class="cc-feed-body">
        <div class="cc-feed-title-row">
          <a class="cc-feed-title cc-news-link" href="${esc(a.url || '#')}" target="_blank" rel="noopener">${esc(a.title)}</a>
        </div>
        <div class="cc-feed-meta">${esc(a.account_name || '')}${a.person_name ? ` &middot; ${esc(a.person_name)}` : ''}${a.source ? ` &middot; ${esc(a.source)}` : ''} &middot; <span title="${esc(a.published_at ? 'Published ' + new Date(a.published_at).toLocaleString() : 'Date unknown — first captured ' + new Date(a.first_seen).toLocaleString())}">${esc(timeAgo(a.published_at || a.first_seen))}</span></div>
      </div>
    </li>`).join('');
}
