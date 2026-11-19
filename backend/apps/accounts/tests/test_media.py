import shutil
import tempfile
from io import BytesIO

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image

from apps.memberships.tests.test_services import make_member
from config.media import serve_media


def jpeg():
    buf = BytesIO()
    Image.new("RGB", (800, 600), "purple").save(buf, "JPEG")
    return SimpleUploadedFile("foto.jpg", buf.getvalue(), content_type="image/jpeg")


class MediaServeTests(TestCase):
    """En producción (DEBUG=False) la foto subida se debe poder ver, solo con sesión."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.override = override_settings(MEDIA_ROOT=self.tmp)
        self.override.enable()
        self.addCleanup(self.override.disable)
        self.user = make_member("foto@t.mx")
        self.client.force_login(self.user)

    def get(self, url, **headers):
        from django.test import RequestFactory

        req = RequestFactory().get(url, headers=headers)
        req.user = self.user
        return serve_media(req, url.removeprefix("/media/"))

    def test_upload_then_visible(self):
        r = self.client.post("/api/me/avatar", {"file": jpeg()})
        self.assertEqual(r.status_code, 200, r.content)
        url = r.json()["avatar_url"]
        self.assertTrue(url.startswith("/media/avatars/"))
        resp = self.get(url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["Content-Type"], "image/jpeg")
        self.assertGreater(len(b"".join(resp.streaming_content)), 1000)

        part = self.get(url, Range="bytes=0-9")
        self.assertEqual(part.status_code, 206)
        self.assertEqual(len(part.content), 10)

    def test_requires_login_and_no_escape(self):
        from django.contrib.auth.models import AnonymousUser
        from django.http import Http404
        from django.test import RequestFactory

        req = RequestFactory().get("/media/avatars/x.jpg")
        req.user = AnonymousUser()
        self.assertEqual(serve_media(req, "avatars/x.jpg").status_code, 401)
        for bad in ("../settings.py", "progress/u1.jpg", "avatars/nope.jpg"):
            with self.assertRaises(Http404):
                self.get("/media/" + bad)
