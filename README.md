# BÁALAM GYM

PWA mobile-first para el gym: el miembro registra asistencia por QR, reserva su mes, entrena y ve su progreso; el coach gestiona miembros, pagos, horarios y el QR de entrada.

- **backend/**: Django 5 + Django Ninja (API en `/api`, docs en `/api/docs`, Admin en `/admin`)
- **frontend/**: React 18 + Vite + TypeScript + Tailwind v4 (tokens de marca en `src/styles/tokens.css`)
- En producción Django sirve también el build de React: un solo servicio en Railway.

## Desarrollo local (Windows)

```bash
# Backend
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
cp .env.example .env
.venv/Scripts/python manage.py migrate
.venv/Scripts/python manage.py createcachetable   # caché del catálogo de ejercicios
.venv/Scripts/python manage.py seed          # planes, ajustes y horarios de ejemplo
.venv/Scripts/python manage.py demo          # opcional: usuarios de prueba (solo DEBUG)
.venv/Scripts/python manage.py runserver     # http://localhost:8000/api/docs

# Frontend (otra terminal)
cd frontend
npm install
npm run dev                                  # http://localhost:5173 (proxy /api → :8000)
npm run gen:api                              # regenera src/api/schema.d.ts tras cambiar la API
```

Usuarios de `demo`: `coach@demo.mx` (admin) y `karen@demo.mx`, `diego@demo.mx`, `sofia@demo.mx`… · contraseña `baalam-demo-2026`.
Para la cuenta real de Melissa: `python manage.py createsuperuser` (queda como admin).

Tests: `cd backend && .venv/Scripts/python manage.py test apps`

## Regla de oro

Toda regla de negocio vive en `apps/<app>/services.py`. `api.py` solo valida y llama a servicios; React solo muestra. Así el Admin, los cron y la API usan exactamente las mismas reglas.

## Deploy en Railway

1. Servicio **web** desde este repo (usa `Dockerfile` y `railway.json`).
2. Plantilla **Postgres** → inyecta `DATABASE_URL`.
3. Variables: `DEBUG=0`, `SECRET_KEY`, `QR_SECRET`, `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS=https://tu-dominio`, `RESEND_API_KEY`, y las del bucket (`BUCKET_NAME`, `BUCKET_ENDPOINT`, `BUCKET_ACCESS_KEY_ID`, `BUCKET_SECRET_ACCESS_KEY`).
4. **Un solo cron** (misma imagen, distinto comando, horario UTC): `0 8 * * *` → `python manage.py nightly`.
   Hace todo: vencimientos, faltas, genera horarios, abre la reserva del mes siguiente desde el día 25 y cierra
   el podio del mes anterior. (`open_month` y `close_podium` siguen existiendo para correrlos a mano.)

### Para que salga barato

- Web: 2 procesos × 4 hilos con `--preload` (variable `WEB_CONCURRENCY` para cambiarlo). Para ~200 miembros sobra.
- Los estáticos se preparan al construir la imagen, se sirven en brotli/gzip y con caché permanente (los archivos llevan hash).
- La pantalla del QR consulta cada 15 s y solo mientras está visible; el resto de la app no consulta sola.
- En Railway → Settings → Usage, pon un **límite de gasto** al proyecto.

## Estado (roadmap del documento)

| Fase | Estado |
|---|---|
| 0 · Base: tokens, componentes, barra inferior + sidebar, landing | ✅ |
| 1 · Login/registro/recuperar, aprobación, planes, pagos, membresías (pausa, gracia, por vencer) | ✅ |
| 1 · Horarios, reserva del mes, cambios con lista de espera, ocupación del coach | ✅ |
| 1 · QR de entrada (token HMAC cada 60 s + código de 6 dígitos) y check-in | ✅ |
| 1 · Peso con gráfica y objetivo, perfil (saludo, tema), podio, avisos | ✅ |
| 1 · Rutina semanal por miembro (coach → Rutinas), biblioteca con GIF de ExerciseDB, registro de series, PRs, timer de descanso, cola sin conexión | ✅ |
| 1 · Foto de perfil; el coach tiene permisos de administrador | ✅ |
| 2 · Medidas y composición corporal | ✅ |
| 2 · Nutrición: buscador (USDA + Open Food Facts), calculadora g ↔ kcal, registro por comida, objetivos, favoritos/frecuentes, código de barras | ✅ |
| 2 · Cambio de día de rutina (reponer), IMC con rangos por sexo/edad, cumpleaños en Inicio, avisos fijos en Inicio | ✅ |
| 2 · Historial de entrenamientos | pendiente |
| 3 · Fotos, reportes/CSV, push | pendiente |

## Catálogo de ejercicios (ExerciseDB)

- Solo el backend habla con `https://oss.exercisedb.dev/api/v1` (archivo `apps/training/exercisedb.py`), con caché de 1 día y copia de respaldo de 30 días.
- El plan gratuito tiene **límites estrictos** (Cloudflare responde `1015` si se abusa): por eso la búsqueda espera a que dejes de escribir y los miembros nunca consultan la API; leen la biblioteca propia.
- **Licencia:** la versión gratuita es para uso personal/educativo/no comercial y pide atribución a AscendAPI (ya aparece en la Biblioteca). Antes de cobrar a clientes con la app, contrata un plan o cambia a free-exercise-db + videos propios (solo se toca `exercisedb.py`).

## Nutrición (USDA + Open Food Facts)

- Solo el backend consulta las APIs (`apps/nutrition/sources.py`); caché de 1 día en búsquedas y 7 días por alimento.
- **USDA** (alimentos genéricos): define `USDA_API_KEY` (gratis en https://fdc.nal.usda.gov/api-key-signup). Sin ella se usa `DEMO_KEY`, que solo aguanta ~30 consultas por hora. Las búsquedas en español de alimentos básicos se traducen al inglés; los nombres de USDA se muestran en inglés.
- **Open Food Facts** (productos): sin clave. Se usa el buscador oficial `search.openfoodfacts.org` y, si falla, `cgi/search.pl`. Al elegir un producto se vuelve a pedir su ficha por código de barras (el índice de búsqueda puede estar desactualizado). Datos bajo licencia ODbL (atribución en la app).
- Todo se guarda **por 100 g o 100 ml**; un nutriente que la fuente no trae queda vacío (nunca 0). Si un producto solo trae datos por porción y la porción está en g/ml, se convierte; si no, no se usa. Si las kcal no cuadran con 4·P + 4·C + 9·G, se marca como dudoso.
- Si no hay objetivo guardado se muestra un **estimado general** (2,000 kcal de referencia de etiquetas; 20 % proteína / 50 % carbohidratos / 30 % grasa, dentro de los rangos AMDR 10–35 / 45–65 / 20–35 %). No es personalizado y no se guarda solo: el miembro lo ajusta por % o gramos, o su coach lo define (ficha del miembro → Nutrición).
- **Solo calorías:** si algo no está en la lista se registran las kcal directo (nombre y macros opcionales; lo no escrito queda sin dato). En la gráfica real, las kcal sin macros salen como "Sin desglose".
- Los **registros de comida se guardan 30 días** (`NUTRITION_RETENTION_DAYS`): el cron `nightly` borra lo más viejo y la app no deja ir más atrás. Favoritos, objetivo y catálogo de alimentos no se borran.
- Colores fijos de macros: proteína rojo, carbohidratos azul, grasa amarillo (`--macro-*` en `tokens.css`).
