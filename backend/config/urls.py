from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import HttpResponse
from django.urls import path, re_path
from django.views.decorators.csrf import ensure_csrf_cookie

from .api import api
from .media import serve_media

admin.site.site_header = "BÁALAM GYM · Admin"
admin.site.site_title = "BÁALAM GYM"


_INDEX: str | None = None


@ensure_csrf_cookie
def spa(request):
    """Catch-all: devuelve el index.html del build de React (en memoria; sin caché del navegador)."""
    global _INDEX
    if _INDEX is None or settings.DEBUG:
        index = settings.FRONTEND_DIST / "index.html"
        if not index.exists():
            return HttpResponse(
                "Build de React no encontrado. En desarrollo usa http://localhost:5173", status=404
            )
        _INDEX = index.read_text(encoding="utf-8")
    resp = HttpResponse(_INDEX)
    resp["Cache-Control"] = "no-cache"
    return resp


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", api.urls),
]
if settings.DEBUG and not settings.MEDIA_IN_DB:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
else:
    # Producción: fotos guardadas en la base de datos, solo con sesión iniciada.
    urlpatterns += [re_path(r"^media/(?P<path>.+)$", serve_media)]
urlpatterns += [re_path(r"^(?!api/|admin/|static/|media/).*$", spa)]
