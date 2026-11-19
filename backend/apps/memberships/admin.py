from django.contrib import admin

from .models import GymSettings, Membership, MembershipRequest, Payment, Plan


@admin.register(GymSettings)
class GymSettingsAdmin(admin.ModelAdmin):
    def has_add_permission(self, request):
        return not GymSettings.objects.exists()


@admin.register(Plan)
class PlanAdmin(admin.ModelAdmin):
    list_display = ("name", "price_mxn", "includes_routine", "includes_open_gym", "includes_classes", "active")


class PaymentInline(admin.TabularInline):
    model = Payment
    extra = 0
    readonly_fields = ("registered_by",)


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display = ("member", "plan", "start_date", "end_date", "status", "sessions_per_week")
    list_filter = ("status", "plan")
    search_fields = ("member__email", "member__profile__full_name")
    inlines = [PaymentInline]


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ("member", "amount_mxn", "method", "paid_at", "registered_by")
    list_filter = ("method",)
    date_hierarchy = "paid_at"


@admin.register(MembershipRequest)
class RequestAdmin(admin.ModelAdmin):
    list_display = ("member", "type", "plan", "status", "created_at")
    list_filter = ("type", "status")
