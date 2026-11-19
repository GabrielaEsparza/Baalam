from django.contrib import admin

from .models import Booking, Schedule, Session, WaitlistEntry


@admin.register(Schedule)
class ScheduleAdmin(admin.ModelAdmin):
    list_display = ("name", "type", "weekdays", "start_time", "duration_min", "capacity", "requires_reservation", "active")
    list_filter = ("type", "active")


@admin.register(Session)
class SessionAdmin(admin.ModelAdmin):
    list_display = ("schedule", "date", "start_at", "capacity", "cancelled")
    list_filter = ("schedule", "cancelled")
    date_hierarchy = "date"


@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    list_display = ("member", "session", "month", "status")
    list_filter = ("status", "month")
    search_fields = ("member__email", "member__profile__full_name")


admin.site.register(WaitlistEntry)
