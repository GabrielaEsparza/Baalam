"""Rutina semanal personalizada (Plan Rutina), biblioteca de ejercicios y registro de series.

Modelo: cada miembro tiene UNA rutina activa (RoutineTemplate con member) con un
TemplateDay por día de la semana que entrena; cada día tiene sus TemplateItem.
Lo que el miembro registra va a WorkoutSession/SetLog, así editar la rutina no
altera el historial.
"""
from datetime import date
from decimal import Decimal

from django.db import transaction
from django.db.models import Max, Q

from apps.accounts.models import Profile
from apps.accounts.services import ServiceError, get_profile
from apps.common import now, parse_month, month_key, today
from apps.memberships.services import current_membership, display_status, has_access
from apps.podium import services as podium
from apps.podium.models import PointsLedger

from . import exercisedb
from .models import DaySwap, Exercise, RoutineTemplate, ScheduledWorkout, SetLog, TemplateDay, TemplateItem, WorkoutSession

WORKOUT_DONE_RATIO = 0.8


# ---------------- Biblioteca ----------------

@transaction.atomic
def import_exercise(external_id: str, name_es: str = "") -> Exercise:
    """Trae un ejercicio del catálogo a nuestra tabla (una sola vez)."""
    existing = Exercise.objects.filter(source=Exercise.Source.EXERCISEDB, external_id=external_id).first()
    if existing:
        if not existing.active:
            existing.active = True
            existing.save(update_fields=["active", "updated_at"])
        return existing
    item = exercisedb.get(external_id)
    return Exercise.objects.create(
        source=Exercise.Source.EXERCISEDB,
        external_id=item["external_id"],
        name_es=(name_es or item["name"]).strip()[:120],
        name_en=item["name"][:120],
        gif_url=item["gif_url"],
        muscle_group=(item["body_parts"] or [""])[0],
        equipment=(item["equipments"] or [""])[0],
        target_muscles=item["target_muscles"],
        secondary_muscles=item["secondary_muscles"],
        instructions=item["instructions"],
    )


def import_from_payload(item: dict, name_es: str = "") -> Exercise:
    """Igual que import_exercise pero con los datos que ya trajo la búsqueda (sin otra llamada)."""
    existing = Exercise.objects.filter(source=Exercise.Source.EXERCISEDB, external_id=item["external_id"]).first()
    if existing:
        return existing
    return Exercise.objects.create(
        source=Exercise.Source.EXERCISEDB,
        external_id=item["external_id"],
        name_es=(name_es or item["name"]).strip()[:120],
        name_en=item["name"][:120],
        gif_url=item.get("gif_url", ""),
        muscle_group=(item.get("body_parts") or [""])[0],
        equipment=(item.get("equipments") or [""])[0],
        target_muscles=item.get("target_muscles") or [],
        secondary_muscles=item.get("secondary_muscles") or [],
        instructions=item.get("instructions") or [],
    )


# ---------------- Miembros con rutina ----------------

def routine_members():
    """Miembros cuyo plan vigente incluye rutina personalizada."""
    out = []
    for p in Profile.objects.filter(role=Profile.Role.MEMBER, user__is_active=True).select_related("user").order_by("full_name"):
        m = current_membership(p.user)
        if not m or not m.plan.includes_routine:
            continue
        status = display_status(m)
        if status == "expired":
            continue
        routine = active_routine(p.user, create=False)
        days = list(routine.days.filter(weekday__isnull=False).values_list("weekday", flat=True)) if routine else []
        out.append(
            {
                "id": p.user_id,
                "full_name": p.full_name,
                "avatar_url": p.avatar.url if p.avatar else None,
                "membership_status": status,
                "sessions_per_week": m.sessions_per_week,
                "booked_weekdays": booked_weekdays(p.user),
                "routine_weekdays": sorted(
                    d for d in days if TemplateItem.objects.filter(day__template=routine, day__weekday=d).exists()
                ),
            }
        )
    return out


def booked_weekdays(member, on: date | None = None) -> list[int]:
    """Días de la semana en que el miembro reservó este mes (los que 'iría')."""
    from apps.schedule.models import Booking

    on = on or today()
    first, last = parse_month(month_key(on))
    dates = (
        Booking.objects.filter(member=member, session__date__range=(first, last))
        .exclude(status__in=[Booking.Status.MOVED, Booking.Status.CANCELLED])
        .values_list("session__date", flat=True)
    )
    return sorted({d.weekday() for d in dates})


def active_routine(member, create: bool = True, by=None) -> RoutineTemplate | None:
    r = RoutineTemplate.objects.filter(member=member, active=True).order_by("-id").first()
    if r or not create:
        return r
    return RoutineTemplate.objects.create(
        member=member, name=f"Rutina de {get_profile(member).full_name}", created_by=by
    )


def routine_detail(member) -> dict:
    r = active_routine(member, create=False)
    days = {}
    if r:
        for d in r.days.filter(weekday__isnull=False).prefetch_related("items__exercise"):
            days[d.weekday] = day_payload(d)
    return {"routine_id": r.id if r else None, "days": days}


def day_payload(d: TemplateDay) -> dict:
    return {
        "weekday": d.weekday,
        "label": d.label,
        "focus": d.focus,
        "items": [item_payload(i) for i in d.items.all().order_by("order", "id")],
    }


VIDEO_EXT = (".mp4", ".webm", ".mov", ".m4v")


def exercise_payload(e: Exercise) -> dict:
    file_url = e.media_file.url if e.media_file else ""
    is_video = file_url.lower().endswith(VIDEO_EXT)
    return {
        "id": e.id,
        "name": e.name_es,
        "name_en": e.name_en,
        "gif_url": e.gif_url or ("" if is_video else file_url),
        "video_url": e.video_url or (file_url if is_video else ""),
        "image_urls": e.image_urls,
        "muscle_group": e.muscle_group,
        "equipment": e.equipment,
        "target_muscles": e.target_muscles,
        "secondary_muscles": e.secondary_muscles,
        "instructions": e.instructions,
        "instructions_es": e.instructions_es,
        "source": e.source,
        "external_id": e.external_id,
    }


def item_payload(i: TemplateItem) -> dict:
    return {
        "id": i.id,
        "exercise": exercise_payload(i.exercise),
        "order": i.order,
        "sets": i.sets,
        "reps": i.reps,
        "reps_max": i.reps_max,
        "duration_s": i.duration_s,
        "target_weight_kg": i.target_weight_kg,
        "rest_s": i.rest_s,
        "superset_group": i.superset_group,
        "notes": i.notes,
    }


def normalize_groups(groups: list[str]) -> list[str]:
    """Superseries: solo cuentan ejercicios SEGUIDOS con la misma marca. Se renombran A, B, C…
    en orden; una marca suelta (sin vecino igual) se borra."""
    out = [""] * len(groups)
    letter, i = 0, 0
    while i < len(groups):
        j = i
        while groups[i] and j + 1 < len(groups) and groups[j + 1] == groups[i]:
            j += 1
        if j > i:
            name = chr(ord("A") + letter % 26)
            letter += 1
            for k in range(i, j + 1):
                out[k] = name
        i = j + 1
    return out


@transaction.atomic
def save_day(member, weekday: int, *, label: str, focus: str, items: list[dict], by=None) -> dict:
    """Reemplaza los ejercicios de un día. Las sesiones ya registradas no cambian."""
    from apps.accounts.services import ensure_member

    ensure_member(member)
    if not 0 <= weekday <= 6:
        raise ServiceError("Día inválido.")
    r = active_routine(member, by=by)
    day, _ = TemplateDay.objects.get_or_create(
        template=r, weekday=weekday, defaults={"label": label or "", "order": weekday}
    )
    day.label, day.focus = (label or "").strip()[:40], (focus or "").strip()[:60]
    day.save()
    ids = [it["exercise_id"] for it in items]
    found = set(Exercise.objects.filter(id__in=ids).values_list("id", flat=True))
    if missing := set(ids) - found:
        raise ServiceError(f"Ejercicio no encontrado: {sorted(missing)}", "not_found", 404)
    day.items.all().delete()
    groups = normalize_groups([it.get("superset_group") or "" for it in items])
    for n, it in enumerate(items):
        reps, reps_max = it.get("reps"), it.get("reps_max")
        if it.get("duration_s"):
            reps = reps_max = None
        if reps_max is not None and (reps is None or reps_max <= reps):
            reps_max = None  # "8–8" o rango al revés: se queda solo el número
        TemplateItem.objects.create(
            day=day,
            exercise_id=it["exercise_id"],
            order=n,
            sets=max(1, min(int(it.get("sets") or 3), 20)),
            reps=reps,
            reps_max=reps_max,
            duration_s=it.get("duration_s"),
            target_weight_kg=it.get("target_weight_kg"),
            rest_s=max(0, min(int(it.get("rest_s") if it.get("rest_s") is not None else 90), 900)),
            superset_group=groups[n],
            notes=(it.get("notes") or "")[:200],
        )
    if not items and not day.label and not day.focus:
        day.delete()
        return {"weekday": weekday, "label": "", "focus": "", "items": []}
    return day_payload(day)


def copy_day(member, from_weekday: int, to_weekday: int, by=None) -> dict:
    d = routine_detail(member)["days"].get(from_weekday)
    if not d:
        raise ServiceError("Ese día no tiene ejercicios.")
    items = [
        {
            "exercise_id": i["exercise"]["id"],
            "sets": i["sets"],
            "reps": i["reps"],
            "reps_max": i["reps_max"],
            "duration_s": i["duration_s"],
            "target_weight_kg": i["target_weight_kg"],
            "rest_s": i["rest_s"],
            "superset_group": i["superset_group"],
            "notes": i["notes"],
        }
        for i in d["items"]
    ]
    return save_day(member, to_weekday, label=d["label"], focus=d["focus"], items=items, by=by)


# ---------------- Lado del miembro ----------------

def _swap_for(member, on: date) -> DaySwap | None:
    return (
        DaySwap.objects.select_related("template_day")
        .filter(member=member, date=on, template_day__template__active=True)
        .first()
    )


def is_swapped(member, on: date | None = None) -> bool:
    """Hoy hace la rutina de otro día: no suma puntos de asistencia a su horario reservado."""
    return _swap_for(member, on or today()) is not None


def _today_day(member, on: date | None = None) -> TemplateDay | None:
    on = on or today()
    r = active_routine(member, create=False)
    if not r:
        return None
    swap = _swap_for(member, on)
    if swap and swap.template_day.template_id == r.id:
        return r.days.filter(id=swap.template_day_id).prefetch_related("items__exercise").first()
    return r.days.filter(weekday=on.weekday()).prefetch_related("items__exercise").first()


def _attendance_refs(member, on: date) -> list[str]:
    """Claves de los puntos por asistir a su horario (asistencia y clase grupal) de ese día."""
    from apps.checkin.models import CheckIn

    refs = [f"{PointsLedger.Reason.CHECKIN}:{on.isoformat()}"]
    ci = CheckIn.objects.filter(member=member, date=on, booking__isnull=False).first()
    if ci:
        refs.append(f"{PointsLedger.Reason.CLASS}:{ci.booking_id}")
    return refs


@transaction.atomic
def swap_day(member, weekday: int) -> dict:
    """Hoy entrena la rutina de `weekday`. Se guarda en la fecha de hoy y quita los puntos de asistencia."""
    _require_routine_access(member)
    t = today()
    r = active_routine(member, create=False)
    day = r.days.filter(weekday=weekday).first() if r else None
    if not day or not day.items.exists():
        raise ServiceError("Ese día no tiene rutina.", "not_found", 404)
    if weekday == t.weekday():
        return clear_swap(member)
    DaySwap.objects.update_or_create(member=member, date=t, defaults={"template_day": day})
    PointsLedger.objects.filter(member=member, ref__in=_attendance_refs(member, t)).delete()
    return today_workout(member)


@transaction.atomic
def clear_swap(member) -> dict:
    """Vuelve a la rutina que le toca hoy y, si ya registró asistencia, le regresa esos puntos."""
    from apps.checkin.models import CheckIn
    from apps.schedule.models import Schedule

    t = today()
    deleted, _ = DaySwap.objects.filter(member=member, date=t).delete()
    ci = CheckIn.objects.filter(member=member, date=t).select_related("booking__session__schedule").first()
    if deleted and ci:
        podium.award(member, PointsLedger.Reason.CHECKIN, on=t)
        if ci.booking and ci.booking.session.schedule.type == Schedule.Type.CLASS:
            podium.award(member, PointsLedger.Reason.CLASS, ref=str(ci.booking_id))
    return today_workout(member)


def today_workout_brief(member) -> dict | None:
    """Tarjeta de Inicio: 'Hoy · Día A · Fuerza · 6 ejercicios · ~50 min'."""
    day = _today_day(member)
    if day:
        items = list(day.items.all())
        if not items:
            return None
        est = sum(i.sets * ((i.duration_s or 45) + i.rest_s) for i in items) / 60
        s = WorkoutSession.objects.filter(member=member, date=today(), template_day=day).first()
        return {
            "id": day.id,
            "title": day.label or "Entrenamiento",
            "focus": day.focus,
            "exercises": len(items),
            "est_minutes": max(10, round(est / 5) * 5),
            "status": "done" if s and s.finished_at else ("in_progress" if s else "planned"),
        }
    # Compatibilidad con entrenamientos programados por fecha
    w = ScheduledWorkout.objects.filter(member=member, date=today()).exclude(status="moved").first()
    if not w:
        return None
    n = w.items.count()
    return {"id": w.id, "title": w.title, "focus": w.focus, "exercises": n, "est_minutes": max(10, n * 8), "status": w.status}


def _last_weights(member, exercise_ids) -> dict[int, Decimal]:
    rows = (
        SetLog.objects.filter(session__member=member, exercise_id__in=exercise_ids, done=True, weight_kg__isnull=False)
        .exclude(session__date=today())
        .order_by("exercise_id", "-session__started_at", "-set_number")
        .values("exercise_id", "weight_kg")
    )
    out = {}
    for r in rows:
        out.setdefault(r["exercise_id"], r["weight_kg"])
    return out


def today_workout(member) -> dict:
    t = today()
    day = _today_day(member, t)
    r = active_routine(member, create=False)
    week = []
    if r:
        week = sorted(
            d.weekday for d in r.days.filter(weekday__isnull=False) if d.items.exists()
        )
    swap = _swap_for(member, t)
    options = []
    if r:
        options = [
            {"weekday": d.weekday, "label": d.label, "focus": d.focus, "exercises": d.items.count()}
            for d in r.days.filter(weekday__isnull=False).order_by("weekday")
            if d.items.exists()
        ]
    base = {
        "weekday": t.weekday(),
        "routine_weekdays": week,
        "options": options,
        "swapped_from": swap.template_day.weekday if swap else None,
    }
    if not day or not day.items.exists():
        return {**base, "day": None, "session": None}
    items = list(day.items.all().order_by("order", "id"))
    last = _last_weights(member, [i.exercise_id for i in items])
    session = WorkoutSession.objects.filter(member=member, date=t, template_day=day).first()
    logs = {}
    if session:
        for sl in session.sets.all():
            logs[(sl.exercise_id, sl.set_number)] = sl
    payload_items = []
    for i in items:
        p = item_payload(i)
        p["last_weight_kg"] = last.get(i.exercise_id)
        p["logged"] = [
            {
                "set_number": n,
                "weight_kg": logs[(i.exercise_id, n)].weight_kg,
                "reps": logs[(i.exercise_id, n)].reps,
                "done": logs[(i.exercise_id, n)].done,
                "is_pr": logs[(i.exercise_id, n)].is_pr,
            }
            for n in range(1, i.sets + 1)
            if (i.exercise_id, n) in logs
        ]
        payload_items.append(p)
    return {
        **base,
        "day": {"id": day.id, "label": day.label, "focus": day.focus, "items": payload_items},
        "session": (
            {"id": session.id, "started_at": session.started_at, "finished_at": session.finished_at}
            if session
            else None
        ),
    }


def _require_routine_access(member):
    from apps.accounts.services import ensure_member

    ensure_member(member)
    m = current_membership(member)
    if not m or not m.plan.includes_routine or not has_access(display_status(m)):
        raise ServiceError("Tu plan no incluye rutina o tu membresía no está activa.", "no_access", 403)


@transaction.atomic
def log_set(member, *, item_id: int, set_number: int, weight_kg=None, reps=None, done: bool = True) -> dict:
    _require_routine_access(member)
    item = TemplateItem.objects.select_related("day__template").filter(id=item_id, day__template__member=member).first()
    if not item:
        raise ServiceError("Ese ejercicio no está en tu rutina.", "not_found", 404)
    if not 1 <= set_number <= item.sets:
        raise ServiceError("Serie inválida.")
    session, _ = WorkoutSession.objects.get_or_create(
        member=member, date=today(), template_day=item.day, defaults={"started_at": now()}
    )
    if session.finished_at:
        session.finished_at = None  # sigue registrando después de terminar
        session.save(update_fields=["finished_at", "updated_at"])

    prev_best = (
        SetLog.objects.filter(session__member=member, exercise_id=item.exercise_id, done=True)
        .exclude(session=session)
        .aggregate(m=Max("weight_kg"))["m"]
    )
    is_pr = bool(done and weight_kg and prev_best is not None and Decimal(str(weight_kg)) > prev_best)
    log, _ = SetLog.objects.update_or_create(
        session=session,
        exercise_id=item.exercise_id,
        set_number=set_number,
        defaults={"weight_kg": weight_kg, "reps": reps, "done": done, "is_pr": is_pr},
    )
    points = 0
    if is_pr:
        award = podium.award(member, PointsLedger.Reason.PR, ref=f"{session.id}:{item.exercise_id}")
        points = award.points if award else 0
    return {"set_number": set_number, "done": log.done, "is_pr": is_pr, "points": points}


# ---------------- Calorías estimadas ----------------
# kcal = MET × peso (kg) × horas (Compendio de Actividades Físicas, Ainsworth/Herrmann 2024).
# Pesas: 3.5 (con descansos largos), 5.0 (moderado), 6.0 (poco descanso / circuito).
KCAL_FACTOR = 0.7  # se muestra 30 % abajo del promedio a propósito, para no invitar a comer de más
WORK_S_PER_SET = 40  # tiempo típico de una serie por repeticiones


def _latest_weight(member) -> Decimal | None:
    from apps.progress.models import BodyLog

    return (
        BodyLog.objects.filter(member=member, weight_kg__isnull=False).order_by("-date").values_list("weight_kg", flat=True).first()
    )


# Cardio dentro de la rutina (bici fija, caminadora…): MET propio según el tipo de ejercicio.
# Se busca en equipo, grupo y nombre (inglés del catálogo y español de los ejercicios propios).
CARDIO_METS = [
    (("spinning", "spin "), 8.5),
    (("stepmill", "escaladora", "stair"), 9.0),
    (("jump rope", "cuerda", "saltar"), 10.0),
    (("correr", "trotar", " run", "running", "sprint"), 8.0),
    (("stationary bike", "bici", "bicicleta", "cycling", "bike"), 7.0),
    (("rowing machine", "ergómetro", "ergometro", "máquina de remo", "maquina de remo", "skierg"), 7.0),
    (("treadmill", "caminadora", "cinta"), 6.0),
    (("elliptical", "elíptica", "eliptica"), 5.0),
    (("burpee", "jumping jack", "mountain climber", "escalador", "saltos", "jump"), 8.0),
]
CARDIO_DEFAULT_MET = 7.0


def cardio_met(ex) -> float | None:
    """MET del ejercicio si es cardio; None si es de fuerza."""
    text = f" {ex.equipment} {ex.muscle_group} {ex.name_es} {ex.name_en} ".lower()
    for words, met in CARDIO_METS:
        if any(w in text for w in words):
            return met
    return CARDIO_DEFAULT_MET if "cardio" in (ex.muscle_group or "").lower() else None


def estimate_kcal(member, items: list, done_sets: list, real_minutes: float) -> dict:
    """Estimación conservadora de calorías del entrenamiento. `items` son los del día.
    Sin peso registrado no se calcula (devuelve 0)."""
    w = _latest_weight(member)
    by_ex = {i.exercise_id: i for i in items}
    done = [(by_ex[s.exercise_id], s) for s in done_sets if s.exercise_id in by_ex]
    if not w or not done:
        return {"kcal": 0, "met": 0, "weight_kg": float(w) if w else None}
    weight = float(w)

    # En alternados no se descansa entre ejercicios: solo al final de la ronda (último del grupo).
    ordered = sorted(items, key=lambda i: (i.order, i.id))
    mid_group = {
        a.exercise_id for a, nxt in zip(ordered, ordered[1:]) if a.superset_group and a.superset_group == nxt.superset_group
    }

    # Cardio: su tiempo real (lo que anotó en la serie, o lo planeado) × su MET.
    cardio_kcal_h, cardio_s, strength = 0.0, 0, []
    for i, log in done:
        met = cardio_met(i.exercise)
        if met:
            secs = min((log.reps if i.duration_s and log.reps else None) or i.duration_s or WORK_S_PER_SET, 3 * 3600)
            cardio_kcal_h += met * secs / 3600
            cardio_s += secs
        else:
            strength.append(i)

    strength_kcal_h, met = 0.0, 0.0
    if strength:
        work_s = sum(i.duration_s or WORK_S_PER_SET for i in strength)
        rest_s = sum(0 if i.exercise_id in mid_group else i.rest_s for i in strength)
        planned_min = (work_s + rest_s) / 60
        # Tiempo real, pero dentro de lo razonable para las series hechas (marcar todo al final
        # o terminar horas después no debe disparar el número).
        minutes = min(max(real_minutes - cardio_s / 60, planned_min * 0.6), planned_min * 1.5, 150)
        avg_rest = rest_s / len(strength)
        supersets = sum(1 for i in strength if i.superset_group) / len(strength)
        met = 6.0 if avg_rest <= 30 or supersets >= 0.5 else 5.0 if avg_rest <= 75 else 3.5
        strength_kcal_h = met * minutes / 60

    kcal = (strength_kcal_h + cardio_kcal_h) * weight * KCAL_FACTOR
    return {"kcal": int(round(kcal / 5) * 5), "met": met, "weight_kg": weight}


@transaction.atomic
def finish_session(member) -> dict:
    day = _today_day(member)
    session = WorkoutSession.objects.filter(member=member, date=today(), template_day=day).first() if day else None
    if not session:
        raise ServiceError("Aún no registras ninguna serie hoy.")
    planned = sum(i.sets for i in day.items.all())
    done_sets = list(session.sets.filter(done=True))
    volume = sum((s.weight_kg or 0) * (s.reps or 0) for s in done_sets)
    session.finished_at = now()
    session.total_volume_kg = volume
    session.save()
    ratio = len(done_sets) / planned if planned else 0
    pts = 0
    if ratio >= WORKOUT_DONE_RATIO:
        a = podium.award(member, PointsLedger.Reason.WORKOUT)
        pts += a.points if a else 0
    prs = sum(1 for s in done_sets if s.is_pr)
    pts += sum(
        PointsLedger.objects.filter(member=member, ref__startswith=f"pr:{session.id}:").values_list("points", flat=True)
    )
    real_min = (session.finished_at - session.started_at).total_seconds() / 60
    kcal = estimate_kcal(member, list(day.items.select_related("exercise")), done_sets, real_min)
    return {
        "kcal_estimate": kcal["kcal"],
        "kcal_weight_kg": kcal["weight_kg"],
        "duration_min": max(1, round(real_min)),
        "sets_done": len(done_sets),
        "sets_planned": planned,
        "volume_kg": volume,
        "prs": prs,
        "points": pts,
        "completed": ratio >= WORKOUT_DONE_RATIO,
    }


def create_custom(*, name: str, muscle_group: str = "", equipment: str = "", instructions_es: str = "", video_url: str = "") -> Exercise:
    name = (name or "").strip()
    if len(name) < 2:
        raise ServiceError("Escribe el nombre del ejercicio.")
    if Exercise.objects.filter(source=Exercise.Source.CUSTOM, name_es__iexact=name, active=True).exists():
        raise ServiceError("Ya tienes un ejercicio con ese nombre en tu biblioteca.", "duplicate")
    return Exercise.objects.create(
        source=Exercise.Source.CUSTOM,
        name_es=name[:120],
        muscle_group=muscle_group[:60],
        equipment=equipment[:60],
        instructions_es=instructions_es.strip(),
        video_url=video_url.strip(),
    )


MAX_IMAGE = 8 * 1024 * 1024
MAX_VIDEO = 40 * 1024 * 1024


def set_media(ex: Exercise, uploaded) -> Exercise:
    """Foto o GIF (se guarda tal cual para no perder la animación) o video corto."""
    import os

    from PIL import Image, UnidentifiedImageError

    name = (uploaded.name or "").lower()
    ext = os.path.splitext(name)[1]
    ctype = (getattr(uploaded, "content_type", "") or "").lower()
    if ctype.startswith("video/") or ext in VIDEO_EXT:
        if uploaded.size > MAX_VIDEO:
            raise ServiceError("El video pesa demasiado (máximo 40 MB). Usa un clip corto o un link de YouTube.")
        if ext not in VIDEO_EXT:
            ext = ".mp4"
    else:
        if uploaded.size > MAX_IMAGE:
            raise ServiceError("La imagen pesa demasiado (máximo 8 MB).")
        try:
            with Image.open(uploaded) as img:
                fmt = (img.format or "").lower()
                img.verify()
        except (UnidentifiedImageError, OSError):
            raise ServiceError("Ese archivo no es una imagen ni un video válido.")
        uploaded.seek(0)
        ext = {"jpeg": ".jpg", "png": ".png", "gif": ".gif", "webp": ".webp"}.get(fmt)
        if not ext:
            raise ServiceError("Usa una foto JPG, PNG, WEBP o un GIF.")
    old = ex.media_file.name if ex.media_file else None
    ex.media_file.save(f"ex{ex.id}{ext}", uploaded, save=True)
    if old and old != ex.media_file.name:
        ex.media_file.storage.delete(old)
    return ex


def library(q: str = "", muscle: str = ""):
    qs = Exercise.objects.filter(active=True)
    if q:
        qs = qs.filter(Q(name_es__icontains=q) | Q(name_en__icontains=q))
    if muscle:
        qs = qs.filter(muscle_group=muscle)
    return qs.order_by("name_es")
