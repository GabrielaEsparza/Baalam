import encodings.idna  # noqa: F401  # antes de fork(): Django lo usa al leer el Host
import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
application = get_wsgi_application()
