from django.contrib import admin

from . import models as m


@admin.register(m.Exercise)
class ExerciseAdmin(admin.ModelAdmin):
    list_display = ("name_es", "muscle_group", "equipment", "source", "active")
    list_filter = ("source", "muscle_group", "active")
    search_fields = ("name_es",)


class TemplateItemInline(admin.TabularInline):
    model = m.TemplateItem
    extra = 0


@admin.register(m.TemplateDay)
class TemplateDayAdmin(admin.ModelAdmin):
    inlines = [TemplateItemInline]


class TemplateDayInline(admin.TabularInline):
    model = m.TemplateDay
    extra = 0


@admin.register(m.RoutineTemplate)
class RoutineTemplateAdmin(admin.ModelAdmin):
    inlines = [TemplateDayInline]


class ScheduledItemInline(admin.TabularInline):
    model = m.ScheduledItem
    extra = 0


@admin.register(m.ScheduledWorkout)
class ScheduledWorkoutAdmin(admin.ModelAdmin):
    list_display = ("member", "date", "title", "status")
    list_filter = ("status",)
    inlines = [ScheduledItemInline]


class SetLogInline(admin.TabularInline):
    model = m.SetLog
    extra = 0


@admin.register(m.WorkoutSession)
class WorkoutSessionAdmin(admin.ModelAdmin):
    list_display = ("member", "started_at", "finished_at", "total_volume_kg")
    inlines = [SetLogInline]


@admin.register(m.DaySwap)
class DaySwapAdmin(admin.ModelAdmin):
    list_display = ("member", "date", "template_day")
    list_filter = ("date",)
