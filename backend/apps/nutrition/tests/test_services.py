from datetime import timedelta
from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings

from apps.accounts.services import ServiceError, set_role
from apps.common import today
from apps.memberships.tests.test_services import make_member
from apps.nutrition import services as ns
from apps.nutrition import sources
from apps.nutrition.models import Food, FoodLog

TEST_CACHE = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


def banana(**kw):
    """El ejemplo de la especificación: 89 kcal, 1.1 P, 22.8 C, 0.3 G por 100 g."""
    return Food.objects.create(
        source="usda", external_id=kw.pop("external_id", "1"), name="Plátano", kcal=89, protein_g=1.1, carbs_g=22.8, fat_g=0.3,
        fiber_g=2.6, sugars_g=None, sodium_mg=1, **kw,
    )


class CalculatorTests(TestCase):
    def test_grams_mode_matches_spec(self):
        r = ns.compute(banana(), amount=150)
        self.assertEqual((r["kcal"], r["protein_g"], r["carbs_g"], r["fat_g"]), (133.5, 1.65, 34.2, 0.45))
        self.assertEqual(r["amount"], 150)
        self.assertIsNone(r["sugars_g"])  # sin dato: None, no 0

    def test_kcal_mode_matches_spec(self):
        r = ns.compute(banana(), kcal=200)
        self.assertEqual(r["amount"], 224.7)  # ≈ 225 g
        self.assertEqual(r["kcal"], 200)
        self.assertEqual((r["protein_g"], r["carbs_g"], r["fat_g"]), (2.47, 51.24, 0.67))
        self.assertEqual(r["input_mode"], "kcal")

    def test_kcal_mode_disabled_without_valid_calories(self):
        for k in (None, 0):
            f = Food.objects.create(source="off", external_id=f"x{k}", name="Agua", kcal=k, protein_g=0)
            ok, why = ns.kcal_mode_available(f)
            self.assertFalse(ok)
            self.assertTrue(why)
            with self.assertRaises(ServiceError):
                ns.compute(f, kcal=100)

    def test_rejects_bad_amounts(self):
        f = banana()
        for kw in ({"amount": 0}, {"amount": 6000}, {}, {"amount": 10, "kcal": 10}):
            with self.assertRaises(ServiceError):
                ns.compute(f, **kw)

    def test_ml_basis_keeps_unit(self):
        f = Food.objects.create(source="off", external_id="leche", name="Leche", basis_unit="ml", kcal=62, protein_g=3.1)
        r = ns.compute(f, amount=250)
        self.assertEqual((r["unit"], r["kcal"]), ("ml", 155.0))


class NormalizationTests(TestCase):
    def test_usda_uses_kcal_not_kj_and_sodium_mg(self):
        f = {
            "fdcId": 173944, "description": "Bananas, raw", "dataType": "SR Legacy",
            "foodNutrients": [
                {"nutrientNumber": "268", "value": 371, "unitName": "kJ"},
                {"nutrientNumber": "208", "value": 89.0, "unitName": "KCAL"},
                {"nutrientNumber": "203", "value": 1.09, "unitName": "G"},
                {"nutrientNumber": "205", "value": 22.8, "unitName": "G"},
                {"nutrientNumber": "204", "value": 0.33, "unitName": "G"},
                {"nutrientNumber": "307", "value": 1.0, "unitName": "MG"},
            ],
        }
        n = sources.usda_normalize(f)
        self.assertEqual((n["kcal"], n["protein_g"], n["sodium_mg"]), (89.0, 1.09, 1.0))
        self.assertIsNone(n["fiber_g"])
        self.assertEqual(n["basis_unit"], "g")

    def test_usda_falls_back_to_atwater_kcal(self):
        f = {"fdcId": 1, "description": "x", "foodNutrients": [
            {"nutrientNumber": "957", "value": 120, "unitName": "KCAL"}, {"nutrientNumber": "203", "value": 5, "unitName": "G"}]}
        self.assertEqual(sources.usda_normalize(f)["kcal"], 120)

    def test_off_missing_values_are_none_not_zero_and_kj_conversion(self):
        p = {"code": "750100", "product_name": "Atún en agua", "brands": "Dolores", "quantity": "140 g",
             "countries_tags": ["en:mexico"],
             "nutriments": {"energy_100g": 418.4, "proteins_100g": 24, "fat_100g": 1, "sodium_100g": 0.35}}
        n = sources.off_normalize(p)
        self.assertEqual(n["kcal"], 100.0)  # 418.4 kJ ÷ 4.184
        self.assertEqual(n["sodium_mg"], 350)  # g → mg
        self.assertIsNone(n["carbs_g"])
        self.assertIsNone(n["fiber_g"])
        self.assertTrue(n["is_mexican"])
        self.assertEqual(n["brand"], "Dolores")

    def test_off_liquid_is_per_100ml(self):
        p = {"code": "1", "product_name": "Leche", "quantity": "1 L", "nutriments": {"energy-kcal_100g": 62, "proteins_100g": 3.1}}
        self.assertEqual(sources.off_normalize(p)["basis_unit"], "ml")

    def test_off_serving_only_is_converted_when_valid(self):
        p = {"code": "2", "product_name": "Barra", "serving_quantity": 50, "serving_quantity_unit": "g",
             "nutriments": {"energy-kcal_serving": 200, "proteins_serving": 20, "carbohydrates_serving": 15, "fat_serving": 7}}
        n = sources.off_normalize(p)
        self.assertEqual((n["kcal"], n["protein_g"], n["normalized_from"]), (400, 40, "serving"))
        # Porción sin cantidad en g/ml: no se puede normalizar → no se usa
        p2 = {"code": "3", "product_name": "Barra", "nutriments": {"energy-kcal_serving": 200}}
        self.assertIsNone(sources.off_normalize(p2))

    def test_off_suspicious_when_kcal_do_not_match_macros(self):
        p = {"code": "4", "product_name": "Yogurt zero", "nutriments": {
            "energy-kcal_100g": 135, "proteins_100g": 2.7, "carbohydrates_100g": 4.8, "fat_100g": 0.2}}
        self.assertTrue(sources.off_normalize(p)["suspicious"])

    def test_spanish_query_translated_for_usda(self):
        self.assertEqual(sources.to_usda_query("Plátano"), "banana")
        self.assertEqual(sources.to_usda_query("pechuga de pollo"), "chicken breast")
        self.assertEqual(sources.to_usda_query("arroz cocido"), "rice cooked")


@override_settings(CACHES=TEST_CACHE)
class SearchTests(TestCase):
    def setUp(self):
        cache.clear()

    def _item(self, src, ext, name, brand="", mx=False, code=""):
        return {"source": src, "external_id": ext, "barcode": code, "name": name, "brand": brand, "is_mexican": mx,
                "kcal": 100, "protein_g": 1, "carbs_g": 1, "fat_g": 1}

    def test_mexican_priority_dedupe_and_partial_failure(self):
        usda = {"items": [self._item("usda", str(i), f"Yogurt {i}") for i in range(5)], "has_more": False}
        off = {"items": [
            self._item("off", "111", "Yogurt griego", "Lala", mx=False, code="111"),
            self._item("off", "222", "Yogurt griego", "Lala", mx=True, code="222"),  # duplicado por nombre+marca
            self._item("off", "333", "Yogurt bebible", "Alpura", mx=True, code="333"),
        ], "has_more": True}
        with mock.patch.object(sources, "usda_search", return_value=usda), mock.patch.object(sources, "off_search", return_value=off):
            r = sources.search("yogurt")
        names = [(i["source"], i["external_id"]) for i in r["items"]]
        self.assertEqual(names[:3], [("usda", "0"), ("usda", "1"), ("usda", "2")])
        self.assertEqual(names[3:5], [("off", "222"), ("off", "333")])  # mexicanos antes del resto
        self.assertNotIn(("off", "111"), names)  # duplicado eliminado
        self.assertTrue(r["has_more"])

        with mock.patch.object(sources, "usda_search", side_effect=ServiceError("USDA caído")), mock.patch.object(
            sources, "off_search", return_value=off
        ):
            r = sources.search("yogurt")
        self.assertIn("usda", r["errors"])
        self.assertTrue(r["items"])

    def test_short_query_rejected(self):
        with self.assertRaises(ServiceError):
            sources.search("a")


class LogTests(TestCase):
    def setUp(self):
        self.m = make_member()
        self.f = banana()

    def test_add_edit_delete_and_summary(self):
        a = ns.add_log(self.m, food_id=self.f.id, meal="breakfast", amount=150)
        ns.add_log(self.m, food_id=self.f.id, meal="snack", kcal=200)
        s = ns.day_summary(self.m, today())
        self.assertEqual(s["totals"]["kcal"], 333.5)
        self.assertEqual(len(s["meals"]["breakfast"]), 1)
        self.assertTrue(s["partial"]["sugars_g"])  # el plátano no trae azúcares
        self.assertIsNone(s["remaining"]["kcal"])  # sin objetivo: no se inventa
        ns.set_goal(self.m, self.m, kcal=2000, protein_g=120)
        s = ns.day_summary(self.m, today())
        self.assertEqual(s["remaining"]["kcal"], 1666.5)
        self.assertEqual(s["goal"]["set_by"], "member")

        ns.update_log(self.m, a.id, amount=100, meal="lunch")
        a.refresh_from_db()
        self.assertEqual((a.kcal, a.meal), (89, "lunch"))
        ns.delete_log(self.m, a.id)
        self.assertEqual(FoodLog.objects.count(), 1)

    @override_settings(NUTRITION_RETENTION_DAYS=30)
    def test_logs_older_than_a_month_are_purged(self):
        t = today()
        keep = ns.add_log(self.m, food_id=self.f.id, meal="lunch", on=t - timedelta(days=30), amount=100)
        old = ns.add_log(self.m, food_id=self.f.id, meal="lunch", on=t - timedelta(days=10), amount=100)
        FoodLog.objects.filter(id=old.id).update(date=t - timedelta(days=31))
        ns.set_favorite(self.m, self.f.id, True)
        ns.set_goal(self.m, self.m, kcal=2000)
        self.assertEqual(ns.purge_old_logs(t), 1)
        self.assertEqual(list(FoodLog.objects.values_list("id", flat=True)), [keep.id])
        # Favoritos, objetivo y alimento se quedan
        self.assertEqual(ns.quick_lists(self.m)["favorites"][0]["id"], self.f.id)
        self.assertEqual(ns.goal_for(self.m)["kcal"], 2000)
        self.assertTrue(Food.objects.filter(id=self.f.id).exists())
        # No se puede registrar en un día que ya no se guarda
        with self.assertRaises(ServiceError):
            ns.add_log(self.m, food_id=self.f.id, meal="lunch", on=t - timedelta(days=31), amount=100)
        self.assertEqual(ns.day_summary(self.m, t)["oldest"], t - timedelta(days=30))

    def test_manual_kcal_without_food(self):
        log = ns.add_manual_log(self.m, meal="dinner", kcal=650, protein_g=30)
        self.assertEqual((log.food_name, log.food_id, log.input_mode), ("Calorías rápidas", None, "manual"))
        self.assertIsNone(log.carbs_g)  # no escrito = sin dato, nunca 0
        ns.add_log(self.m, food_id=self.f.id, meal="breakfast", amount=100)
        s = ns.day_summary(self.m, today())
        self.assertEqual(s["totals"]["kcal"], 739)
        self.assertEqual(s["totals"]["protein_g"], 31.1)
        self.assertEqual(s["meals"]["dinner"][0]["input_mode"], "manual")
        ns.update_manual_log(self.m, log.id, name="Tacos de la esquina", kcal=700, carbs_g=60)
        log.refresh_from_db()
        self.assertEqual((log.food_name, log.kcal, log.protein_g, log.carbs_g), ("Tacos de la esquina", 700, None, 60))
        with self.assertRaises(ServiceError):
            ns.add_manual_log(self.m, meal="dinner", kcal=0)
        with self.assertRaises(ServiceError):
            ns.update_log(self.m, log.id, amount=100)  # no hay alimento que calcular
        # No aparece en recientes/frecuentes (no hay alimento que repetir)
        self.assertEqual([f["id"] for f in ns.quick_lists(self.m)["recent"]], [self.f.id])

    def test_remove_from_frequent_until_eaten_again(self):
        for _ in range(3):
            ns.add_log(self.m, food_id=self.f.id, meal="breakfast", amount=120)
        q = ns.quick_lists(self.m)
        self.assertEqual([f["id"] for f in q["frequent"]], [self.f.id])
        ns.hide_quick(self.m, self.f.id)
        q = ns.quick_lists(self.m)
        self.assertEqual((q["frequent"], q["recent"]), ([], []))
        # Si lo vuelve a comer, regresa a Recientes; a Frecuentes hasta que lo coma 2 veces más
        ns.add_log(self.m, food_id=self.f.id, meal="lunch", amount=50)
        q = ns.quick_lists(self.m)
        self.assertEqual(([f["id"] for f in q["recent"]], q["frequent"]), ([self.f.id], []))
        ns.add_log(self.m, food_id=self.f.id, meal="lunch", amount=50)
        self.assertEqual([f["id"] for f in ns.quick_lists(self.m)["frequent"]], [self.f.id])
        # Deshacer
        ns.hide_quick(self.m, self.f.id)
        ns.unhide_quick(self.m, self.f.id)
        self.assertEqual(len(ns.quick_lists(self.m)["frequent"]), 1)

    def test_cannot_touch_other_members_logs(self):
        a = ns.add_log(self.m, food_id=self.f.id, meal="lunch", amount=100)
        other = make_member("o@t.mx")
        with self.assertRaises(ServiceError):
            ns.update_log(other, a.id, amount=10)
        with self.assertRaises(ServiceError):
            ns.delete_log(other, a.id)

    def test_snapshot_survives_food_changes(self):
        a = ns.add_log(self.m, food_id=self.f.id, meal="lunch", amount=100)
        self.f.kcal = 999
        self.f.save()
        a.refresh_from_db()
        self.assertEqual(a.kcal, 89)

    def test_quick_lists_frequent_recent_favorites_and_last_amount(self):
        rice = banana(external_id="2")
        for _ in range(3):
            ns.add_log(self.m, food_id=self.f.id, meal="breakfast", amount=120)
        ns.add_log(self.m, food_id=rice.id, meal="lunch", amount=80)
        ns.set_favorite(self.m, rice.id, True)
        q = ns.quick_lists(self.m)
        self.assertEqual(q["frequent"][0]["id"], self.f.id)
        self.assertEqual(q["frequent"][0]["last_amount"], 120)
        self.assertEqual(q["recent"][0]["id"], rice.id)
        self.assertEqual([f["id"] for f in q["favorites"]], [rice.id])
        self.assertTrue(q["favorites"][0]["favorite"])

    def test_coach_cannot_log_and_future_days_rejected(self):
        c = make_member("c@t.mx")
        set_role(c, "coach")
        with self.assertRaises(ServiceError):
            ns.add_log(c, food_id=self.f.id, meal="lunch", amount=100)
        with self.assertRaises(ServiceError):
            ns.add_log(self.m, food_id=self.f.id, meal="lunch", amount=100, on=today() + timedelta(days=5))

    def test_goal_set_by_coach(self):
        coach = make_member("coach@t.mx")
        g = ns.set_goal(self.m, coach, kcal=1800)
        self.assertEqual((g["kcal"], g["set_by"]), (1800, "coach"))
        with self.assertRaises(ServiceError):
            ns.set_goal(self.m, coach, kcal=0)

    @override_settings(CACHES=TEST_CACHE)
    def test_resolve_prefers_fresh_product_then_cache(self):
        cache.clear()
        stale = sources.off_normalize({"code": "75", "product_name": "Yogurt", "nutriments": {"energy-kcal_100g": 122, "proteins_100g": 5}})
        sources.remember(stale)
        fresh = dict(stale, kcal=86)
        with mock.patch.object(sources, "off_barcode", return_value=fresh):
            self.assertEqual(ns.resolve("off", "75").kcal, 86)
        with mock.patch.object(sources, "off_barcode", side_effect=ServiceError("caído")):
            self.assertEqual(ns.resolve("off", "75").kcal, 122)  # cae a la copia de la búsqueda
