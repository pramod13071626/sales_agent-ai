import { esc, parseSnippetTable } from './utils.js';

export function renderFinancialSnippets(lob) {
  const snippets = lob.financial_snippets || [];
  if (!snippets.length) {
    return `<div class="empty-block">
      <div class="empty-block-icon"><i class="bi bi-cash-stack"></i></div>
      <div class="empty-block-text">No financial snippets captured yet for this line of business.</div>
    </div>`;
  }
  return snippets.map(s => {
    const rows = parseSnippetTable(s);
    if (rows && rows.length > 1) {
      const [header, ...body] = rows;
      return `
        <div class="fin-table-wrap">
          <table class="fin-table">
            <thead><tr>${header.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
            <tbody>${body.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
          </table>
        </div>`;
    }
    return `<blockquote class="fin-snippet"><i class="bi bi-quote"></i> ${esc(s)}</blockquote>`;
  }).join('');
}
