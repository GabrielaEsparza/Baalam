from django.conf import settings
from django.http import HttpResponsePermanentRedirect


class CanonicalHostMiddleware:
    """Una sola dirección pública: www.baalamgym.com y la dirección vieja de Railway redirigen a
    baalamgym.com (misma ruta). Así hay una sola sesión y un solo dominio para los avisos."""

    def __init__(self, get_response):
        self.get_response = get_response
        main = settings.CANONICAL_HOSTS[0] if settings.CANONICAL_HOSTS else None
        self.redirects = {f"www.{h}": h for h in settings.CANONICAL_HOSTS}
        if main:
            self.redirects.update({h: main for h in settings.LEGACY_HOSTS})

    def __call__(self, request):
        host = request.get_host().split(":")[0].lower()
        target = self.redirects.get(host)
        if target:
            return HttpResponsePermanentRedirect(f"https://{target}{request.get_full_path()}")
        return self.get_response(request)
