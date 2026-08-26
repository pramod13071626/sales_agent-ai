# Enterprise Sales AI Intelligence Pipeline

Autonomous, multi-source enterprise intelligence engine designed to discover account firmographics, subsidiaries/LOBs, 4-tier organizational hierarchies, AI persona dossiers, and official scraping target URLs with dual output to date-partitioned JSON slices and PostgreSQL.

---

## 📑 Table of Contents
1. [End-to-End Master Architecture Flowchart](#1-end-to-end-master-architecture-flowchart)
2. [Multi-Tier Entity Hierarchy & Relational Mapping](#2-multi-tier-entity-hierarchy--relational-mapping)
3. [Multi-Source Data Ingestion Flowchart](#3-multi-source-data-ingestion-flowchart)
4. [Self-Healing Folder & Company-Namespaced Slicing](#4-self-healing-folder--company-namespaced-slicing)
5. [Pre-DB Quality Auditor & Gatekeeper Decision Flow](#5-pre-db-quality-auditor--gatekeeper-decision-flow)
6. [REST API & Frontend UI 2-Button Workflow](#6-rest-api--frontend-ui-2-button-workflow)
7. [Database Schema (4 Relational Tables)](#7-database-schema-4-relational-tables)
8. [Quick Start & Installation](#8-quick-start--installation)

---

## 1. 🔄 End-to-End Master Architecture Flowchart

```mermaid
flowchart TD
    START(["🚀 Pipeline Trigger: python main.py --name Company"]) --> L1

    subgraph S1 ["1️⃣ LEVEL 1: ACCOUNT INTELLIGENCE"]
        L1["🏛️ Crunchbase 89 Firmographics & Funding<br>🏛️ Diffbot DKG: Tech Stack, Competitors, Board<br>🏛️ GLEIF (G20): LEI & Global Ownership Graph<br>🏛️ SEC EDGAR: 10-K Chunks & Exhibit 21<br>🏛️ USPTO / data.gov: Patents & Abstracts<br>🏛️ Wikipedia & DBpedia Summary<br>🏛️ OpenFEC Political Giving Disclosures"]
    end

    L1 --> L2
    subgraph S2 ["2️⃣ LEVEL 2: LOBS & SUBSIDIARIES DISCOVERY"]
        L2["🏢 Multi-Source Subsidiary Merge:<br>   • Crunchbase Sub-orgs<br>   • SEC Form 10-K Exhibit 21<br>   • GLEIF Level 2 Child Entities<br>   • Diffbot Subsidiaries<br>🏢 Dedicated Website Domains Resolved<br>🏢 Tavily AI: Audited Segment Revenue & Headcount<br>🏢 Dedicated LOB 4-Tier Hierarchy (lob_id = LOB_ID)"]
    end

    L2 --> L3
    subgraph S3 ["3️⃣ LEVEL 3: DEEP PERSONAS & 4-TIER ORG HIERARCHY"]
        L3["👤 Apollo.io & Monid MCP: 4-Tier Org Hierarchy<br>👤 Relational Tags: Corporate (lob_id=NULL) vs LOB (lob_id=LOB_ID)<br>👤 Compulsory 18 Target URLs (News, Reddit, Twitter, SEC, Scholar)<br>👤 Exa Neural AI Dossiers (Degrees, Prior Employers, KPIs, Icebreakers)<br>👤 OpenFEC Executive Political Giving"]
    end

    L3 --> STAGE
    subgraph S4 ["4️⃣ COMPANY-NAMESPACED SLICED STAGING & PRE-DB AUDITOR"]
        STAGE["📦 Staged in output/YYYY-MM-DD/run_id/<br>├── raw/ (apify, apollo, sec_edgar, gleif, uspto, exa, tavily, diffbot)<br>└── enriched/<br>    ├── master_enriched.json & social.json<br>    ├── lobs/company_slug/ (company_lob_enriched.json)<br>    ├── personas/company_slug/ (company_lob_person_enriched.json)<br>    └── Validation Report (Score 0-100%, Grade A/B/C/D)<br>⛔ STOPS SAFELY (Zero Auto DB Writes)"]
    end

    STAGE --> UI
    subgraph S5 ["5️⃣ FRONTEND UI 2-BUTTON APPROVAL GATE"]
        UI["🖥️ UI Displays Staged Data across Tabs 1, 2, 3, 4"]
        UI --> B1["🔘 Button 1: 'Validate' (Inspect Scores & Warnings)"]
        UI --> B2["🔘 Button 2: 'Dump to DB' (User Confirmation)"]
        B2 --> DB[("🗄️ PostgreSQL (sales_ai)<br>accounts | lobs | sub_lobs | personas")]
    end

    classDef s1 fill:#e3f2fd,stroke:#1565c0,stroke-width:2px;
    classDef s2 fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px;
    classDef s3 fill:#fff3e0,stroke:#e65100,stroke-width:2px;
    classDef s4 fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px;
    classDef s5 fill:#fce4ec,stroke:#c2185b,stroke-width:2px;

    class S1 s1;
    class S2 s2;
    class S3 s3;
    class S4 s4;
    class S5 s5;
```

---

## 2. 🏛️ Multi-Tier Entity Hierarchy & Relational Mapping

```mermaid
graph TD
    ACC["🏛️ PARENT ACCOUNT (Level 1)<br>The Bank of New York Mellon Corporation (BNY)<br>• CIK: 0001390777 | LEI: 5493006V4V6Z7KWB1G87<br>• Ticker: BNY (NYSE) | HQ: New York, US"]

    ACC --> CORP_P["👤 Corporate Group Leadership<br>(account_id = BNY_ID, lob_id = NULL)"]
    CORP_P --> P1["Robin Vince (Group CEO)"]
    CORP_P --> P2["Frank Cooper III (Group CMO)"]
    CORP_P --> P3["Dermot McDonogh (Group CFO)"]

    ACC --> LOB1["🏢 LOB 1: Insight Investment<br>(insight-investment.com)<br>• Segment Revenue: Tavily / 10-K<br>• Relationship: Subsidiary"]
    ACC --> LOB2["🏢 LOB 2: Newton Investment<br>(newtonim.com)<br>• Segment Revenue: Tavily / 10-K<br>• Relationship: Subsidiary"]
    ACC --> LOB3["🏢 LOB 3: Walter Scott<br>(walter-scott.com)<br>• Segment Revenue: Tavily / 10-K<br>• Relationship: Subsidiary"]

    LOB1 --> LOB1_P["👤 LOB 1 Leadership<br>(account_id = BNY_ID, lob_id = LOB1_ID)"]
    LOB1_P --> P4["Abdallah Nauphal (CEO, Insight)"]
    LOB1_P --> P5["Angus Woolhouse (Global Head Distribution)"]

    LOB2 --> LOB2_P["👤 LOB 2 Leadership<br>(account_id = BNY_ID, lob_id = LOB2_ID)"]
    LOB2_P --> P6["Euan Munro (CEO, Newton)"]

    LOB3 --> LOB3_P["👤 LOB 3 Leadership<br>(account_id = BNY_ID, lob_id = LOB3_ID)"]
    LOB3_P --> P7["Jane Fraser (Executive Director, Walter Scott)"]

    classDef accNode fill:#e3f2fd,stroke:#1565c0,stroke-width:2px;
    classDef lobNode fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px;
    classDef personNode fill:#fff3e0,stroke:#e65100,stroke-width:2px;

    class ACC accNode;
    class LOB1,LOB2,LOB3 lobNode;
    class CORP_P,LOB1_P,LOB2_P,LOB3_P,P1,P2,P3,P4,P5,P6,P7 personNode;
```

---

## 3. 🌐 Multi-Source Data Ingestion Flowchart

```mermaid
flowchart LR
    subgraph SOURCES ["📡 10+ Ingestion Vendors & Registries"]
        APIFY["Crunchbase (Apify)"]
        DIFFBOT["Diffbot Knowledge Graph"]
        GLEIF["GLEIF G20 LEI Database"]
        SEC["SEC EDGAR (10-K & EX-21)"]
        USPTO["USPTO & data.gov (Patents)"]
        WIKI["Wikipedia & DBpedia"]
        FEC["OpenFEC (Campaign Giving)"]
        TAVILY["Tavily AI (Financial Search)"]
        APOLLO["Apollo.io / Monid MCP"]
        EXA["Exa.ai (Neural Search)"]
    end

    subgraph PIPELINE ["⚙️ Intelligence Collector Engine"]
        C_ACC["Account Collector<br>• Firmographics<br>• Ownership Graph<br>• Patents & 10-K Chunks"]
        C_LOB["LOB Collector<br>• Subsidiary Deduplication<br>• Segment Revenues<br>• Domain Resolution"]
        C_PER["Persona Collector<br>• 4-Tier Org Hierarchy<br>• 18 Scraping URLs<br>• Neural AI Dossiers"]
    end

    APIFY & DIFFBOT & GLEIF & SEC & USPTO & WIKI & FEC --> C_ACC
    APIFY & SEC & GLEIF & DIFFBOT & TAVILY --> C_LOB
    APOLLO & EXA & FEC --> C_PER

    classDef src fill:#f3e5f5,stroke:#6a1b9a,stroke-width:1px;
    classDef eng fill:#e0f2f1,stroke:#00695c,stroke-width:2px;

    class APIFY,DIFFBOT,GLEIF,SEC,USPTO,WIKI,FEC,TAVILY,APOLLO,EXA src;
    class C_ACC,C_LOB,C_PER eng;
```

---

## 4. 📂 Self-Healing Folder & Company-Namespaced Slicing

```mermaid
graph TD
    ROOT["output/"] --> DATE["YYYY-MM-DD/ (e.g. 2026-08-25)"]
    DATE --> RUN["bny_200728/ (Run Partition)"]

    RUN --> RAW["raw/ (Untouched API Responses)"]
    RAW --> R1["apify/"]
    RAW --> R2["apollo/"]
    RAW --> R3["sec_edgar/"]
    RAW --> R4["exa/"]
    RAW --> R5["tavily/"]

    RUN --> ENR["enriched/ (Structured Enriched Layer)"]
    ENR --> M1["bny_enriched_20260825_200728.json (Master)"]
    ENR --> M2["bny_social_and_content_20260825_200728.json (18 URLs)"]
    ENR --> M3["bny_validation_report_20260825_200728.json (Audit)"]

    ENR --> LOBS["lobs/bny/ (LOB Slices)"]
    LOBS --> L1["bny_insight_investment_enriched.json"]
    LOBS --> L2["bny_newton_investment_management_enriched.json"]
    LOBS --> L3["bny_walter_scott_enriched.json"]

    ENR --> PERS["personas/bny/ (Persona Slices)"]
    PERS --> P1["bny_corporate_robin_vince_enriched.json"]
    PERS --> P2["bny_corporate_frank_cooper_iii_enriched.json"]
    PERS --> P3["bny_insight_investment_abdallah_nauphal_enriched.json"]
```

---

## 5. 🔍 Pre-DB Quality Auditor & Gatekeeper Decision Flow

```mermaid
flowchart TD
    DOC["📦 Staged JSON Document Generated"] --> VAL["🔍 DataQualityValidator.audit_run()"]

    subgraph CHECKS ["20+ Rigorous Integrity Checks"]
        C1["Account Checks: Legal Name, Domain, SEC CIK, Location, 15 URLs"]
        C2["LOB Checks: Subsidiary Names, Valid Domains, Segment Revenues"]
        C3["Hierarchy Checks: C-Suite, VPs, Directors, Managers Breakdown"]
        C4["Persona Checks: Full Names, Verified LinkedIn, 18 Target URLs"]
        C5["Dossier Checks: Verified Degrees, Prior Employers, KPIs, Icebreakers"]
    end

    VAL --> CHECKS
    CHECKS --> SCORE["📊 Calculate Overall Quality Score (0 - 100%)"]

    SCORE --> G1{"Score >= 80% ?"}
    G1 -- Yes --> GRADE_A["Grade: A or B (Ready for DB Dump)"]
    G1 -- No --> GRADE_C["Grade: C or D (Warnings Logged)"]

    GRADE_A & GRADE_C --> REPORT["📄 Output Validation Report JSON"]
    REPORT --> STOP["⛔ STOPS SAFELY (Zero Auto DB Writes)"]
```

---

## 6. 🖥️ REST API & Frontend UI 2-Button Workflow

```mermaid
sequenceDiagram
    autonumber
    actor User as Frontend User
    participant UI as React / Web UI
    participant API as FastAPI Backend (/api)
    participant Engine as Pipeline Collectors
    participant DB as PostgreSQL (sales_ai)

    User->>UI: 1. Enters "BNY" & Clicks "Fetch Account"
    UI->>API: POST /api/account/fetch
    API->>Engine: Runs Level 1 Collectors (Crunchbase, Diffbot, GLEIF, SEC, USPTO)
    Engine-->>API: Staged Account Data
    API-->>UI: Staged JSON Payload (Render Tab 1)

    User->>UI: 2. Clicks "Validate" (Tab 1)
    UI->>API: POST /api/account/validate
    API-->>UI: Validation Score & Warning Diagnostics

    User->>UI: 3. Clicks "Dump to DB" (Tab 1)
    UI->>API: POST /api/account/dump-db
    API->>DB: UPSERT INTO accounts
    DB-->>API: Success (account_id = 1)
    API-->>UI: Confirmed (Badge: Database Synced)

    User->>UI: 4. Clicks "Fetch LOBs" (Tab 2)
    UI->>API: POST /api/lobs/fetch
    API->>Engine: Runs Level 2 (Sublobs, SEC EX-21, GLEIF Children, Tavily)
    Engine-->>API: Staged 10 LOB Slices
    API-->>UI: Render 10 LOB Cards

    User->>UI: 5. Clicks "Fetch Persona Card" (Tab 4)
    UI->>API: POST /api/personas/fetch
    API->>Engine: Generates 18 URLs + Exa Neural AI Dossier
    Engine-->>API: Staged Persona Slice (Auto-saved in personas/bny/)
    API-->>UI: Render AI Executive Dossier Modal
```

---

## 7. 🗄️ Database Schema (5 Relational Tables)

| Table | Columns | Primary / Foreign Keys | Description |
|:---|:---:|:---|:---|
| **`accounts`** | **89** | `id` (PK), `key` (Unique) | Corporate identity, 89 firmographics, CIK/Ticker, LEI, funding, locations, 15 target URLs, and PostgreSQL arrays (`industries[]`, `founders[]`, `regions[]`, `aliases[]`). |
| **`lobs`** | **17** | `id` (PK), `account_id` (FK ➔ `accounts.id`) | Lines of business / subsidiaries with dedicated website domains, audited segment revenues, operating heads, and 5 LOB scraping URLs. |
| **`sub_lobs`** | **4** | `id` (PK), `lob_id` (FK ➔ `lobs.id`) | Nested sub-divisions and division metadata. |
| **`personas`** | **58** | `id` (PK), `account_id` (FK), `lob_id` (FK nullable) | Contacts classified across 4 tiers (C-Suite, VP, Director, Manager), direct emails, verified LinkedIn, 18 target scraping URLs, and 3-Tier AI dossiers. |
| **`pipeline_runs`** | **19** | `id` (PK), `run_id` (Unique Index) | Execution telemetry, billable API credits breakdown (Apify, Diffbot, Tavily, Exa, Apollo), quality scores, duration, entity counters, and full chronological event logs. |

---

## 8. 🛠️ Quick Start & Installation

### 1. Prerequisites
* Python 3.10+
* PostgreSQL running locally or on Cloud (Neon/AWS RDS)

### 2. Install Dependencies
```bash
pip install -r requirements.txt
```

### 3. Configure Environment
Copy `.env.example` to `.env` and provide your credentials:
```bash
# PostgreSQL Database Configuration
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sales_ai

# API Tokens
APIFY_TOKEN=your_apify_token
TAVILY_API_KEY=your_tavily_key
EXA_API_KEY=your_exa_key
FIRECRAWL_API_KEY=your_firecrawl_key
SERPER_API_KEY=your_serper_key
DATA_GOV_API_KEY=your_data_gov_key
DIFFBOT_TOKEN=your_diffbot_token
MONID_API_KEY=your_monid_key
```

### 4. Initialize Database Tables
```bash
python db/create_tables.py
```

### 5. Start Granular FastAPI Backend Server
```bash
python api.py
# Server runs on: http://localhost:8000
# Interactive Swagger Documentation: http://localhost:8000/docs
```

### 6. Run Complete Composite Pipeline via CLI
```bash
python main.py --name "The Bank of New York Mellon Corporation" --url "https://www.bny.com"
```
