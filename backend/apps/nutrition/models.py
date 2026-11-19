from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.accounts.models import TimeStamped


class Food(TimeStamped):
    """Caché propia de alimentos consultados. Valores SIEMPRE por 100 de `basis_unit`
    (g o ml). Un nutriente que la fuente no reporta queda en NULL, nunca en 0."""

    class Source(models.TextChoices):
        USDA = "usda", "USDA FoodData Central"
        OFF = "off", "Open Food Facts"

    class Basis(models.TextChoices):
        G = "g", "100 g"
        ML = "ml", "100 ml"

    source = models.CharField(max_length=4, choices=Source.choices)
    external_id = models.CharField(max_length=40, help_text="fdcId de USDA o código de barras de OFF")
    barcode = models.CharField(max_length=20, blank=True, db_index=True)
    name = models.CharField(max_length=200)
    brand = models.CharField(max_length=120, blank=True)
    image_url = models.URLField(max_length=400, blank=True)
    basis_unit = models.CharField(max_length=2, choices=Basis.choices, default=Basis.G)
    kcal = models.FloatField(null=True, blank=True)
    protein_g = models.FloatField(null=True, blank=True)
    carbs_g = models.FloatField(null=True, blank=True)
    fat_g = models.FloatField(null=True, blank=True)
    fiber_g = models.FloatField(null=True, blank=True)
    sugars_g = models.FloatField(null=True, blank=True)
    sodium_mg = models.FloatField(null=True, blank=True)
    serving_qty = models.FloatField(null=True, blank=True, help_text="Tamaño de porción en la misma unidad base")
    serving_label = models.CharField(max_length=60, blank=True)
    normalized_from = models.CharField(
        max_length=10, default="100", help_text="'100' = la fuente ya reporta por 100; 'serving' = convertido desde la porción"
    )
    suspicious = models.BooleanField(default=False, help_text="Las kcal no cuadran con los macros")
    is_mexican = models.BooleanField(default=False)
    raw = models.JSONField(default=dict, blank=True, help_text="Datos originales de la fuente")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["source", "external_id"], name="uniq_food_source_id")]
        verbose_name = "alimento"

    def __str__(self):
        return f"{self.name} ({self.brand})" if self.brand else self.name


class FoodLog(TimeStamped):
    class Meal(models.TextChoices):
        BREAKFAST = "breakfast", "Desayuno"
        LUNCH = "lunch", "Comida"
        DINNER = "dinner", "Cena"
        SNACK = "snack", "Snacks"

    class InputMode(models.TextChoices):
        AMOUNT = "amount", "Cantidad"
        KCAL = "kcal", "Calorías"
        MANUAL = "manual", "Manual (sin alimento)"

    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="food_logs")
    food = models.ForeignKey(Food, on_delete=models.SET_NULL, null=True, related_name="logs")
    date = models.DateField()
    meal = models.CharField(max_length=10, choices=Meal.choices)
    logged_at = models.DateTimeField(default=timezone.now)
    # Copia de lo que se registró (el alimento puede cambiar o borrarse después)
    food_name = models.CharField(max_length=200)
    brand = models.CharField(max_length=120, blank=True)
    input_mode = models.CharField(max_length=6, choices=InputMode.choices, default=InputMode.AMOUNT)
    amount = models.FloatField(help_text="Cantidad consumida en `unit`")
    unit = models.CharField(max_length=2, default="g")
    kcal = models.FloatField(null=True)
    protein_g = models.FloatField(null=True)
    carbs_g = models.FloatField(null=True)
    fat_g = models.FloatField(null=True)
    fiber_g = models.FloatField(null=True)
    sugars_g = models.FloatField(null=True)
    sodium_mg = models.FloatField(null=True)

    class Meta:
        ordering = ["date", "logged_at", "id"]
        indexes = [models.Index(fields=["member", "date"])]
        verbose_name = "registro de alimento"


class FavoriteFood(TimeStamped):
    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="favorite_foods")
    food = models.ForeignKey(Food, on_delete=models.CASCADE)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["member", "food"], name="uniq_favorite_food")]


class QuickHide(TimeStamped):
    """El miembro quitó este alimento de Recientes/Frecuentes. Vuelve a aparecer
    solo si lo registra otra vez después de `hidden_at`."""

    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="quick_hides")
    food = models.ForeignKey(Food, on_delete=models.CASCADE)
    hidden_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["member", "food"], name="uniq_quick_hide")]


class NutritionGoal(TimeStamped):
    """Objetivos que pone el miembro o su coach. La app nunca los calcula sola."""

    member = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="nutrition_goal")
    kcal = models.PositiveIntegerField(null=True, blank=True)
    protein_g = models.PositiveIntegerField(null=True, blank=True)
    carbs_g = models.PositiveIntegerField(null=True, blank=True)
    fat_g = models.PositiveIntegerField(null=True, blank=True)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")

    class Meta:
        verbose_name = "objetivo nutricional"
