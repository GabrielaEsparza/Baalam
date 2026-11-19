from django.apps import AppConfig


class AccountsConfig(AppConfig):
    name = "apps.accounts"
    label = "accounts"
    verbose_name = "Cuentas"

    def ready(self):
        from django.contrib.auth import get_user_model
        from django.db.models.signals import post_save

        from .services import ensure_profile

        def on_user_saved(sender, instance, created, **kwargs):
            if created:
                ensure_profile(instance)

        post_save.connect(on_user_saved, sender=get_user_model(), dispatch_uid="baalam_profile")
