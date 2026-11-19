import os
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase

from apps.memberships.models import Plan


class BootstrapTests(TestCase):
    def test_seeds_once_and_creates_coach(self):
        env = {"ADMIN_EMAIL": "Coach@Baalam.mx", "ADMIN_PASSWORD": "una-clave-larga-123", "ADMIN_NAME": "Melissa"}
        with mock.patch.dict(os.environ, env), open(os.devnull, "w") as out:
            call_command("bootstrap", stdout=out)
            Plan.objects.filter(name="Plan Clases").update(name="Clases 3x")  # la coach renombra
            call_command("bootstrap", stdout=out)
        self.assertFalse(Plan.objects.filter(name="Plan Clases").exists())  # no se vuelve a sembrar
        u = get_user_model().objects.get(username="coach@baalam.mx")
        self.assertTrue(u.check_password("una-clave-larga-123"))
        self.assertEqual(u.profile.role, "admin")
        self.assertEqual(u.profile.full_name, "Melissa")

    def test_without_env_only_seeds(self):
        with mock.patch.dict(os.environ, {"ADMIN_EMAIL": "", "ADMIN_PASSWORD": ""}), open(os.devnull, "w") as out:
            call_command("bootstrap", stdout=out)
        self.assertTrue(Plan.objects.exists())
