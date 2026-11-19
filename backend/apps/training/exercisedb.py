"""Único punto de contacto con ExerciseDB V1 (versión gratuita).

- Nadie más llama a la API externa: el frontend pasa por /api/coach/exercises/*.
- Todo se guarda en caché (el plan gratuito tiene límites estrictos: Cloudflare 1015).
- Los miembros nunca llegan aquí: leen de nuestra tabla `Exercise`.
Si mañana cambias de proveedor, solo se toca este archivo.

Licencia: el plan gratuito es para uso personal / educativo / no comercial y pide
atribución a AscendAPI. Antes de abrir la app comercialmente hay que revisar el plan.
"""
import hashlib
import json
import logging

import requests
from django.conf import settings
from django.core.cache import cache

from apps.accounts.services import ServiceError

log = logging.getLogger(__name__)
TIMEOUT = 12
LIST_TTL = 60 * 60 * 24  # 1 día
STATIC_TTL = 60 * 60 * 24 * 7  # 1 semana (filtros y detalle casi no cambian)
STALE_TTL = 60 * 60 * 24 * 30  # copia de respaldo si la API falla


def _base() -> str:
    return settings.EXERCISEDB_BASE_URL.rstrip("/")


def _key(path: str, params: dict | None) -> str:
    raw = path + json.dumps(params or {}, sort_keys=True)
    return "exdb:" + hashlib.sha1(raw.encode()).hexdigest()


def _get(path: str, params: dict | None = None, ttl: int = LIST_TTL) -> dict:
    key = _key(path, params)
    hit = cache.get(key)
    if hit is not None:
        return hit
    try:
        r = requests.get(f"{_base()}{path}", params=params, timeout=TIMEOUT, headers={"User-Agent": "baalam-gym/1.0"})
    except requests.RequestException as e:
        log.warning("ExerciseDB sin conexión: %s", e)
        return _stale_or_raise(key, "No se pudo conectar con el catálogo de ejercicios. Intenta de nuevo.")
    if r.status_code == 429 or "1015" in r.text[:40]:
        return _stale_or_raise(key, "El catálogo está recibiendo muchas consultas. Espera un minuto y vuelve a intentar.")
    if r.status_code == 404:
        raise ServiceError("Ejercicio no encontrado en el catálogo.", "not_found", 404)
    try:
        r.raise_for_status()
        data = r.json()
    except (requests.HTTPError, ValueError):
        log.warning("ExerciseDB respondió %s: %s", r.status_code, r.text[:200])
        return _stale_or_raise(key, "El catálogo de ejercicios no respondió bien. Intenta más tarde.")
    if not data.get("success", True):
        return _stale_or_raise(key, "El catálogo de ejercicios no respondió bien. Intenta más tarde.")
    cache.set(key, data, ttl)
    cache.set(key + ":stale", data, STALE_TTL)
    return data


def _stale_or_raise(key: str, msg: str) -> dict:
    stale = cache.get(key + ":stale")
    if stale is not None:
        return stale
    raise ServiceError(msg, "catalog_unavailable", 503)


def normalize(raw: dict) -> dict:
    """No todos los ejercicios traen los mismos campos: todo con valores por defecto."""
    steps = [str(s) for s in (raw.get("instructions") or [])]
    # "Step:1 Haz esto" -> "Haz esto"
    steps = [s.split(" ", 1)[1] if s.lower().startswith("step:") and " " in s else s for s in steps]
    return {
        "external_id": str(raw.get("exerciseId") or raw.get("id") or ""),
        "name": str(raw.get("name") or "").strip(),
        "gif_url": raw.get("gifUrl") or "",
        "body_parts": list(raw.get("bodyParts") or []),
        "equipments": list(raw.get("equipments") or []),
        "target_muscles": list(raw.get("targetMuscles") or []),
        "secondary_muscles": list(raw.get("secondaryMuscles") or []),
        "instructions": steps,
    }


def search(*, name: str = "", body_part: str = "", equipment: str = "", cursor: str = "", limit: int = 24) -> dict:
    params: dict = {"limit": max(1, min(limit, 25))}
    if name.strip():
        params["name"] = name.strip().lower()
    if body_part:
        params["bodyParts"] = body_part
    if equipment:
        params["equipments"] = equipment
    if cursor:
        params["after"] = cursor
    data = _get("/exercises", params)
    meta = data.get("meta") or {}
    return {
        "items": [normalize(x) for x in data.get("data") or [] if isinstance(x, dict)],
        "total": meta.get("total"),
        "next_cursor": meta.get("nextCursor") if meta.get("hasNextPage") else None,
    }


def get(external_id: str) -> dict:
    data = _get(f"/exercises/{external_id}", ttl=STATIC_TTL)
    raw = data.get("data") if isinstance(data.get("data"), dict) else data
    item = normalize(raw or {})
    if not item["external_id"]:
        raise ServiceError("Ejercicio no encontrado en el catálogo.", "not_found", 404)
    return item


def filters() -> dict:
    def names(path):
        try:
            return sorted(x["name"] for x in _get(path, ttl=STATIC_TTL).get("data") or [] if x.get("name"))
        except ServiceError:
            return []

    return {"body_parts": names("/bodyparts"), "equipments": names("/equipments")}
