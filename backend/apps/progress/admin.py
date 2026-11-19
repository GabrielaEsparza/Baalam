from django.contrib import admin

from .models import BodyLog, ProgressPhoto


@admin.register(BodyLog)
class BodyLogAdmin(admin.ModelAdmin):
    list_display = ("member", "date", "weight_kg", "waist_cm", "body_fat_pct")


admin.site.register(ProgressPhoto)
