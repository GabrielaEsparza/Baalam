from django.conf import settings
from django.db import models

from apps.accounts.models import TimeStamped


class Exercise(TimeStamped):
    class Source(models.TextChoices):
        EXERCISEDB = "exercisedb", "ExerciseDB"
        FREEDB = "freedb", "free-exercise-db"
        CUSTOM = "custom", "Propio"

    name_es = models.CharField(max_length=120)
    name_en = models.CharField(max_length=120, blank=True, help_text="Nombre original del catálogo")
    instructions_es = models.TextField(blank=True, help_text="2–3 indicaciones cortas de técnica")
    instructions = models.JSONField(default=list, blank=True, help_text="Pasos originales del catálogo")
    muscle_group = models.CharField(max_length=60, blank=True)
    target_muscles = models.JSONField(default=list, blank=True)
    secondary_muscles = models.JSONField(default=list, blank=True)
    equipment = models.CharField(max_length=60, blank=True)
    source = models.CharField(max_length=12, choices=Source.choices, default=Source.CUSTOM)
    external_id = models.CharField(max_length=80, blank=True)
    gif_url = models.URLField(blank=True)
    image_urls = models.JSONField(default=list, blank=True)
    video_url = models.URLField(blank=True, help_text="YouTube no listado; tiene prioridad")
    media_file = models.FileField(upload_to="exercises/", blank=True, help_text="Foto, GIF o video subido por el coach")
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name_es"]
        verbose_name = "ejercicio"

    def __str__(self):
        return self.name_es


class RoutineTemplate(TimeStamped):
    """Plantilla general, o la rutina semanal personalizada de un miembro (member != None)."""

    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    member = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, null=True, blank=True, related_name="routines"
    )
    active = models.BooleanField(default=True)

    class Meta:
        verbose_name = "plantilla de rutina"

    def __str__(self):
        return self.name


class TemplateDay(TimeStamped):
    template = models.ForeignKey(RoutineTemplate, on_delete=models.CASCADE, related_name="days")
    label = models.CharField(max_length=40, help_text="Día A")
    focus = models.CharField(max_length=60, blank=True, help_text="Fuerza")
    order = models.PositiveSmallIntegerField(default=0)
    weekday = models.PositiveSmallIntegerField(null=True, blank=True, help_text="0=lunes … 6=domingo")

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return f"{self.label} · {self.focus}"


class ItemFields(models.Model):
    exercise = models.ForeignKey(Exercise, on_delete=models.PROTECT)
    order = models.PositiveSmallIntegerField(default=0)
    sets = models.PositiveSmallIntegerField(default=3)
    reps = models.PositiveSmallIntegerField(null=True, blank=True)
    reps_max = models.PositiveSmallIntegerField(null=True, blank=True, help_text="Rango: reps–reps_max (8–10)")
    duration_s = models.PositiveIntegerField(null=True, blank=True)
    target_weight_kg = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    rest_s = models.PositiveSmallIntegerField(default=90)
    superset_group = models.CharField(
        max_length=4, blank=True, help_text="Ejercicios seguidos con la misma letra se alternan serie por serie"
    )
    notes = models.CharField(max_length=200, blank=True)

    class Meta:
        abstract = True
        ordering = ["order", "id"]


class TemplateItem(ItemFields, TimeStamped):
    day = models.ForeignKey(TemplateDay, on_delete=models.CASCADE, related_name="items")


class DaySwap(TimeStamped):
    """El miembro hace hoy la rutina de otro día (p. ej. reponer en su día de descanso)."""

    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="day_swaps")
    date = models.DateField()
    template_day = models.ForeignKey(TemplateDay, on_delete=models.CASCADE, related_name="swaps")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["member", "date"], name="one_swap_per_day")]
        verbose_name = "cambio de día"
        verbose_name_plural = "cambios de día"

    def __str__(self):
        return f"{self.member} · {self.date} → {self.template_day}"


class ScheduledWorkout(TimeStamped):
    """Copia de una plantilla en una fecha concreta. Editar la plantilla no la cambia."""

    class Status(models.TextChoices):
        PLANNED = "planned", "Programado"
        DONE = "done", "Hecho"
        MISSED = "missed", "Perdido"
        MOVED = "moved", "Movido"

    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="workouts")
    date = models.DateField()
    title = models.CharField(max_length=60)
    focus = models.CharField(max_length=60, blank=True)
    template_day = models.ForeignKey(TemplateDay, on_delete=models.SET_NULL, null=True, blank=True)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.PLANNED)
    coach_note = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["date", "id"]
        verbose_name = "entrenamiento programado"
        verbose_name_plural = "entrenamientos programados"

    def __str__(self):
        return f"{self.member} · {self.date} · {self.title}"


class ScheduledItem(ItemFields, TimeStamped):
    workout = models.ForeignKey(ScheduledWorkout, on_delete=models.CASCADE, related_name="items")


class WorkoutSession(TimeStamped):
    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sessions")
    scheduled_workout = models.ForeignKey(
        ScheduledWorkout, on_delete=models.SET_NULL, null=True, blank=True, related_name="sessions"
    )
    template_day = models.ForeignKey(TemplateDay, on_delete=models.SET_NULL, null=True, blank=True)
    date = models.DateField(null=True, blank=True)
    started_at = models.DateTimeField()
    finished_at = models.DateTimeField(null=True, blank=True)
    total_volume_kg = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    class Meta:
        ordering = ["-started_at"]
        verbose_name = "sesión de entrenamiento"


class SetLog(TimeStamped):
    session = models.ForeignKey(WorkoutSession, on_delete=models.CASCADE, related_name="sets")
    exercise = models.ForeignKey(Exercise, on_delete=models.PROTECT)
    set_number = models.PositiveSmallIntegerField()
    weight_kg = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    reps = models.PositiveSmallIntegerField(null=True, blank=True)
    duration_s = models.PositiveIntegerField(null=True, blank=True)
    done = models.BooleanField(default=True)
    is_pr = models.BooleanField(default=False)
    client_id = models.CharField(max_length=40, blank=True, help_text="Idempotencia de la cola sin conexión")

    class Meta:
        ordering = ["exercise_id", "set_number"]
        constraints = [
            models.UniqueConstraint(fields=["session", "exercise", "set_number"], name="uniq_set_per_session")
        ]
