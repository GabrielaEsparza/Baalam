from django.test import TestCase, override_settings


@override_settings(ALLOWED_HOSTS=["baalamgym.com", "www.baalamgym.com", "baalam-production.up.railway.app", "testserver"])
class CanonicalHostTests(TestCase):
    def test_www_redirects_to_main_domain(self):
        r = self.client.get("/privacidad?x=1", HTTP_HOST="www.baalamgym.com")
        self.assertEqual(r.status_code, 301)
        self.assertEqual(r["Location"], "https://baalamgym.com/privacidad?x=1")

    def test_old_railway_domain_redirects(self):
        r = self.client.get("/app", HTTP_HOST="baalam-production.up.railway.app")
        self.assertEqual(r.status_code, 301)
        self.assertEqual(r["Location"], "https://baalamgym.com/app")

    def test_headers_allow_google_popup(self):
        r = self.client.get("/api/gym", HTTP_HOST="baalamgym.com")
        self.assertEqual(r["Cross-Origin-Opener-Policy"], "same-origin-allow-popups")
        self.assertEqual(r["Referrer-Policy"], "strict-origin-when-cross-origin")

    def test_main_domain_is_served(self):
        self.assertEqual(self.client.get("/api/gym", HTTP_HOST="baalamgym.com").status_code, 200)


class AssetLinksTests(TestCase):
    @override_settings(ASSETLINKS_SHA256=["AA:BB"], ANDROID_PACKAGE="com.lumirasolutionsmx.baalamgym")
    def test_assetlinks(self):
        r = self.client.get("/.well-known/assetlinks.json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r["Content-Type"], "application/json")
        t = r.json()[0]["target"]
        self.assertEqual((t["package_name"], t["sha256_cert_fingerprints"]), ("com.lumirasolutionsmx.baalamgym", ["AA:BB"]))
