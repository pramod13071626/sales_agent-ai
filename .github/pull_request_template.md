## What & why

<!-- One or two sentences: what changed, and the motivation. -->

## Which app(s)

- [ ] root (`sales_ai`)
- [ ] `apps/content_pipeline`
- [ ] both / shared

## Checklist

- [ ] Tests added or updated for behavior changes
- [ ] `ruff check .` / `ruff format --check .` pass on the lines I touched (CI enforces this)
- [ ] No secrets, tokens, or `.env` values committed
- [ ] Ran the affected app locally (`python main.py ...` / `python api.py` / `uvicorn api:app`)

## Notes for the reviewer

<!-- Anything risky, out of scope on purpose, or that needs a second look. -->
