import io
from datetime import time
from decimal import Decimal
from unittest import mock

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image

from apps.accounts.services import ServiceError, features_for, save_avatar, set_role
from apps.common import month_key, today
from apps.memberships.tests.test_services import make_member, make_plans, pay
from apps.podium.models import PointsLedger
from apps.schedule.models import Booking, Schedule, Session
from apps.schedule.services import generate_sessions
from apps.training import exercisedb
from apps.training import services as ts
from apps.training.models import Exercise, SetLog

RAW = {
    "exerciseId": "EIeI8Vf",
    "name": "barbell bench press",
    "gifUrl": "https://static.exercisedb.dev/media/EIeI8Vf.gif",
    "targetMuscles": ["pectorals"],
    "bodyParts": ["chest"],
    "equipments": ["barbell"],
    "secondaryMuscles": ["triceps"],
    "instructions": ["Step:1 Acuéstate en la banca.", "Step:2 Empuja."],
}

TEST_CACHE = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


class FakeResp:
    def __init__(self, data, status=200, text=""):
        self._data, self.status_code, self.text = data, status, text or "{}"

    def json(self):
        return self._data

    def raise_for_status(self):
        if self.status_code >= 400:
            import requests

            raise requests.HTTPError(str(self.status_code))


@override_settings(CACHES=TEST_CACHE)
class ExerciseDbClientTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_normalize_strips_step_prefix_and_defaults(self):
        n = exercisedb.normalize(RAW)
        self.assertEqual(n["instructions"][0], "Acuéstate en la banca.")
        empty = exercisedb.normalize({"exerciseId": "x", "name": "y"})
        self.assertEqual(empty["target_muscles"], [])
        self.assertEqual(empty["instructions"], [])

    def test_search_uses_real_params_and_caches(self):
        resp = FakeResp({"success": True, "meta": {"total": 1, "hasNextPage": True, "nextCursor": "abc"}, "data": [RAW]})
        with mock.patch("apps.training.exercisedb.requests.get", return_value=resp) as g:
            r1 = exercisedb.search(name="Bench", body_part="chest", equipment="barbell", cursor="zz")
            r2 = exercisedb.search(name="Bench", body_part="chest", equipment="barbell", cursor="zz")
        self.assertEqual(g.call_count, 1)  # segunda vez sale de caché
        params = g.call_args.kwargs["params"]
        self.assertEqual(params, {"limit": 24, "name": "bench", "bodyParts": "chest", "equipments": "barbell", "after": "zz"})
        self.assertEqual(r1["next_cursor"], "abc")
        self.assertEqual(r2["items"][0]["external_id"], "EIeI8Vf")

    def test_rate_limit_gives_friendly_error(self):
        with mock.patch("apps.training.exercisedb.requests.get", return_value=FakeResp({}, 429, "error code: 1015")):
            with self.assertRaises(ServiceError) as e:
                exercisedb.search(name="squat")
        self.assertEqual(e.exception.status, 503)

    def test_rate_limit_falls_back_to_stale_copy(self):
        ok = FakeResp({"success": True, "meta": {}, "data": [RAW]})
        with mock.patch("apps.training.exercisedb.requests.get", return_value=ok):
            exercisedb.search(name="press")
        cache.delete(exercisedb._key("/exercises", {"limit": 24, "name": "press"}))  # caduca la fresca
        with mock.patch("apps.training.exercisedb.requests.get", return_value=FakeResp({}, 429, "error code: 1015")):
            r = exercisedb.search(name="press")
        self.assertEqual(len(r["items"]), 1)


@override_settings(CACHES=TEST_CACHE)
class RoutineTests(TestCase):
    def setUp(self):
        cache.clear()
        self.rutina, self.clases = make_plans()
        self.member = make_member()
        pay(self.member, self.rutina)
        with mock.patch("apps.training.exercisedb.requests.get", return_value=FakeResp({"success": True, "data": RAW})):
            self.bench = ts.import_exercise("EIeI8Vf", "Press de banca")
        self.squat = Exercise.objects.create(name_es="Sentadilla", source="custom")
        self.wd = today().weekday()

    def save_today(self, sets=3):
        return ts.save_day(
            self.member, self.wd, label="Día A", focus="Fuerza",
            items=[
                {"exercise_id": self.bench.id, "sets": sets, "reps": 8, "target_weight_kg": Decimal("40"), "rest_s": 90},
                {"exercise_id": self.squat.id, "sets": 2, "reps": 10, "rest_s": 60},
            ],
        )

    def test_import_is_idempotent_and_keeps_spanish_name(self):
        again = ts.import_exercise("EIeI8Vf")
        self.assertEqual(again.id, self.bench.id)
        self.assertEqual(self.bench.name_es, "Press de banca")
        self.assertEqual(self.bench.name_en, "barbell bench press")
        self.assertEqual(self.bench.target_muscles, ["pectorals"])

    def test_routine_members_lists_only_routine_plan_with_booked_days(self):
        other = make_member("clases@t.mx")
        pay(other, self.clases)
        sch = Schedule.objects.create(name="Piso", type="open_gym", weekdays=list(range(7)), start_time=time(23, 0))
        generate_sessions(today(), today())
        Booking.objects.create(member=self.member, session=Session.objects.get(schedule=sch), month=month_key(today()))
        rows = ts.routine_members()
        self.assertEqual([r["id"] for r in rows], [self.member.id])
        self.assertEqual(rows[0]["booked_weekdays"], [self.wd])

    def test_save_day_and_member_sees_it_today(self):
        self.save_today()
        brief = ts.today_workout_brief(self.member)
        self.assertEqual(brief["title"], "Día A")
        self.assertEqual(brief["exercises"], 2)
        w = ts.today_workout(self.member)
        self.assertEqual(w["day"]["items"][0]["exercise"]["gif_url"], RAW["gifUrl"])
        self.assertEqual(w["routine_weekdays"], [self.wd])

    def test_empty_day_is_removed(self):
        self.save_today()
        ts.save_day(self.member, self.wd, label="", focus="", items=[])
        self.assertIsNone(ts.today_workout(self.member)["day"])

    def test_copy_day(self):
        self.save_today()
        other = (self.wd + 2) % 7
        d = ts.copy_day(self.member, self.wd, other)
        self.assertEqual(len(d["items"]), 2)

    def test_log_sets_finish_awards_points(self):
        self.save_today(sets=2)
        items = ts.today_workout(self.member)["day"]["items"]
        for it in items:
            for n in range(1, it["sets"] + 1):
                ts.log_set(self.member, item_id=it["id"], set_number=n, weight_kg=Decimal("40"), reps=8)
        res = ts.finish_session(self.member)
        self.assertTrue(res["completed"])
        self.assertEqual(res["sets_done"], 4)
        self.assertTrue(PointsLedger.objects.filter(member=self.member, reason="workout").exists())

    def test_pr_detected_against_previous_sessions(self):
        self.save_today()
        item = ts.today_workout(self.member)["day"]["items"][0]
        ts.log_set(self.member, item_id=item["id"], set_number=1, weight_kg=Decimal("40"), reps=8)
        # Simula que esa sesión fue otro día
        from apps.training.models import WorkoutSession
        from datetime import timedelta

        WorkoutSession.objects.update(date=today() - timedelta(days=7))
        r = ts.log_set(self.member, item_id=item["id"], set_number=1, weight_kg=Decimal("45"), reps=6)
        self.assertTrue(r["is_pr"])
        self.assertEqual(r["points"], 30)
        # Precarga del peso de la sesión anterior
        self.assertEqual(ts._last_weights(self.member, [self.bench.id])[self.bench.id], Decimal("40"))

    def test_cannot_log_other_members_item(self):
        self.save_today()
        item = ts.today_workout(self.member)["day"]["items"][0]
        intruder = make_member("x@t.mx")
        pay(intruder, self.rutina)
        with self.assertRaises(ServiceError):
            ts.log_set(intruder, item_id=item["id"], set_number=1, weight_kg=10, reps=1)
        self.assertEqual(SetLog.objects.count(), 0)


class ProfileTests(TestCase):
    def test_avatar_is_cropped_square_jpeg(self):
        u = make_member()
        buf = io.BytesIO()
        Image.new("RGB", (900, 400), "purple").save(buf, "PNG")
        p = save_avatar(u, SimpleUploadedFile("a.png", buf.getvalue(), "image/png"))
        with Image.open(p.avatar.path) as img:
            self.assertEqual(img.size, (512, 512))
            self.assertEqual(img.format, "JPEG")
        p.avatar.delete()

    def test_avatar_rejects_non_images(self):
        with self.assertRaises(ServiceError):
            save_avatar(make_member(), SimpleUploadedFile("x.jpg", b"not an image", "image/jpeg"))

    def test_coach_has_admin_permissions(self):
        u = make_member()
        set_role(u, "coach")
        u.refresh_from_db()
        self.assertTrue(features_for(u)["admin"])
        self.assertTrue(u.is_staff and u.is_superuser)
        set_role(u, "member")
        u.refresh_from_db()
        self.assertFalse(features_for(u)["admin"] or u.is_staff)


class CoachIsNotMemberTests(TestCase):
    def test_coach_cannot_book_checkin_or_get_routine(self):
        from apps.checkin.services import checkin
        from apps.schedule.services import book_month

        rutina, _ = make_plans()
        coach = make_member("coach@t.mx")
        pay(coach, rutina)  # aunque tuviera membresía
        set_role(coach, "coach")
        f = features_for(coach)
        self.assertFalse(f["routine"] or f["open_gym"] or f["access"])
        for call in (
            lambda: book_month(coach, month_key(today()), []),
            lambda: checkin(coach, source="manual", manual_by=coach),
            lambda: ts.save_day(coach, 0, label="", focus="", items=[]),
        ):
            with self.assertRaises(ServiceError) as e:
                call()
            self.assertEqual(e.exception.code, "coach_not_member")
        self.assertNotIn(coach.id, [r["id"] for r in ts.routine_members()])


class CustomExerciseTests(TestCase):
    def test_create_custom_and_upload_gif_keeps_animation(self):
        ex = ts.create_custom(name="Burpee con salto al cajón", muscle_group="upper legs", equipment="body weight")
        with self.assertRaises(ServiceError):
            ts.create_custom(name="burpee con salto al cajón")  # duplicado
        frames = [Image.new("RGB", (60, 60), c) for c in ("red", "blue")]
        buf = io.BytesIO()
        frames[0].save(buf, "GIF", save_all=True, append_images=frames[1:], duration=200, loop=0)
        ts.set_media(ex, SimpleUploadedFile("demo.gif", buf.getvalue(), "image/gif"))
        p = ts.exercise_payload(ex)
        self.assertTrue(p["gif_url"].endswith(".gif"))
        with Image.open(ex.media_file.path) as img:
            self.assertTrue(getattr(img, "is_animated", False))
        ex.media_file.delete()

    def test_video_goes_to_video_url_and_garbage_rejected(self):
        ex = ts.create_custom(name="Plancha lateral")
        ts.set_media(ex, SimpleUploadedFile("clip.mp4", b"\x00\x00\x00\x18ftypmp42", "video/mp4"))
        p = ts.exercise_payload(ex)
        self.assertTrue(p["video_url"].endswith(".mp4"))
        self.assertEqual(p["gif_url"], "")
        ex.media_file.delete()
        with self.assertRaises(ServiceError):
            ts.set_media(ex, SimpleUploadedFile("x.png", b"nope", "image/png"))
