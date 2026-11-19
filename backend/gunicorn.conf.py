"""Configuración de Gunicorn (se carga sola desde /app/backend).

Tareas nocturnas sin un servicio cron aparte: el proceso maestro de Gunicorn tiene un hilo
que corre `manage.py nightly` todos los días a las 02:00 (hora del gym). Si la app estuvo
apagada a esa hora, lo corre al arrancar. `nightly` es idempotente, así que repetirlo no daña.
Se desactiva con NIGHTLY_IN_WEB=0 (por ejemplo, si algún día se usa un cron de Railway).
"""
import os
import threading
import time
from datetime import timedelta

RUN_AT_HOUR = 2


def _loop(log):
    import django

    django.setup()
    from django.core.cache import cache
    from django.core.management import call_command
    from django.db import close_old_connections, connections

    from apps.common import now

    key = "nightly:last-run"

    def run(reason):
        try:
            close_old_connections()
            call_command("nightly")
            cache.set(key, now().date().isoformat(), timeout=None)
            log.info("nightly ok (%s)", reason)
        except Exception:  # noqa: BLE001
            log.exception("nightly falló (%s)", reason)
        finally:
            connections.close_all()

    # Al arrancar: si hoy ya pasaron las 02:00 y no ha corrido, ponerse al día.
    try:
        n = now()
        if n.hour >= RUN_AT_HOUR and cache.get(key) != n.date().isoformat():
            run("al arrancar")
    finally:
        connections.close_all()

    while True:
        n = now()
        target = n.replace(hour=RUN_AT_HOUR, minute=0, second=0, microsecond=0)
        if target <= n:
            target += timedelta(days=1)
        time.sleep(max(60, (target - n).total_seconds()))
        if cache.get(key) != now().date().isoformat():
            run("programado")


def when_ready(server):
    if os.environ.get("NIGHTLY_IN_WEB", "1") == "1":
        threading.Thread(target=_loop, args=(server.log,), daemon=True, name="nightly").start()
