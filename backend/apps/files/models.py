from django.db import models


class StoredFile(models.Model):
    """Archivo subido (foto de perfil, foto/video de ejercicio) guardado en Postgres.

    Railway borra el disco del contenedor en cada deploy; la base de datos no. Las fotos
    se guardan ya recortadas (≈40 KB), así que 200 personas ocupan unos 10 MB.
    """

    name = models.CharField(max_length=255, unique=True)
    content = models.BinaryField()
    size = models.PositiveIntegerField()
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "archivo"
