FROM python:3.12-slim

WORKDIR /app

# Install deps first so this layer is cached across code-only changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# api.py's own __main__ block runs uvicorn with reload=True (dev
# convenience, watches the filesystem) — not appropriate in a container,
# so the entrypoint below calls uvicorn directly instead of `python api.py`.
EXPOSE 8000

# Postgres must already have its tables (see README.md: `python
# db/create_tables.py`, run once) — this image doesn't run migrations
# on start, matching how this app is set up today.
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]
