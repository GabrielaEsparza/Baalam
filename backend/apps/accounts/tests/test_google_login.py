from unittest import mock

from django.contrib.auth.models import User
from django.test import TestCase, override_settings

from apps.accounts import services
from apps.accounts.services import coach_create_member
from apps.memberships.models import MembershipRequest


def google(email="nuevo@gmail.com", verified=True, name="Ana Google"):
    return {"iss": "https://accounts.google.com", "email": email, "email_verified": verified, "name": name}


@override_settings(GOOGLE_CLIENT_ID="cliente.apps.googleusercontent.com")
class GoogleLoginTests(TestCase):
    def post(self, info):
        with mock.patch("google.oauth2.id_token.verify_oauth2_token", return_value=info):
            return self.client.post("/api/auth/google", {"credential": "token"}, content_type="application/json")

    def test_creates_account_pending_and_logs_in(self):
        r = self.post(google())
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["full_name"], "Ana Google")
        self.assertFalse(r.json()["has_password"])
        u = User.objects.get(username="nuevo@gmail.com")
        self.assertFalse(u.has_usable_password())
        self.assertTrue(MembershipRequest.objects.filter(member=u, type="signup").exists())
        self.assertEqual(self.client.get("/api/me").status_code, 200)

    def test_existing_account_created_by_coach_logs_in(self):
        u = coach_create_member(full_name="Rosa López", email="Rosa@Gmail.com")
        r = self.post(google("rosa@gmail.com", name="Otro nombre"))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["id"], u.id)
        self.assertEqual(r.json()["full_name"], "Rosa López")  # no se pisa su nombre
        self.assertEqual(User.objects.filter(username="rosa@gmail.com").count(), 1)

    def test_unverified_email_or_bad_token_rejected(self):
        self.assertEqual(self.post(google(verified=False)).status_code, 401)
        with mock.patch("google.oauth2.id_token.verify_oauth2_token", side_effect=ValueError("bad")):
            r = self.client.post("/api/auth/google", {"credential": "x"}, content_type="application/json")
        self.assertEqual(r.status_code, 401)

    def test_inactive_account_cannot_enter(self):
        u, _ = services.google_sign_in(google("baja@gmail.com"))
        u.is_active = False
        u.save()
        self.assertEqual(self.post(google("baja@gmail.com")).status_code, 403)

    @override_settings(GOOGLE_CLIENT_ID="")
    def test_disabled_without_client_id(self):
        self.assertEqual(self.post(google()).status_code, 503)
        self.assertIsNone(self.client.get("/api/gym").json()["google_client_id"])
