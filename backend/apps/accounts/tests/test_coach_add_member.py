from urllib.parse import parse_qs, urlparse

from django.test import TestCase

from apps.accounts.services import ServiceError, coach_create_member, set_role
from apps.memberships.tests.test_services import make_member


class CoachAddMemberTests(TestCase):
    def setUp(self):
        self.coach = make_member("coach@t.mx")
        set_role(self.coach, "coach")
        self.client.force_login(self.coach)

    def test_create_then_member_sets_password_and_logs_in(self):
        r = self.client.post(
            "/api/coach/members",
            {"full_name": "Rosa López", "email": "Rosa@Mail.com ", "phone": "5512345678"},
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 201, r.content)
        link = r.json()["access_link"]
        self.assertIn("/recuperar?", link)
        q = parse_qs(urlparse(link).query)

        detail = self.client.get(f"/api/coach/members/{r.json()['id']}").json()
        self.assertFalse(detail["has_password"])
        self.assertEqual(detail["membership_status"], "pending")

        # La persona abre el enlace y crea su contraseña
        self.client.logout()
        r2 = self.client.post(
            "/api/auth/password-reset/confirm",
            {"uid": q["uid"][0], "token": q["token"][0], "password": "mi-clave-segura-9"},
            content_type="application/json",
        )
        self.assertEqual(r2.status_code, 200, r2.content)
        r3 = self.client.post(
            "/api/auth/login", {"email": "rosa@mail.com", "password": "mi-clave-segura-9"}, content_type="application/json"
        )
        self.assertEqual(r3.status_code, 200)
        self.assertEqual(r3.json()["full_name"], "Rosa López")

    def test_link_only_while_without_password(self):
        r = self.client.post(
            "/api/coach/members", {"full_name": "Ana", "email": "ana2@t.mx"}, content_type="application/json"
        )
        mid = r.json()["id"]
        self.assertEqual(self.client.post(f"/api/coach/members/{mid}/access-link").status_code, 200)
        other = make_member("ya@t.mx")  # se registró sola, ya tiene contraseña
        self.assertEqual(self.client.post(f"/api/coach/members/{other.id}/access-link").status_code, 400)

    def test_validation(self):
        with self.assertRaises(ServiceError):
            coach_create_member(full_name="Ana", email="no-es-correo")
        with self.assertRaises(ServiceError):
            coach_create_member(full_name="Ana", email="coach@t.mx")  # ya existe

    def test_members_cannot_create(self):
        self.client.force_login(make_member("x@t.mx"))
        r = self.client.post("/api/coach/members", {"full_name": "Z", "email": "z@t.mx"}, content_type="application/json")
        self.assertEqual(r.status_code, 403)
