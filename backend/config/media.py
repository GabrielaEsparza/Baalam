"""Archivos subidos (fotos de perfil, fotos/videos de ejercicios) en producción.

Django no sirve /media/ con DEBUG apagado, así que esta vista lo hace, solo para personas
con sesión iniciada. Soporta peticiones por rangos (Range), que Safari en iPhone exige
para reproducir videos. Los nombres cambian al reemplazar un archivo, así que el navegador
puede guardarlos en caché sin riesgo de mostrar la versión vieja.
"""
import mimetypes
import re
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, Http404, HttpResponse, HttpResponseNotModified
from django.utils.http import http_date

# Solo estas carpetas son visibles; lo demás (p. ej. fotos de progreso) nunca se sirve por aquí.
PUBLIC_DIRS = ("avatars", "exercises", "announcements")
_RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")
CHUNK = 4 * 1024 * 1024  # máximo por respuesta parcial: el navegador pide el resto después


def serve_media(request, path: str):
    if not request.user.is_authenticated:
        return HttpResponse(status=401)
    root = Path(settings.MEDIA_ROOT).resolve()
    file = (root / path).resolve()
    if not file.is_relative_to(root) or file.parent.name not in PUBLIC_DIRS or not file.is_file():
        raise Http404
    stat = file.stat()
    etag = f'"{int(stat.st_mtime)}-{stat.st_size}"'
    if request.headers.get("If-None-Match") == etag:
        return HttpResponseNotModified()

    ctype = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
    size = stat.st_size
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
        with file.open("rb") as fh:
            fh.seek(start)
            data = fh.read(end - start + 1)
        resp = HttpResponse(data, status=206, content_type=ctype)
        resp["Content-Range"] = f"bytes {start}-{end}/{size}"
    else:
        resp = FileResponse(file.open("rb"), content_type=ctype)
    resp["Accept-Ranges"] = "bytes"
    resp["ETag"] = etag
    resp["Last-Modified"] = http_date(stat.st_mtime)
    resp["Cache-Control"] = "private, max-age=2592000"
    return resp
