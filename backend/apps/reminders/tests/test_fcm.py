from unittest import mock

from django.test import TestCase, override_settings

from apps.memberships.tests.test_services import make_member
from apps.reminders import services as rs
from apps.reminders.models import FcmDevice

TOKEN = "f" * 40


class FakeResp:
    def __init__(self, status, text=""):
        self.status_code, self.text, self.ok = status, text, 200 <= status < 300


@override_settings(VAPID_PUBLIC_KEY="", VAPID_PRIVATE_KEY="")
class FcmTests(TestCase):
    def setUp(self):
        self.m = make_member("fcm@t.mx")
        self.client.force_login(self.m)

    def test_register_and_unregister_api(self):
        r = self.client.post("/api/push/fcm", {"token": TOKEN}, content_type="application/json")
        self.assertEqual(r.json()["devices"], 1)
        self.assertEqual(self.client.post("/api/push/fcm", {"token": "x"}, content_type="application/json").status_code, 400)
        self.assertEqual(self.client.get("/api/me/reminders").json()["devices"], 1)
        self.client.delete("/api/push/fcm", {"token": TOKEN}, content_type="application/json")
        self.assertFalse(FcmDevice.objects.exists())

    def test_token_moves_to_new_account(self):
        rs.register_fcm(self.m, TOKEN)
        other = make_member("otra@t.mx")
        rs.register_fcm(other, TOKEN)  # otra persona entró en el mismo celular
        self.assertEqual(FcmDevice.objects.get(token=TOKEN).user, other)

    def test_send_data_message_and_drop_uninstalled(self):
        rs.register_fcm(self.m, TOKEN)
        rs.register_fcm(self.m, "g" * 40)
        calls = []

        def post(url, json, headers, timeout):
            calls.append((url, json))
            return FakeResp(200) if json["message"]["token"] == TOKEN else FakeResp(404, "UNREGISTERED")

        with mock.patch.object(rs, "_fcm_credentials", return_value=("baalam-gym", "tok")), mock.patch("requests.post", side_effect=post):
            n = rs.send(self.m, title="Agua", body="Toma agua", url="/app", tag="water")
        self.assertEqual(n, 1)
        self.assertIn("/projects/baalam-gym/messages:send", calls[0][0])
        self.assertEqual(calls[0][1]["message"]["data"], {"title": "Agua", "body": "Toma agua", "url": "/app", "tag": "water"})
        self.assertEqual(list(FcmDevice.objects.values_list("token", flat=True)), [TOKEN])

    def test_no_credentials_sends_nothing(self):
        rs.register_fcm(self.m, TOKEN)
        with override_settings(FCM_SERVICE_ACCOUNT=""):
            rs._fcm_cache.clear()
            self.assertEqual(rs.send(self.m, title="a", body="b"), 0)
