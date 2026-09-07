import { el } from './dom.js';

// Shared localStorage key with the Account Explorer page.
export function initThemeToggle() {
  const btn = el('themeToggle');
  const icon = btn.querySelector('i');
  function setIcon(theme) { icon.className = theme === 'dark' ? 'bi bi-sun' : 'bi bi-moon-stars'; }
  let saved = null;
  try { saved = localStorage.getItem('scraperTheme'); } catch (e) { /* private browsing / storage disabled */ }
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
    setIcon(saved);
  }
  btn.addEventListener('click', function () {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    setIcon(next);
    try { localStorage.setItem('scraperTheme', next); } catch (e) { /* private browsing / storage disabled */ }
  });
}
