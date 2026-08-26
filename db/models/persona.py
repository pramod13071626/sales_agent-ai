"""Persona ORM Model — 58 columns. Executives with scraping URLs, AI dossier, skills, KPIs."""

from sqlalchemy import Column, Integer, String, Text, ForeignKey, ARRAY
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from db.models.base import Base


class Persona(Base):
    __tablename__ = "personas"

    # ── Primary Key & Foreign Keys ──
    id = Column(Integer, primary_key=True, autoincrement=True)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    lob_id = Column(Integer, ForeignKey("lobs.id", ondelete="SET NULL"), nullable=True)

    # ── Person Identity ──
    external_id = Column(String(255))
    key = Column(String(255))
    display_name = Column(String(500))
    full_name = Column(String(500))
    first_name = Column(String(255))
    last_name = Column(String(255))
    title = Column(String(500))
    tier = Column(String(100))
    seniority_raw = Column(String(100))
    departments = Column(ARRAY(Text))
    email = Column(String(255))
    email_status = Column(String(100))
    phone = Column(String(100))
    linkedin_url = Column(Text)
    crunchbase_permalink = Column(String(255))
    city = Column(String(255))
    state = Column(String(255))
    country = Column(String(255))
    source = Column(String(255))
    hierarchy_level = Column(Integer)
    decision_authority = Column(String(100))
    budget_authority = Column(String(100))
    raw_data = Column(JSONB)

    # ── Person Scraping URLs ──
    twitter_handle = Column(String(100))
    twitter_live_url = Column(Text)
    reddit_query = Column(Text)
    reddit_rss_url = Column(Text)
    sec_cik = Column(String(20))
    sec_insider_trades_url = Column(Text)
    news_query = Column(Text)
    rss_url = Column(Text)
    patents_query = Column(Text)
    google_patents_url = Column(Text)
    google_scholar_url = Column(Text)
    openalex_author_url = Column(Text)
    orcid_search_url = Column(Text)
    wikidata_person_url = Column(Text)
    youtube_interviews_url = Column(Text)
    podcast_search_url = Column(Text)
    google_trends_url = Column(Text)
    youtube_channel_id = Column(String(100))

    # ── Persona Dossier ──
    degree = Column(String(100))
    institution = Column(String(500))
    prior_company = Column(String(500))
    communication_style = Column(Text)
    engagement_rate = Column(String(50))
    value_proposition = Column(Text)
    personalized_icebreaker = Column(Text)
    social_platform = Column(String(50))
    social_profile_url = Column(Text)
    social_presence_level = Column(String(100))

    # ── Array Fields ──
    skills = Column(ARRAY(Text))
    target_kpis = Column(ARRAY(Text))
    operational_pain_points = Column(ARRAY(Text))
    key_objections = Column(ARRAY(Text))

    # ── Relationships ──
    account = relationship("Account", back_populates="personas")
    lob = relationship("Lob", back_populates="personas")

    def __repr__(self):
        return f"<Persona(id={self.id}, full_name='{self.full_name}', tier='{self.tier}')>"
