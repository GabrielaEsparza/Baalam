"""Clientes de USDA FoodData Central y Open Food Facts.

Único lugar que habla con las APIs externas. Todo sale normalizado al mismo formato
(`Item`), con valores POR 100 g o POR 100 ml y `None` cuando el nutriente no existe
(nunca se inventa un 0). Las respuestas se guardan en caché.

Reglas de normalización (documentadas):
- USDA (Foundation / SR Legacy): la API reporta por 100 g. Energía: nutriente 208 (kcal);
  si falta, 957/958 (Atwater, kcal). Nunca se usa el 268 (kJ) como kcal.
- OFF: se usan los campos `*_100g` (por 100 g, o por 100 ml si el producto es líquido).
  Si solo hay valores por porción y la porción está en g/ml, se convierte:
  valor_100 = valor_porción × 100 / porción. Si no se puede, el producto no se usa.
  kcal: `energy-kcal_100g`; si falta, `energy_100g` (kJ) ÷ 4.184.
  Sodio: OFF lo da en gramos → × 1000 para mg.
"""
import hashlib
import json
import logging
import re
import unicodedata

import requests
from django.conf import settings
from django.core.cache import cache

from apps.accounts.services import ServiceError

log = logging.getLogger(__name__)
TIMEOUT = 12
SEARCH_TTL = 60 * 60 * 24
ITEM_TTL = 60 * 60 * 24 * 7
UA = {"User-Agent": "BaalamGym/1.0 (gym nutrition app)"}

NUTRIENTS = ("kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugars_g", "sodium_mg")


# ---------------- utilidades ----------------

def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return round(f, 3) if f >= 0 and f == f else None  # descarta negativos y NaN; quita ruido de flotantes


def _key(*parts) -> str:
    return "nutri:" + hashlib.sha1(json.dumps(parts, sort_keys=True).encode()).hexdigest()


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def is_suspicious(item: dict) -> bool:
    """Las kcal no cuadran con 4·P + 4·C + 9·G (datos de OFF a veces vienen mal)."""
    k, p, c, f = (item.get(n) for n in ("kcal", "protein_g", "carbs_g", "fat_g"))
    if None in (k, p, c, f) or not k:
        return False
    atwater = 4 * p + 4 * c + 9 * f
    return abs(k - atwater) > max(25, 0.35 * max(k, atwater))


def _get(url: str, params: dict, cache_key: str, ttl: int, source_label: str):
    hit = cache.get(cache_key)
    if hit is not None:
        return hit
    try:
        r = requests.get(url, params=params, timeout=TIMEOUT, headers=UA)
    except requests.RequestException as e:
        log.warning("%s sin conexión: %s", source_label, e)
        raise ServiceError(f"No se pudo conectar con {source_label}. Revisa tu conexión.", "source_unavailable", 503)
    if r.status_code == 429 or r.status_code == 503:
        raise ServiceError(f"{source_label} está recibiendo muchas consultas. Intenta en un minuto.", "rate_limited", 503)
    if r.status_code == 404:
        return None
    if r.status_code in (401, 403):
        log.error("%s rechazó la API key (%s)", source_label, r.status_code)
        raise ServiceError(f"{source_label} no está disponible (credenciales).", "source_auth", 503)
    try:
        r.raise_for_status()
        data = r.json()
    except (requests.HTTPError, ValueError):
        log.warning("%s respondió %s", source_label, r.status_code)
        raise ServiceError(f"{source_label} no respondió bien. Intenta más tarde.", "source_error", 503)
    cache.set(cache_key, data, ttl)
    return data


def remember(item: dict):
    cache.set(_key("item", item["source"], item["external_id"]), item, ITEM_TTL)


def recall(source: str, external_id: str) -> dict | None:
    return cache.get(_key("item", source, external_id))


# ---------------- USDA ----------------

USDA_URL = "https://api.nal.usda.gov/fdc/v1"
USDA_MAP = {
    "203": "protein_g",
    "205": "carbs_g",
    "204": "fat_g",
    "291": "fiber_g",
    "269": "sugars_g",
    "2000": "sugars_g",
    "307": "sodium_mg",
}

# USDA está en inglés: traducimos los alimentos básicos más comunes para la búsqueda.
ES_EN = {
    "platano": "banana", "banana": "banana", "manzana": "apple", "naranja": "orange", "pera": "pear",
    "uva": "grapes", "uvas": "grapes", "fresa": "strawberries", "fresas": "strawberries", "mango": "mango",
    "papaya": "papaya", "pina": "pineapple", "sandia": "watermelon", "melon": "melon cantaloupe",
    "aguacate": "avocado", "limon": "lime", "huevo": "egg whole", "huevos": "egg whole", "clara": "egg white",
    "claras": "egg white", "pollo": "chicken", "pechuga": "chicken breast", "pechuga de pollo": "chicken breast",
    "res": "beef", "carne de res": "beef", "bistec": "beef steak", "cerdo": "pork", "pescado": "fish",
    "atun": "tuna", "salmon": "salmon", "tilapia": "tilapia", "camaron": "shrimp", "camarones": "shrimp",
    "pavo": "turkey", "jamon": "ham", "arroz": "rice", "arroz blanco": "rice white cooked",
    "arroz integral": "rice brown cooked", "avena": "oats", "frijol": "beans", "frijoles": "beans",
    "lenteja": "lentils", "lentejas": "lentils", "garbanzo": "chickpeas", "garbanzos": "chickpeas",
    "tortilla": "tortilla corn", "tortilla de maiz": "tortilla corn", "tortilla de harina": "tortilla flour",
    "pan": "bread", "papa": "potato", "papas": "potato", "camote": "sweet potato", "elote": "corn sweet",
    "maiz": "corn", "pasta": "pasta cooked", "leche": "milk", "queso": "cheese", "queso panela": "cheese fresh",
    "yogurt": "yogurt plain", "yogur": "yogurt plain", "mantequilla": "butter", "aceite": "oil",
    "aceite de oliva": "olive oil", "nuez": "walnuts", "nueces": "walnuts", "almendra": "almonds",
    "almendras": "almonds", "cacahuate": "peanuts", "cacahuates": "peanuts", "crema de cacahuate": "peanut butter",
    "brocoli": "broccoli", "espinaca": "spinach", "espinacas": "spinach", "lechuga": "lettuce",
    "jitomate": "tomato", "tomate": "tomato", "zanahoria": "carrot", "pepino": "cucumber", "cebolla": "onion",
    "calabaza": "squash", "calabacita": "zucchini", "nopal": "nopales", "nopales": "nopales", "chile": "pepper",
    "pimiento": "bell pepper", "champinon": "mushrooms", "champinones": "mushrooms", "miel": "honey",
    "azucar": "sugar", "chocolate": "chocolate", "cafe": "coffee", "frijoles refritos": "refried beans",
}
WORD_ES_EN = {
    "cocido": "cooked", "cocida": "cooked", "crudo": "raw", "cruda": "raw", "asado": "roasted", "asada": "roasted",
    "frito": "fried", "frita": "fried", "hervido": "boiled", "hervida": "boiled", "integral": "whole wheat",
    "descremada": "nonfat", "entera": "whole", "natural": "plain",
}


def to_usda_query(q: str) -> str:
    s = strip_accents(q.lower()).strip()
    if s in ES_EN:
        return ES_EN[s]
    # traducción frase completa más larga primero, luego palabra por palabra
    for es in sorted(ES_EN, key=len, reverse=True):
        if re.search(rf"\b{re.escape(es)}\b", s):
            rest = re.sub(rf"\b{re.escape(es)}\b", "", s).split()
            extra = [WORD_ES_EN.get(w, "") for w in rest]
            return " ".join([ES_EN[es], *[e for e in extra if e]]).strip()
    return " ".join(WORD_ES_EN.get(w, w) for w in s.split())


def usda_normalize(f: dict) -> dict | None:
    item = {n: None for n in NUTRIENTS}
    kcal_atwater = None
    for n in f.get("foodNutrients") or []:
        num = str(n.get("nutrientNumber") or n.get("number") or (n.get("nutrient") or {}).get("number") or "")
        unit = (n.get("unitName") or (n.get("nutrient") or {}).get("unitName") or "").upper()
        val = _num(n.get("value", n.get("amount")))
        if val is None:
            continue
        if num == "208" and unit == "KCAL":
            item["kcal"] = val
        elif num in ("957", "958") and unit == "KCAL" and kcal_atwater is None:
            kcal_atwater = val
        elif num in USDA_MAP:
            key = USDA_MAP[num]
            if key == "sodium_mg" and unit == "G":
                val *= 1000
            if item[key] is None:
                item[key] = val
    if item["kcal"] is None:
        item["kcal"] = kcal_atwater
    if all(item[k] is None for k in ("kcal", "protein_g", "carbs_g", "fat_g")):
        return None
    desc = (f.get("description") or "").strip()
    out = {
        **item,
        "source": "usda",
        "external_id": str(f.get("fdcId")),
        "barcode": "",
        "name": desc[:1].upper() + desc[1:].lower() if desc.isupper() else desc,
        "brand": (f.get("brandOwner") or f.get("brandName") or "")[:120],
        "image_url": "",
        "basis_unit": "g",
        "serving_qty": None,
        "serving_label": "",
        "normalized_from": "100",
        "is_mexican": False,
        "raw": {"fdcId": f.get("fdcId"), "description": desc, "dataType": f.get("dataType")},
    }
    out["suspicious"] = is_suspicious(out)
    return out


def _usda_rank(it: dict, query: str):
    """Lo más útil primero: el nombre empieza con el alimento buscado y es 'raw'/cocido simple."""
    name = it["name"].lower()
    head = query.split()[0] if query else ""
    starts = name.startswith(head)
    processed = any(w in name for w in ("dehydrated", "powder", "dried", "frozen", "canned", "babyfood", "baby food"))
    return (not starts, processed, ", raw" not in name and "cooked" not in name, len(name))


def usda_search(q: str, page: int = 1, page_size: int = 12) -> dict:
    query = to_usda_query(q)
    params = {
        "api_key": settings.USDA_API_KEY,
        "query": query,
        "pageSize": page_size,
        "pageNumber": page,
        "dataType": "Foundation,SR Legacy",
    }
    data = _get(f"{USDA_URL}/foods/search", params, _key("usda", query, page, page_size), SEARCH_TTL, "USDA") or {}
    items = [x for x in (usda_normalize(f) for f in data.get("foods") or []) if x]
    items.sort(key=lambda it: _usda_rank(it, query))
    for it in items:
        remember(it)
    return {"items": items, "has_more": page < (data.get("totalPages") or 0), "query_used": query}


def usda_get(fdc_id: str) -> dict | None:
    data = _get(f"{USDA_URL}/food/{fdc_id}", {"api_key": settings.USDA_API_KEY}, _key("usda-food", fdc_id), ITEM_TTL, "USDA")
    return usda_normalize(data) if data else None


# ---------------- Open Food Facts ----------------

OFF_SEARCH = "https://search.openfoodfacts.org/search"
OFF_LEGACY_SEARCH = "https://world.openfoodfacts.org/cgi/search.pl"
OFF_PRODUCT = "https://world.openfoodfacts.org/api/v3/product/{code}.json"
OFF_FIELDS = (
    "code,product_name,product_name_es,generic_name_es,brands,image_front_small_url,image_small_url,"
    "nutriments,nutrition_data_per,serving_quantity,serving_quantity_unit,serving_size,quantity,countries_tags"
)
LIQUID = re.compile(r"\d\s*(ml|cl|l|lt|litros?)\b", re.I)


def _off_basis(p: dict) -> str:
    q = str(p.get("quantity") or "")
    return "ml" if LIQUID.search(q) else "g"


def off_normalize(p: dict) -> dict | None:
    code = str(p.get("code") or "").strip()
    nm = p.get("nutriments") or {}
    if not code or not nm:
        return None
    basis = _off_basis(p)

    def per100(key):
        return _num(nm.get(f"{key}_100g"))

    kcal = per100("energy-kcal")
    if kcal is None and per100("energy") is not None:
        kcal = round(per100("energy") / 4.184, 1)  # kJ → kcal
    values = {
        "kcal": kcal,
        "protein_g": per100("proteins"),
        "carbs_g": per100("carbohydrates"),
        "fat_g": per100("fat"),
        "fiber_g": per100("fiber"),
        "sugars_g": per100("sugars"),
        "sodium_mg": (per100("sodium") * 1000) if per100("sodium") is not None else None,
    }
    normalized_from = "100"
    serving = _num(p.get("serving_quantity"))
    serving_unit = (p.get("serving_quantity_unit") or basis).lower()
    if all(values[k] is None for k in ("kcal", "protein_g", "carbs_g", "fat_g")):
        # Solo por porción: convertir si la porción está en g/ml (conversión válida y documentada)
        if serving and serving > 0 and serving_unit in ("g", "ml"):
            s = {
                "kcal": _num(nm.get("energy-kcal_serving")),
                "protein_g": _num(nm.get("proteins_serving")),
                "carbs_g": _num(nm.get("carbohydrates_serving")),
                "fat_g": _num(nm.get("fat_serving")),
                "fiber_g": _num(nm.get("fiber_serving")),
                "sugars_g": _num(nm.get("sugars_serving")),
                "sodium_mg": (_num(nm.get("sodium_serving")) or 0) * 1000 if _num(nm.get("sodium_serving")) is not None else None,
            }
            if all(s[k] is None for k in ("kcal", "protein_g", "carbs_g", "fat_g")):
                return None
            values = {k: (round(v * 100 / serving, 2) if v is not None else None) for k, v in s.items()}
            normalized_from = "serving"
            basis = serving_unit
        else:
            return None
    brands = p.get("brands")
    if isinstance(brands, list):
        brands = ", ".join(brands)
    brand = (str(brands or "").split(",")[0]).strip()[:120]
    name = (p.get("product_name_es") or p.get("product_name") or p.get("generic_name_es") or "").strip()
    if not name:
        return None
    countries = p.get("countries_tags") or []
    out = {
        **values,
        "source": "off",
        "external_id": code,
        "barcode": code,
        "name": name[:200],
        "brand": brand,
        "image_url": (p.get("image_front_small_url") or p.get("image_small_url") or "")[:400],
        "basis_unit": basis,
        "serving_qty": serving if serving_unit == basis else None,
        "serving_label": str(p.get("serving_size") or "")[:60],
        "normalized_from": normalized_from,
        "is_mexican": "en:mexico" in countries,
        "raw": {k: p.get(k) for k in ("code", "product_name", "brands", "quantity", "serving_size", "nutrition_data_per")}
        | {"nutriments": {k: v for k, v in nm.items() if k.endswith(("_100g", "_serving"))}},
    }
    out["suspicious"] = is_suspicious(out)
    return out


def off_search(q: str, page: int = 1, page_size: int = 15) -> dict:
    params = {"q": q, "page": page, "page_size": page_size, "fields": OFF_FIELDS}
    try:
        data = _get(OFF_SEARCH, params, _key("off", q, page, page_size), SEARCH_TTL, "Open Food Facts") or {}
        products, page_count = data.get("hits") or [], data.get("page_count") or 0
    except ServiceError:
        # Respaldo: buscador clásico (más lento y con límites estrictos)
        legacy = {
            "search_terms": q, "search_simple": 1, "action": "process", "json": 1,
            "page": page, "page_size": page_size, "fields": OFF_FIELDS,
        }
        data = _get(OFF_LEGACY_SEARCH, legacy, _key("off-legacy", q, page, page_size), SEARCH_TTL, "Open Food Facts") or {}
        products, page_count = data.get("products") or [], data.get("page_count") or 0
    items = [x for x in (off_normalize(p) for p in products) if x]
    for it in items:
        remember(it)
    return {"items": items, "has_more": page < page_count}


def off_barcode(code: str) -> dict | None:
    code = re.sub(r"\D", "", code or "")
    if not 6 <= len(code) <= 14:
        raise ServiceError("Ese código de barras no es válido.")
    data = _get(OFF_PRODUCT.format(code=code), {"fields": OFF_FIELDS}, _key("off-code", code), ITEM_TTL, "Open Food Facts")
    if not data or data.get("status") == "failure" or not data.get("product"):
        return None
    product = {"code": code, **data["product"]}
    return off_normalize(product)


# ---------------- Unificado ----------------

def _dedupe_key(it: dict) -> str:
    norm = lambda s: re.sub(r"[^a-z0-9]", "", strip_accents((s or "").lower()))  # noqa: E731
    return f"{norm(it['name'])}|{norm(it['brand'])}"


def search(q: str, source: str = "all", page: int = 1) -> dict:
    """Combina fuentes. Prioridad: mejores genéricos de USDA, productos mexicanos de OFF,
    resto de USDA, resto de OFF. Quita duplicados (mismo código o mismo nombre+marca)."""
    q = (q or "").strip()
    if len(q) < 2:
        raise ServiceError("Escribe al menos 2 letras.")
    usda, off, errors = {"items": [], "has_more": False}, {"items": [], "has_more": False}, {}
    if source in ("all", "usda"):
        try:
            usda = usda_search(q, page)
        except ServiceError as e:
            errors["usda"] = e.message
    if source in ("all", "off"):
        try:
            off = off_search(q, page)
        except ServiceError as e:
            errors["off"] = e.message
    if source == "all":
        mx = [i for i in off["items"] if i["is_mexican"]]
        rest = [i for i in off["items"] if not i["is_mexican"]]
        ordered = usda["items"][:3] + mx + usda["items"][3:] + rest
    else:
        ordered = usda["items"] + sorted(off["items"], key=lambda i: not i["is_mexican"])
    seen, out = set(), []
    for it in ordered:
        k1, k2 = f"code:{it['barcode']}" if it["barcode"] else None, _dedupe_key(it)
        if (k1 and k1 in seen) or k2 in seen:
            continue
        seen.update(x for x in (k1, k2) if x)
        out.append(it)
    if not out and errors and len(errors) == (2 if source == "all" else 1):
        raise ServiceError(next(iter(errors.values())), "source_unavailable", 503)
    return {"items": out, "page": page, "has_more": usda["has_more"] or off["has_more"], "errors": errors}
