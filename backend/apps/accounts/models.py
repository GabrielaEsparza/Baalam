from django.conf import settings
from django.db import models


class TimeStamped(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Profile(TimeStamped):
    class Role(models.TextChoices):
        ADMIN = "admin", "Admin"
        COACH = "coach", "Coach"
        MEMBER = "member", "Miembro"

    class Status(models.TextChoices):
        PENDING = "pending", "Pendiente"
        ACTIVE = "active", "Activo"
        BLOCKED = "blocked", "Bloqueado"

    class Greeting(models.TextChoices):
        A = "a", "Bienvenida"
        O = "o", "Bienvenido"
        X = "x", "Bienvenidx"

    class Sex(models.TextChoices):
        FEMALE = "f", "Mujer"
        MALE = "m", "Hombre"

    class Theme(models.TextChoices):
        LIGHT = "light", "Claro"
        DARK = "dark", "Oscuro"

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile")
    full_name = models.CharField(max_length=120)
    phone = models.CharField(max_length=20, blank=True)
    avatar = models.ImageField(upload_to="avatars/", blank=True)
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.MEMBER)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    goal = models.CharField(max_length=200, blank=True)
    birth_date = models.DateField(null=True, blank=True)
    sex = models.CharField(max_length=1, choices=Sex.choices, blank=True, help_text="Para IMC y rangos de grasa")
    height_cm = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    target_weight_kg = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    greeting = models.CharField(max_length=1, choices=Greeting.choices, default=Greeting.X)
    theme = models.CharField(max_length=5, choices=Theme.choices, default=Theme.LIGHT)
    show_in_podium = models.BooleanField(default=True)
    share_achievements = models.BooleanField(default=True)
    coach_notes = models.TextField(blank=True, help_text="Privadas: solo las ve el coach")

    class Meta:
        verbose_name = "perfil"

    def __str__(self):
        return self.full_name or self.user.get_username()

    @property
    def is_coach(self) -> bool:
        return self.role in (self.Role.COACH, self.Role.ADMIN)
