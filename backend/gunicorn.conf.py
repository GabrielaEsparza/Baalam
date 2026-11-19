"""Configuración de Gunicorn (se carga sola desde /app/backend).

Tareas nocturnas sin un servicio cron aparte: el proceso maestro de Gunicorn tiene un hilo
que lanza `manage.py nightly` como PROCESO APARTE todos los días a las 02:00 (hora del gym),
y una vez al arrancar por si la app estuvo apagada a esa hora. `nightly` es idempotente.

Importante: el hilo NO importa Django. Gunicorn crea los procesos de trabajo con fork(); si en
ese momento otro hilo del maestro está a medio importar módulos, los trabajadores nacen con
el sistema de imports roto (p. ej. "LookupError: unknown encoding: idna" en peticiones al azar).
Se desactiva con NIGHTLY_IN_WEB=0 (por ejemplo, si algún día se usa un cron de Railway).
"""
import os
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import encodings.idna  # noqa: F401  # cargado antes de fork(): lo usa Django al leer el Host

RUN_AT_HOUR = 2
TZ = ZoneInfo(os.environ.get("TIME_ZONE", "America/Mexico_City"))
HERE = os.path.dirname(os.path.abspath(__file__))


def _run(log, reason):
    try:
        r = subprocess.run(
            [sys.executable, "manage.py", "nightly"], cwd=HERE, capture_output=True, text=True, timeout=1800
        )
        if r.returncode == 0:
            log.info("nightly ok (%s)", reason)
        else:
            log.error("nightly falló (%s): %s", reason, (r.stderr or r.stdout)[-2000:])
    except Exception:  # noqa: BLE001
        log.exception("nightly no se pudo lanzar (%s)", reason)


def _loop(log):
    time.sleep(30)  # deja que los trabajadores arranquen primero
    _run(log, "al arrancar")
    while True:
        n = datetime.now(TZ)
        target = n.replace(hour=RUN_AT_HOUR, minute=0, second=0, microsecond=0)
        if target <= n:
            target += timedelta(days=1)
        time.sleep(max(60, (target - n).total_seconds()))
        _run(log, "programado")


def when_ready(server):
    if os.environ.get("NIGHTLY_IN_WEB", "1") == "1":
        threading.Thread(target=_loop, args=(server.log,), daemon=True, name="nightly").start()
