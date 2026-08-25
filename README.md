# Enterprise Sales AI Intelligence Pipeline

Autonomous, multi-source enterprise intelligence engine designed to discover account firmographics, subsidiaries/LOBs, 4-tier organizational hierarchies, AI persona dossiers, and official scraping target URLs with dual output to JSON and PostgreSQL.

---

## 🏗️ Architecture Overview

```
pipeline/
├── .env.example               # Environment variables template
├── config.py                  # Dynamic configuration loader (PostgreSQL & APIs)
├── requirements.txt           # Production Python dependencies
├── main.py                    # Master CLI pipeline runner (Dual JSON + DB sync)
├── serializer.py              # Payload assembler & tree visualizer serializer
│
├── collectors/                # 🔍 Intelligence Extraction Engines
│   ├── account_collector.py   # Firmographics, SEC EDGAR CIK/Ticker, 15 target URLs
│   ├── sublob_collector.py    # Sub-organization & subsidiary discovery (Apify)
│   ├── lob_enricher.py        # Audited segment revenue & operating heads
│   ├── hierarchy_collector.py # 4-Tier org hierarchy & 18 scraping URLs per person
│   └── persona_enricher.py    # Neural AI executive dossier synthesis (Exa/Tavily)
│
└── db/                        # 🗄️ PostgreSQL Database Layer (Clean Architecture)
    ├── connection.py          # SQLAlchemy Engine & SessionLocal factory
    ├── models/                # 4 ORM Models (accounts, lobs, sub_lobs, personas)
    ├── schemas/               # 4 Pydantic validation & extraction schemas
    ├── repositories/          # 3 Data Access Repositories with UPSERT logic
    ├── writer.py              # High-level orchestrator writer
    ├── create_tables.py       # Safe table creation script
    ├── load_existing.py       # Local JSON to DB loader
    └── dump_to_neon.py        # Safe cloud database migration script
```

---

## 🚀 Key Features

### 1. Zero Hardcoding Policy
* **100% Dynamic Execution**: All stock tickers, SEC CIKs, headquarters locations, domains, scraping URLs, and persona dossiers are dynamically parsed at runtime.
* **AST Verified**: AST static audit ensures zero hardcoded company names, CIKs, or person identifiers.

### 2. Multi-Source Intelligence Matrix
* **Crunchbase**: Account firmographics, funding rounds, web traffic, and sub-organizations.
* **Monid.ai (Apollo.io Gateway)**: Real-time 4-tier corporate hierarchy extraction.
* **SEC EDGAR API (Free)**: Automated mapping of stock tickers to 10-digit CIK numbers, Atom filings feed, and Form 4 insider trade URLs.
* **Neural Search (Exa, Serper, Tavily)**: Audited executive degrees, alma mater, prior companies, and verified LinkedIn profiles.
* **Open Knowledge APIs (Free)**: Google News RSS, Reddit RSS, Google Patents, Google Trends, YouTube Keynotes, OpenAlex Institution/Author API, Wikidata Knowledge Graph, ORCID, Google Scholar.

### 3. 4-Tier Seniority Classification
1. `c_suite` (CEO, CIO, CTO, CFO, President, Founder, CMO, COO)
2. `vp_level` (SVP, EVP, VP, Global Head of)
3. `director_level` (Managing Director, Senior Director, Director)
4. `manager_level` (Senior Manager, Lead, Manager)

### 4. Dual Output + Database Sync
* **Artifact 1**: `output/<company>_enriched.json` — Master account dossier, LOBs, nested org tree, and AI persona profiles.
* **Artifact 2**: `output/<company>_social_and_content.json` — Official Scraping Launchpad containing all verified target URLs for downstream scrapers.
* **Artifact 3**: **PostgreSQL Database (`sales_ai`)** — Automatic UPSERT into 4 relational tables (`accounts`, `lobs`, `sub_lobs`, `personas`).

---

## 🗄️ Database Schema (4 Tables, 168 Columns)

| Table | Columns | Description |
|:---|:---:|:---|
| **`accounts`** | **89** | Identity, firmographics, financials, IPO/SEC data, web growth, 15 target URLs, and PostgreSQL arrays (`industries[]`, `founders[]`, `regions[]`, `aliases[]`). |
| **`lobs`** | **17** | Lines of Business / subsidiaries with 5 LOB-level scraping target URLs (News, Reddit, Patents, Trends, YouTube). |
| **`sub_lobs`** | **4** | Nested sub-divisions with JSONB metadata. |
| **`personas`** | **58** | Contact details, 4-tier seniority, 18 scraping URLs, and AI dossiers (`degree`, `institution`, `skills[]`, `target_kpis[]`, `operational_pain_points[]`, `key_objections[]`). |

---

## 🛠️ Quick Start & Installation

### 1. Prerequisites
* Python 3.10+
* PostgreSQL

### 2. Install Dependencies
```bash
pip install -r requirements.txt
```

### 3. Configure Environment
Copy the template and add your API keys:
```bash
cp .env.example .env
```

### 4. Initialize Database Tables
```bash
python db/create_tables.py
```

### 5. Run Full Pipeline for a Target Company
```bash
python main.py --name "BlackRock" --url "https://www.blackrock.com"
```
