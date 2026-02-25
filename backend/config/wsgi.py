# backend/config/wsgi.py
# Plik udostępnia punkt wejścia WSGI dla środowisk wymagających klasycznego serwera HTTP.

import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

application = get_wsgi_application()
