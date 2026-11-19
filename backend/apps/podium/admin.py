from django.contrib import admin

from .models import PodiumMonth, PointsLedger


@admin.register(PointsLedger)
class PointsLedgerAdmin(admin.ModelAdmin):
    list_display = ("member", "points", "reason", "month", "note", "created_at")
    list_filter = ("reason", "month")


admin.site.register(PodiumMonth)
