from django.contrib import admin

from .models import FavoriteFood, Food, FoodLog, NutritionGoal, QuickHide


@admin.register(Food)
class FoodAdmin(admin.ModelAdmin):
    list_display = ("name", "brand", "source", "basis_unit", "kcal", "protein_g", "carbs_g", "fat_g", "suspicious")
    list_filter = ("source", "suspicious", "is_mexican", "basis_unit")
    search_fields = ("name", "brand", "barcode", "external_id")


@admin.register(FoodLog)
class FoodLogAdmin(admin.ModelAdmin):
    list_display = ("member", "date", "meal", "food_name", "amount", "unit", "kcal")
    list_filter = ("meal",)
    date_hierarchy = "date"
    search_fields = ("member__email", "food_name")


admin.site.register(FavoriteFood)
admin.site.register(QuickHide)
admin.site.register(NutritionGoal)
