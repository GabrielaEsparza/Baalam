"""Storage de Django que guarda los archivos en la tabla StoredFile."""
from django.core.files.base import ContentFile
from django.core.files.storage import Storage
from django.db import connection
from django.utils.deconstruct import deconstructible


@deconstructible
class DatabaseStorage(Storage):
    def _model(self):
        from .models import StoredFile

        return StoredFile

    def _open(self, name, mode="rb"):
        row = self._model().objects.filter(name=name).values_list("content", flat=True).first()
        if row is None:
            raise FileNotFoundError(name)
        f = ContentFile(bytes(row))
        f.name = name
        return f

    def _save(self, name, content):
        if hasattr(content, "seek"):
            content.seek(0)
        data = content.read()
        self._model().objects.update_or_create(name=name, defaults={"content": data, "size": len(data)})
        return name

    def read_range(self, name: str, start: int, length: int) -> bytes:
        """Solo un pedazo del archivo (para videos), sin cargarlo completo en memoria."""
        table = self._model()._meta.db_table
        with connection.cursor() as cur:
            cur.execute(f"SELECT substr(content, %s, %s) FROM {table} WHERE name = %s", [start + 1, length, name])
            row = cur.fetchone()
        if row is None:
            raise FileNotFoundError(name)
        return bytes(row[0])

    def delete(self, name):
        self._model().objects.filter(name=name).delete()

    def exists(self, name):
        return self._model().objects.filter(name=name).exists()

    def size(self, name):
        size = self._model().objects.filter(name=name).values_list("size", flat=True).first()
        if size is None:
            raise FileNotFoundError(name)
        return size

    def url(self, name):
        from django.conf import settings

        return f"{settings.MEDIA_URL}{name}"
