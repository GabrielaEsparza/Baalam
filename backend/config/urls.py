from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import HttpResponse, JsonResponse
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


def assetlinks(request):
    """/.well-known/assetlinks.json: Android verifica que la app de la Play Store y esta web son del
    mismo dueño, y así la abre a pantalla completa (sin barra del navegador)."""
    data = [
        {
            "relation": ["delegate_permission/common.handle_all_urls"],
            "target": {
                "namespace": "android_app",
                "package_name": settings.ANDROID_PACKAGE,
                "sha256_cert_fingerprints": settings.ASSETLINKS_SHA256,
            },
        }
    ]
    resp = JsonResponse(data, safe=False)
    resp["Cache-Control"] = "public, max-age=3600"
    return resp


urlpatterns = [
    path(".well-known/assetlinks.json", assetlinks),
    path("admin/", admin.site.urls),
    path("api/", api.urls),
]
if settings.DEBUG and not settings.MEDIA_IN_DB:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
else:
    # Producción: fotos guardadas en la base de datos, solo con sesión iniciada.
    urlpatterns += [re_path(r"^media/(?P<path>.+)$", serve_media)]
urlpatterns += [re_path(r"^(?!api/|admin/|static/|media/|\.well-known/).*$", spa)]
