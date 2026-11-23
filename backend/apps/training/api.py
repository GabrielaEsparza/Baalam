from decimal import Decimal

from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from ninja import File, Router, Schema
from ninja.files import UploadedFile
from pydantic import Field

from config.permissions import coach_required, exercise_search_required, routine_editor_required

from . import exercisedb, services
from .models import Exercise

User = get_user_model()
router = Router(tags=["entrenar"])
coach_router = Router(tags=["coach · rutinas"])


# ---------------- Esquemas ----------------

class ItemIn(Schema):
    exercise_id: int
    sets: int = Field(3, ge=1, le=20)
    reps: int | None = Field(None, ge=1, le=200)
    reps_max: int | None = Field(None, ge=1, le=200)
    duration_s: int | None = Field(None, ge=5, le=7200)
    target_weight_kg: Decimal | None = Field(None, ge=0, le=500)
    rest_s: int = Field(90, ge=0, le=900)
    superset_group: str = Field("", max_length=4)
    notes: str = ""


class DayIn(Schema):
    label: str = ""
    focus: str = ""
    items: list[ItemIn] = []


class CopyIn(Schema):
    from_weekday: int = Field(ge=0, le=6)
    to_weekday: int = Field(ge=0, le=6)


class ImportIn(Schema):
    external_id: str
    name_es: str = ""
    # Si la búsqueda ya trajo los datos, se mandan para no gastar otra llamada a la API.
    name: str | None = None
    gif_url: str | None = None
    body_parts: list[str] = []
    equipments: list[str] = []
    target_muscles: list[str] = []
    secondary_muscles: list[str] = []
    instructions: list[str] = []


class CustomIn(Schema):
    name: str = Field(min_length=2, max_length=120)
    muscle_group: str = ""
    equipment: str = ""
    instructions_es: str = ""
    video_url: str = ""


class ExercisePatch(Schema):
    name_es: str | None = Field(None, min_length=2, max_length=120)
    instructions_es: str | None = None
    video_url: str | None = None
    muscle_group: str | None = None
    equipment: str | None = None
    active: bool | None = None


class SetIn(Schema):
    item_id: int
    set_number: int = Field(ge=1, le=20)
    weight_kg: Decimal | None = Field(None, ge=0, le=500)
    reps: int | None = Field(None, ge=0, le=500)
    done: bool = True


# ---------------- Miembro ----------------

@router.get("/workouts/today", response=dict)
def workout_today(request):
    return services.today_workout(request.user)


@router.post("/workouts/today/sets", response=dict)
def log_set(request, data: SetIn):
    return services.log_set(request.user, **data.dict())


class SwapIn(Schema):
    weekday: int = Field(ge=0, le=6)


@router.post("/workouts/today/swap", response=dict)
def swap_day(request, data: SwapIn):
    """Hoy hace la rutina de otro día de su semana."""
    return services.swap_day(request.user, data.weekday)


@router.delete("/workouts/today/swap", response=dict)
def clear_swap(request):
    return services.clear_swap(request.user)


@router.post("/workouts/today/finish", response=dict)
def finish(request):
    return services.finish_session(request.user)


# ---------------- Coach: catálogo ExerciseDB (proxy con caché) ----------------

@coach_router.get("/exercises/catalog", response=dict)
@exercise_search_required
def catalog(request, q: str = "", body_part: str = "", equipment: str = "", cursor: str = ""):
    res = exercisedb.search(name=q, body_part=body_part, equipment=equipment, cursor=cursor)
    imported = dict(
        Exercise.objects.filter(source="exercisedb", external_id__in=[i["external_id"] for i in res["items"]]).values_list(
            "external_id", "id"
        )
    )
    for i in res["items"]:
        i["library_id"] = imported.get(i["external_id"])
    return res


@coach_router.get("/exercises/filters", response=dict)
@exercise_search_required
def catalog_filters(request):
    return exercisedb.filters()


# ---------------- Coach: biblioteca propia ----------------

@coach_router.get("/exercises", response=list[dict])
@exercise_search_required
def library(request, q: str = "", muscle: str = ""):
    return [services.exercise_payload(e) for e in services.library(q, muscle)[:200]]


@coach_router.post("/exercises", response={201: dict})
@coach_required
def create_custom(request, data: CustomIn):
    """Ejercicio propio, para lo que no esté en el catálogo."""
    return 201, services.exercise_payload(services.create_custom(**data.dict()))


@coach_router.post("/exercises/{exercise_id}/media", response=dict)
@coach_required
def upload_media(request, exercise_id: int, file: UploadedFile = File(...)):
    ex = get_object_or_404(Exercise, id=exercise_id)
    return services.exercise_payload(services.set_media(ex, file))


@coach_router.delete("/exercises/{exercise_id}/media", response=dict)
@coach_required
def delete_media(request, exercise_id: int):
    ex = get_object_or_404(Exercise, id=exercise_id)
    if ex.media_file:
        ex.media_file.delete(save=True)
    return services.exercise_payload(ex)


@coach_router.post("/exercises/import", response=dict)
@exercise_search_required
def import_exercise(request, data: ImportIn):
    if data.name and data.gif_url:
        ex = services.import_from_payload(data.dict(), data.name_es)
    else:
        ex = services.import_exercise(data.external_id, data.name_es)
    return services.exercise_payload(ex)


@coach_router.patch("/exercises/{exercise_id}", response=dict)
@coach_required
def patch_exercise(request, exercise_id: int, data: ExercisePatch):
    ex = get_object_or_404(Exercise, id=exercise_id)
    for k, v in data.dict(exclude_unset=True).items():
        setattr(ex, k, v)
    ex.save()
    return services.exercise_payload(ex)


# ---------------- Coach: rutinas por miembro ----------------

@coach_router.get("/routines", response=list[dict])
@coach_required
def routine_members(request):
    """Inscritos en rutina personalizada, con los días que reservaron."""
    return services.routine_members()


@coach_router.get("/routines/{member_id}", response=dict)
@routine_editor_required
def routine(request, member_id: int):
    member = get_object_or_404(User, id=member_id)
    from apps.accounts.services import get_profile

    p = get_profile(member)
    return {
        "member": {"id": member.id, "full_name": p.full_name, "avatar_url": p.avatar.url if p.avatar else None},
        "booked_weekdays": services.booked_weekdays(member),
        **services.routine_detail(member),
    }


@coach_router.put("/routines/{member_id}/days/{weekday}", response=dict)
@routine_editor_required
def save_day(request, member_id: int, weekday: int, data: DayIn):
    member = get_object_or_404(User, id=member_id)
    return services.save_day(
        member, weekday, label=data.label, focus=data.focus, items=[i.dict() for i in data.items], by=request.user
    )


@coach_router.post("/routines/{member_id}/copy", response=dict)
@routine_editor_required
def copy_day(request, member_id: int, data: CopyIn):
    return services.copy_day(get_object_or_404(User, id=member_id), data.from_weekday, data.to_weekday, by=request.user)
