# CashMonitoring backend — one container, any host (Railway / Render / Fly.io).
# The host injects PORT; uvicorn binds it. All secrets come from the host's
# env-var dashboard (SUPABASE_*, OPENROUTER_API_KEY) — never from the repo.
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code plus the trained-model artifacts (committed on purpose, ~145KB) so
# /api/forecast and /api/ar/risk work on the first boot without training.
COPY app/ ./app/
COPY ml/ ./ml/
COPY models/ ./models/
COPY data/ ./data/
COPY demo_assets/ ./demo_assets/

# HOST renders the dashboard URL only if the app answers here.
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
