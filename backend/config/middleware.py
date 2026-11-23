from django.conf import settings
from django.http import HttpResponsePermanentRedirect


class CanonicalHostMiddleware:
    """www.baalamgym.com → baalamgym.com (una sola dirección = una sola sesión y un solo dominio de avisos).
    La dirección de Railway se deja funcionando: ahí siguen las apps ya instaladas."""

    def __init__(self, get_response):
        self.get_response = get_response
        self.redirects = {f"www.{h}": h for h in settings.CANONICAL_HOSTS}

    def __call__(self, request):
        host = request.get_host().split(":")[0].lower()
        target = self.redirects.get(host)
        if target:
            return HttpResponsePermanentRedirect(f"https://{target}{request.get_full_path()}")
        return self.get_response(request)
