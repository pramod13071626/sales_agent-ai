// Google News widget — recent articles already captured in Postgres
// (Post.channel == 'news', scraped from Google News RSS per-account during
// the intelligence pipeline run) surfaced as one cross-account feed instead
// of requiring a rep to open each account's own Content tab to see it.
import { esc } from './utils.js';
import { renderSkeleton } from '../skeleton.js';

let newsPromise = null;

function loadNews() {
  if (!newsPromise) {
    newsPromise = fetch('/api/news?limit=20')
      .then(res => { if (!res.ok) throw new Error(`Failed to load news (${res.status})`); return res.json(); })
      .then(data => data.articles || []);
  }
  return newsPromise;
}

function timeAgo(iso) {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}

export async function renderNewsFeed() {
  const list = document.getElementById('ccNewsList');
  if (!list) return;
  list.innerHTML = renderSkeleton('feed-rows');

  let articles;
  try {
    articles = await loadNews();
  } catch (err) {
    console.error(err);
    list.innerHTML = '<li class="cc-drawer-empty">Could not load news.</li>';
    return;
  }

  if (!articles.length) {
    list.innerHTML = '<li class="cc-drawer-empty">No recent news captured yet for your accounts.</li>';
    return;
  }

  list.innerHTML = articles.map(a => `
    <li class="cc-feed-row">
      <div class="cc-feed-body">
        <div class="cc-feed-title-row">
          <a class="cc-feed-title cc-news-link" href="${esc(a.url || '#')}" target="_blank" rel="noopener">${esc(a.title)}</a>
        </div>
        <div class="cc-feed-meta">${esc(a.account_name || '')}${a.source ? ` &middot; ${esc(a.source)}` : ''} &middot; ${esc(timeAgo(a.first_seen))}</div>
      </div>
    </li>`).join('');
}
