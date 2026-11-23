import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.core.management.base import BaseCommand


def b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


class Command(BaseCommand):
    help = "Genera llaves VAPID nuevas para VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (solo una vez)."

    def handle(self, *args, **opts):
        key = ec.generate_private_key(ec.SECP256R1())
        private = b64(key.private_numbers().private_value.to_bytes(32, "big"))
        public = b64(key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
        self.stdout.write(f"VAPID_PUBLIC_KEY={public}\nVAPID_PRIVATE_KEY={private}")
