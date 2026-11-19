from io import BytesIO

from django.contrib.auth.models import AnonymousUser
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.http import Http404
from django.test import RequestFactory, TestCase, override_settings
from PIL import Image

from apps.files.models import StoredFile
from apps.memberships.tests.test_services import make_member
from config import media
from config.media import serve_media

DB_STORAGE = {
    "default": {"BACKEND": "apps.files.storage.DatabaseStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}


def jpeg():
    buf = BytesIO()
    Image.new("RGB", (800, 600), "purple").save(buf, "JPEG")
    return SimpleUploadedFile("foto.jpg", buf.getvalue(), content_type="image/jpeg")


@override_settings(STORAGES=DB_STORAGE)
class MediaInDatabaseTests(TestCase):
    """Producción: la foto se guarda en Postgres (sobrevive a los deploys) y se ve solo con sesión."""

    def setUp(self):
        self.user = make_member("foto@t.mx")
        self.client.force_login(self.user)

    def get(self, url, user=None, **headers):
        req = RequestFactory().get(url, headers=headers)
        req.user = user or self.user
        return serve_media(req, url.removeprefix("/media/"))

    def test_upload_replace_and_view(self):
        r = self.client.post("/api/me/avatar", {"file": jpeg()})
        self.assertEqual(r.status_code, 200, r.content)
        url = r.json()["avatar_url"]
        self.assertTrue(url.startswith("/media/avatars/"))
        self.assertEqual(StoredFile.objects.count(), 1)

        resp = self.get(url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["Content-Type"], "image/jpeg")
        self.assertEqual(resp.content[:2], b"\xff\xd8")  # es un JPEG

        part = self.get(url, Range="bytes=2-11")
        self.assertEqual(part.status_code, 206)
        self.assertEqual(part.content, resp.content[2:12])

        # Cambiar la foto: nombre nuevo (sin caché vieja) y la anterior se borra
        url2 = self.client.post("/api/me/avatar", {"file": jpeg()}).json()["avatar_url"]
        self.assertNotEqual(url, url2)
        self.assertEqual(StoredFile.objects.count(), 1)
        with self.assertRaises(Http404):
            self.get(url)

    def test_big_file_streams_by_chunks(self):
        data = bytes(range(256)) * (media.CHUNK // 256 + 10)
        name = default_storage.save("exercises/ex1.mp4", ContentFile(data))
        resp = self.get("/media/" + name)
        self.assertEqual(b"".join(resp.streaming_content), data)
        part = self.get("/media/" + name, Range="bytes=0-")
        self.assertEqual(part.status_code, 206)
        self.assertEqual(len(part.content), media.CHUNK)

    def test_requires_login_and_no_escape(self):
        default_storage.save("progress/u1.jpg", ContentFile(b"x"))
        self.assertEqual(self.get("/media/avatars/x.jpg", user=AnonymousUser()).status_code, 401)
        for bad in ("../settings.py", "progress/u1.jpg", "avatars/nope.jpg", "avatars/../progress/u1.jpg"):
            with self.assertRaises(Http404):
                self.get("/media/" + bad)
