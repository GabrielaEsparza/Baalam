"""Corre en cada arranque (Dockerfile). Pensado para configurar producción sin terminal.

1. Si aún no hay planes, carga los datos iniciales (`seed`): planes, ajustes y horarios.
   Solo la primera vez, para no deshacer lo que la coach cambie después.
2. Si existen las variables ADMIN_EMAIL y ADMIN_PASSWORD y esa cuenta no existe, la crea
   como administradora (coach). Si ya existe no la toca: cambiar la variable NO cambia
   la contraseña. Después del primer deploy puedes borrar ADMIN_PASSWORD de Railway.
"""
import os

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import BaseCommand

from apps.accounts.models import Profile
from apps.memberships.models import Plan


class Command(BaseCommand):
    help = "Datos iniciales y cuenta de la coach (idempotente)"

    def handle(self, *args, **opts):
        if not Plan.objects.exists():
            call_command("seed")

        email = os.environ.get("ADMIN_EMAIL", "").strip().lower()
        password = os.environ.get("ADMIN_PASSWORD", "")
        if not email or not password:
            return
        User = get_user_model()
        if User.objects.filter(username=email).exists():
            self.stdout.write(f"Cuenta de coach ya existe: {email}")
            return
        user = User.objects.create_superuser(username=email, email=email, password=password)
        p = user.profile
        p.full_name = os.environ.get("ADMIN_NAME", "").strip() or email.split("@")[0]
        p.phone = os.environ.get("ADMIN_PHONE", "").strip()
        p.role = Profile.Role.ADMIN
        p.status = Profile.Status.ACTIVE
        p.save()
        self.stdout.write(self.style.SUCCESS(f"Cuenta de coach creada: {email}"))
