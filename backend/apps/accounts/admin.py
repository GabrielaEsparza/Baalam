from django.contrib import admin

from .models import Profile


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ("full_name", "user", "phone", "birth_date", "role", "status")
    list_filter = ("role", "status")
    search_fields = ("full_name", "user__email", "phone")
