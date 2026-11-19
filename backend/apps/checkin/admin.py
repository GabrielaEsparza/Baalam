from django.contrib import admin

from .models import CheckIn


@admin.register(CheckIn)
class CheckInAdmin(admin.ModelAdmin):
    list_display = ("member", "at", "source")
    list_filter = ("source",)
    date_hierarchy = "date"
