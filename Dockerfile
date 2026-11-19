# --- Etapa 1: build de React ---
FROM node:22-alpine AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npx vite build

# --- Etapa 2: Django sirve API + Admin + build de React ---
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 FRONTEND_DIST=/app/frontend/dist
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=web /app/frontend/dist /app/frontend/dist
# Los estáticos (y sus versiones comprimidas .gz/.br) se preparan al construir, no en cada arranque.
RUN DEBUG=1 python manage.py collectstatic --noinput

# Barato y suficiente para un gym: 2 procesos × 4 hilos (~8 peticiones a la vez),
# --preload comparte memoria entre procesos y --max-requests recicla procesos para que la RAM no crezca.
CMD python manage.py migrate --noinput && python manage.py createcachetable && python manage.py bootstrap && \
    gunicorn config.wsgi --bind 0.0.0.0:${PORT:-8000} --preload \
      --workers ${WEB_CONCURRENCY:-2} --threads 4 --worker-class gthread \
      --max-requests 1000 --max-requests-jitter 100 --timeout 60
