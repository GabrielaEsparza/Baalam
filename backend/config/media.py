"""Archivos subidos (fotos de perfil, fotos/videos de ejercicios) en producción.

Se leen del storage configurado (en producción, la base de datos). Solo para personas con
sesión iniciada. Soporta peticiones por rangos (Range), que Safari en iPhone exige para
reproducir videos. Los nombres cambian al reemplazar un archivo, así que el navegador puede
guardarlos en caché sin riesgo de mostrar la versión vieja.
"""
import mimetypes
import posixpath
import re
import zlib

from django.core.files.storage import default_storage
from django.http import Http404, HttpResponse, HttpResponseNotModified, StreamingHttpResponse

# Solo estas carpetas son visibles; lo demás (p. ej. fotos de progreso) nunca se sirve por aquí.
PUBLIC_DIRS = ("avatars", "exercises", "announcements")
_RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")
CHUNK = 4 * 1024 * 1024  # máximo por respuesta parcial: el navegador pide el resto después


def _read(name: str, start: int, length: int) -> bytes:
    if hasattr(default_storage, "read_range"):
        return default_storage.read_range(name, start, length)
    with default_storage.open(name, "rb") as fh:
        fh.seek(start)
        return fh.read(length)


def serve_media(request, path: str):
    if not request.user.is_authenticated:
        return HttpResponse(status=401)
    name = posixpath.normpath(path)
    folder, _, base = name.partition("/")
    if name.startswith(("/", "..")) or folder not in PUBLIC_DIRS or not base or "/" in base:
        raise Http404
    try:
        size = default_storage.size(name)
    except (FileNotFoundError, OSError):
        raise Http404
    etag = f'"{zlib.crc32(name.encode()):x}-{size}"'
    if request.headers.get("If-None-Match") == etag:
        return HttpResponseNotModified()

    ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
    m = _RANGE.match(request.headers.get("Range", ""))
    if m and (m[1] or m[2]):
        if m[1]:
            start, end = int(m[1]), min(int(m[2]) if m[2] else size - 1, size - 1)
        else:  # últimos N bytes
            start, end = max(size - int(m[2]), 0), size - 1
        end = min(end, start + CHUNK - 1)
        if start > end or start >= size:
            resp = HttpResponse(status=416)
            resp["Content-Range"] = f"bytes */{size}"
            return resp
        resp = HttpResponse(_read(name, start, end - start + 1), status=206, content_type=ctype)
        resp["Content-Range"] = f"bytes {start}-{end}/{size}"
    elif size > CHUNK:
        # Archivo grande sin Range: se manda por pedazos para no cargarlo entero en memoria.
        resp = StreamingHttpResponse((_read(name, i, CHUNK) for i in range(0, size, CHUNK)), content_type=ctype)
        resp["Content-Length"] = str(size)
    else:
        resp = HttpResponse(_read(name, 0, size), content_type=ctype)
    resp["Accept-Ranges"] = "bytes"
    resp["ETag"] = etag
    resp["Cache-Control"] = "private, max-age=2592000"
    return resp
