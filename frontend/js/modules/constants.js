// Cross-app link to the content pipeline app (MERGE_PLAN.md Phase 3).
// Override with ?content_pipeline=<url> or window.CONTENT_PIPELINE_URL
// set before this script runs — falls back to the local dev default.
export const CONTENT_PIPELINE_URL = new URLSearchParams(window.location.search).get('content_pipeline') ||
  window.CONTENT_PIPELINE_URL || 'http://127.0.0.1:8001';

export const DIGEST_SECTIONS = [
  { id: 'step_guide', label: 'Workflow Guide Bar', icon: 'fa-solid fa-signs-post', desc: 'Step-by-step 4-step sales exploration guide' },
  { id: 'recently_updated', label: 'Recently Updated Accounts', icon: 'fa-solid fa-clock-rotate-left', desc: 'Accounts with fresh scrapes & pipeline updates' },
  { id: 'most_mapped', label: 'Most-Mapped Accounts', icon: 'fa-solid fa-users', desc: 'Deepest organizational charts and contact coverage' },
  { id: 'social_digest', label: 'Social & Content Intelligence', icon: 'fa-solid fa-tower-broadcast', desc: 'Captured social discourse & LLM synthesized themes' },
  { id: 'sales_alerts', label: 'Global Sales Alerts (StradIT Fit)', icon: 'fa-solid fa-bolt', desc: 'AI service alignment opportunities across accounts' },
  { id: 'domain_expansion', label: 'Emerging Domain Expansion', icon: 'fa-solid fa-rocket', desc: 'Trending enterprise tech initiatives & custom solutions' },
  { id: 'cxo_movements', label: 'Executive Leadership Transitions & CXO Movements', icon: 'fa-solid fa-right-left', desc: 'Live tracked executive appointments, departures, and role movements' },
  { id: 'linkedin_jobs', label: 'Recent LinkedIn Job Postings', icon: 'fa-brands fa-linkedin', desc: 'Newest scraped job postings across all tracked accounts' }
];

export const CHANNEL_ICON = {
  linkedin: 'fa-brands fa-linkedin', twitter: 'fa-brands fa-x-twitter', reddit: 'fa-brands fa-reddit',
  news: 'fa-solid fa-newspaper', blog: 'fa-solid fa-book-open', newsroom: 'fa-solid fa-bullhorn',
  sec: 'fa-solid fa-building-columns', sec_mentions: 'fa-solid fa-building-columns', rss: 'fa-solid fa-rss'
};
export const CHANNEL_LABEL = {
  linkedin: 'LinkedIn', twitter: 'X / Twitter', reddit: 'Reddit',
  news: 'News', blog: 'Blog', newsroom: 'Newsroom', sec: 'SEC Filings',
  sec_mentions: 'SEC Mentions', rss: 'RSS'
};
export const STRENGTH_PILL = { weak: 'pill-warning', moderate: 'pill-warning', strong: 'pill-success' };

// StradIT's real service lines (scraped from stradit.com/coe/* — Aug 2026), used to
// match against real captured account/contact signals below. Keyword-matched with cited
// evidence, never an invented "AI insight" — if nothing matches, nothing is shown.
export const STRADIT_OFFERINGS = [
  {
    id: 'ai', label: 'Applied AI', icon: 'fa-solid fa-microchip',
    pitch: 'AI governance, LLMOps, and production-grade AI agents/copilots.',
    keywords: [/artificial intelligence/i, /\bai\b/i, /\bllm\b/i, /generative ai/i, /genai/i, /machine learning/i, /\bml\b/i, /copilot/i, /\bagent/i, /agentic/i, /guardrail/i, /knowledge graph/i, /chatbot/i],
    roleKeywords: [/chief technology/i, /\bcto\b/i, /chief data/i, /\bcdo\b/i, /chief information officer/i, /\bcio\b/i, /chief digital/i, /chief innovation/i, /head of (ai|technology|data|innovation)/i],
    looseRoleKeywords: [/technology/i, /digital/i, /data/i, /innovation/i]
  },
  {
    id: 'data', label: 'Data Analytics', icon: 'fa-solid fa-chart-column',
    pitch: 'Data integration, predictive intelligence, and decision-intelligence dashboards.',
    keywords: [/data quality/i, /data integration/i, /predictive/i, /forecast/i, /dashboard/i, /analytics/i, /business intelligence/i, /decision intelligence/i, /\breporting\b/i],
    roleKeywords: [/chief data/i, /\bcdo\b/i, /head of (data|analytics)/i, /chief analytics/i, /data officer/i],
    looseRoleKeywords: [/data/i, /analytics/i]
  },
  {
    id: 'cyber', label: 'Cybersecurity', icon: 'fa-solid fa-shield-halved',
    pitch: 'AI-enhanced security engineering, managed threat monitoring, and compliance readiness.',
    keywords: [/cyber/i, /security/i, /breach/i, /ransomware/i, /\bthreat/i, /vulnerabilit/i, /incident response/i, /data protection/i, /identity management/i],
    roleKeywords: [/chief information security/i, /\bciso\b/i, /head of security/i, /chief security/i, /security officer/i],
    looseRoleKeywords: [/security/i, /risk/i]
  },
  {
    id: 'cloud', label: 'Cloud & Infrastructure', icon: 'fa-solid fa-cloud',
    pitch: 'Multi-cloud migration, legacy modernization, and 24/7 managed cloud operations.',
    keywords: [/cloud migration/i, /\bcloud\b/i, /\baws\b/i, /\bazure\b/i, /\bgcp\b/i, /data cent(re|er)/i, /modernization/i, /multi-cloud/i, /legacy system/i, /\binfrastructure\b/i],
    roleKeywords: [/chief technology/i, /\bcto\b/i, /chief information officer/i, /\bcio\b/i, /head of (infrastructure|engineering|technology)/i, /vp.*engineering/i],
    looseRoleKeywords: [/technology/i, /infrastructure/i, /engineering/i, /operations/i]
  },
  {
    id: 'testing', label: 'Automated AI Testing', icon: 'fa-solid fa-square-check',
    pitch: 'AI-powered test automation and quality engineering frameworks.',
    keywords: [/\bqa\b/i, /quality engineering/i, /test automation/i, /ci\/cd/i, /release readiness/i, /\bdefect/i],
    roleKeywords: [/head of (quality|engineering)/i, /vp.*engineering/i, /chief technology/i, /\bcto\b/i, /quality assurance/i],
    looseRoleKeywords: [/quality/i, /engineering/i]
  },
  {
    id: 'digital_assets', label: 'Digital Assets & Blockchain', icon: 'fa-brands fa-bitcoin',
    pitch: 'Regulated tokenization, custody infrastructure, and smart-contract lifecycle management.',
    keywords: [/tokeniz/i, /\btoken\b/i, /blockchain/i, /digital asset/i, /stablecoin/i, /smart contract/i, /distributed ledger/i, /\bdlt\b/i, /\bcustody\b/i, /\bmica\b/i, /\bsettlement\b/i],
    roleKeywords: [/digital asset/i, /blockchain/i, /chief digital/i, /chief innovation/i, /head of (digital|innovation)/i],
    looseRoleKeywords: [/digital/i, /innovation/i, /custody/i]
  }
];

export const JOB_PAGE_SIZE = 24;
