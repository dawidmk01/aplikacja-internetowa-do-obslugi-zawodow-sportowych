# Turnieje.pro

Aplikacja internetowa do obsługi zawodów sportowych. Backend w Django i Django REST Framework, frontend w React (Vite + TypeScript), baza PostgreSQL, Redis dla komunikacji czasu rzeczywistego (WebSocket). Całość uruchamiana w Docker Compose.

Repozytorium: https://github.com/dawidmk01/aplikacja-internetowa-do-obslugi-zawodow-sportowych

## Tryby uruchomienia

Konfiguracja w pliku `docker-compose.yml` jest dostosowana do uruchomienia lokalnego. W zależności od celu uruchomienia stosuje się jeden z dwóch wariantów:

| Tryb | Cel | Konfiguracja |
|---|---|---|
| **Lokalny testowy (demo)** | Recenzent, promotor albo każdy chcący zobaczyć działanie aplikacji. Wystarczy raz uruchomić, zobaczyć, zamknąć. | Zostaw wszystkie wartości z `.env.example`. Sekret Django, hasła i dane Mailtrap mogą pozostać przykładowe. |
| **Lokalny deweloperski (dev)** | Praca nad kodem, dłuższe sesje, własne dane testowe, własne konto Mailtrap. | Wygeneruj własny `DJANGO_SECRET_KEY`, ustaw mocne hasła PostgreSQL i pgAdmin, podaj prawdziwe dane konta Mailtrap. |

Wdrożenie produkcyjne (publiczna domena, certyfikat TLS, prawdziwy SMTP) jest poza zakresem niniejszego repozytorium i zostało wymienione w pracy inżynierskiej jako kierunek dalszego rozwoju. Krótkie wskazówki znajdują się na końcu dokumentu.

## Wymagania wstępne

Na stanowisku potrzebne są:

- Docker (silnik kontenerów)
- Docker Compose (plugin dołączany do współczesnych wersji Dockera, polecenie `docker compose`)
- Wolne porty na localhost: `5173`, `8000`, `5432`, `5050`, `6379`

Aplikacja była rozwijana w środowisku WSL2 z Dockerem na Windows, działa też w natywnym Linuksie i na macOS.

## Szybki start (tryb lokalny testowy)

```bash
# 1. Sklonuj repozytorium i wejdź do katalogu projektu
git clone https://github.com/dawidmk01/aplikacja-internetowa-do-obslugi-zawodow-sportowych.git organizator_turniej
cd organizator_turniej

# 2. Skopiuj przykładowy plik zmiennych środowiskowych
cp .env.example .env

# 3. Zbuduj i uruchom usługi
docker compose up --build
```

Trzy kroki wystarczą, aby zobaczyć działającą aplikację. Pierwszy start może potrwać kilka minut (budowanie obrazów, instalacja zależności npm, migracje bazy danych). Po pojawieniu się komunikatu `Quit the server with CONTROL-C.` w logach backendu oraz `Local: http://localhost:5173/` w logach frontendu aplikacja jest gotowa.

W tym trybie wiadomości e-mail z aplikacji nie wymagają konfiguracji konta Mailtrap, ponieważ funkcje powiązane z pocztą (reset hasła, zmiana adresu e-mail, zaproszenia asystentów) można pominąć w demonstracji. Jeśli jednak chcesz je przetestować, zobacz sekcję „Konfiguracja Mailtrap".

## Pełna konfiguracja (tryb lokalny deweloperski)

Po wykonaniu kroków z „Szybkiego startu" warto dodatkowo:

```bash
# A. Wygeneruj losowy sekret Django i wklej do .env w pole DJANGO_SECRET_KEY
python3 -c "import secrets; print(secrets.token_urlsafe(64))"

# B. Zmień hasła w .env:
#    POSTGRES_PASSWORD        - własne mocne hasło
#    PGADMIN_DEFAULT_PASSWORD - własne mocne hasło

# C. Załóż własne konto na mailtrap.io i wpisz w .env:
#    MAILTRAP_USER, MAILTRAP_PASSWORD

# D. Po zmianach w .env zrestartuj backend
docker compose restart backend
```

**Uwaga o `.env`:** plik z faktycznymi sekretami nigdy nie powinien trafić do repozytorium. Sprawdź, czy `.env` jest wymieniony w `.gitignore`. Do udostępniania szablonu służy `.env.example`, w którym wszystkie wartości wrażliwe są zastąpione przykładowymi.

## Adresy usług

Po uruchomieniu poszczególne usługi dostępne są pod adresami:

| Usługa | Adres | Opis |
|---|---|---|
| Frontend (Vite dev server) | http://localhost:5173 | Aplikacja kliencka |
| Backend (Django API) | http://localhost:8000 | API REST i WebSocket |
| Django admin | http://localhost:8000/admin/ | Panel administracyjny Django |
| pgAdmin | http://localhost:5050 | Panel zarządzania PostgreSQL |
| PostgreSQL | localhost:5432 | Baza danych (bezpośredni dostęp) |
| Redis | localhost:6379 | Magazyn klucz wartość |

Wszystkie porty są przypisane do `127.0.0.1`, więc usługi nie są wystawione na zewnątrz hosta.

## Pierwsze logowanie do panelu admin Django

Aby uzyskać dostęp do panelu `/admin/`, utwórz konto superużytkownika:

```bash
docker compose exec backend python manage.py createsuperuser
```

Kreator zapyta o adres e-mail i hasło. Po utworzeniu konta zaloguj się na `http://localhost:8000/admin/`.

Krok ten jest opcjonalny dla zwykłej obsługi aplikacji przez interfejs `http://localhost:5173`. Konto rejestrujesz wówczas przez formularz rejestracji w aplikacji.

## Konfiguracja pgAdmin

Po wejściu na `http://localhost:5050` zaloguj się danymi z `.env`:

- e-mail: wartość `PGADMIN_DEFAULT_EMAIL`
- hasło: wartość `PGADMIN_DEFAULT_PASSWORD`

Aby podłączyć bazę z poziomu pgAdmin, dodaj nowy serwer z parametrami:

- Host name: `db`
- Port: `5432`
- Maintenance database: wartość `POSTGRES_DB`
- Username: wartość `POSTGRES_USER`
- Password: wartość `POSTGRES_PASSWORD`

Host `db` to nazwa kontenera w sieci Compose, dlatego pgAdmin łączy się przez nią, a nie przez `localhost`.

## Konfiguracja Mailtrap

Aplikacja wysyła wiadomości (reset hasła, zmiana adresu e-mail, zaproszenia asystentów) przez Mailtrap, czyli środowisko sandbox do testów wiadomości. Wiadomości nie są dostarczane do prawdziwych odbiorców, trafiają jedynie do panelu Mailtrap.

W trybie lokalnym testowym konfiguracja Mailtrap nie jest wymagana do uruchomienia aplikacji, a funkcje powiązane z pocztą można pominąć w demonstracji.

W trybie deweloperskim warto skonfigurować własne konto:

1. Załóż konto na [mailtrap.io](https://mailtrap.io/)
2. W panelu Mailtrap przejdź do Email Testing → Inboxes → wybrana skrzynka → SMTP Settings
3. Skopiuj `Username` i `Password` z sekcji „Show Credentials"
4. Wpisz wartości w `.env`:
   - `MAILTRAP_USER`
   - `MAILTRAP_PASSWORD`
5. Zrestartuj backend: `docker compose restart backend`

Wszystkie wiadomości wysłane przez aplikację trafią do Twojej skrzynki testowej w Mailtrap, bez wysyłki do prawdziwych odbiorców.

## Komendy administracyjne

Migracje (uruchamiane automatycznie przy starcie, ale można też ręcznie):

```bash
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py makemigrations
```

Powłoka Django:

```bash
docker compose exec backend python manage.py shell
```

Zbieranie plików statycznych:

```bash
docker compose exec backend python manage.py collectstatic --noinput
```

Dostęp do bazy PostgreSQL z poziomu wiersza poleceń:

```bash
docker compose exec db psql -U turnieje -d turnieje
```

## Testy

Testy automatyczne backendu uruchamiane są w kontenerze backendu:

```bash
# Cały pakiet testów
docker compose exec backend python manage.py test users tournaments -v 1

# Tylko moduł użytkowników
docker compose exec backend python manage.py test users -v 1

# Tylko domena turniejowa
docker compose exec backend python manage.py test tournaments -v 1
```

Kontrola kompilacji frontendu:

```bash
docker compose exec frontend npm run build
```

Wynik builda trafia do `frontend/dist/`.

## Najważniejsze zmienne środowiskowe

Pełny zestaw zmiennych znajduje się w `.env.example`. Najważniejsze grupy:

**Django**

| Zmienna | Opis |
|---|---|
| `DJANGO_SECRET_KEY` | Sekret aplikacji. W trybie testowym można pozostawić wartość przykładową. W trybie deweloperskim wygeneruj własny ciąg minimum 50 znaków. |
| `DJANGO_DEBUG` | `1` w środowisku lokalnym, `0` w produkcji |
| `DJANGO_ALLOWED_HOSTS` | Hosty dopuszczone przez Django (oddzielone przecinkami) |
| `DJANGO_CORS_ALLOWED_ORIGINS` | Adresy, z których frontend może wykonywać żądania |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | Adresy zaufane dla ochrony CSRF |
| `DJANGO_WS_ALLOWED_ORIGINS` | Adresy dopuszczone dla połączeń WebSocket |

**JWT i sesja**

| Zmienna | Opis |
|---|---|
| `DJANGO_ACCESS_TOKEN_MINUTES` | Czas życia tokena dostępowego (minuty) |
| `DJANGO_REFRESH_TOKEN_DAYS` | Czas życia tokena odświeżającego (dni) |
| `AUTH_REFRESH_COOKIE_*` | Ustawienia ciasteczka z tokenem odświeżającym |

**Baza danych**

| Zmienna | Opis |
|---|---|
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Konfiguracja bazy |
| `POSTGRES_HOST`, `POSTGRES_PORT` | Adres bazy w sieci Compose (`db:5432`) |

**Frontend**

| Zmienna | Opis |
|---|---|
| `VITE_API_BASE_URL` | Adres API widoczny dla frontendu |
| `VITE_WS_BASE_URL` | Adres WebSocket widoczny dla frontendu |
| `FRONTEND_RESET_URL` | Pełny URL strony resetu hasła (używany w wiadomościach e-mail) |

## Zatrzymanie i restart

```bash
# Zatrzymanie usług z zachowaniem danych
docker compose stop

# Ponowne uruchomienie
docker compose start

# Pełne zatrzymanie i usunięcie kontenerów (dane w wolumenach pozostają)
docker compose down

# Pełne czyszczenie razem z danymi bazy
docker compose down -v
```

Polecenie `docker compose down -v` usuwa wolumeny `pgdata` i `pgadmin_data`, więc tracisz wszystkie dane bazy, w tym konta użytkowników i utworzone turnieje. Stosuj tylko gdy chcesz zacząć od zera.

## Struktura projektu

```
organizator_turniej/
├── backend/                 # Aplikacja Django
│   ├── config/              # Konfiguracja globalna, routing, ASGI
│   ├── users/               # Konto użytkownika, sesje, bezpieczeństwo
│   ├── tournaments/         # Domena turniejowa
│   ├── manage.py
│   └── Dockerfile
├── frontend/                # Aplikacja React (Vite + TypeScript)
│   ├── src/
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
├── .env.example             # Wzór konfiguracji środowiskowej
└── README.md
```

## Rozwiązywanie problemów

**Port zajęty przy starcie**

```
Error starting userland proxy: listen tcp 127.0.0.1:5173: bind: address already in use
```

Któryś z portów (`5173`, `8000`, `5432`, `5050`, `6379`) jest już zajęty przez inną aplikację. Zatrzymaj proces lub zmień port w `docker-compose.yml`.

**Backend nie startuje, błąd „could not translate host name db"**

Baza nie zdążyła wstać. Compose powinien czekać przez healthcheck, ale przy bardzo powolnym dysku może to zawieść. Wykonaj `docker compose down`, potem `docker compose up` i odczekaj.

**Frontend pokazuje błędy CORS**

Sprawdź, czy `DJANGO_CORS_ALLOWED_ORIGINS` w `.env` zawiera `http://localhost:5173`. Po zmianie `.env` zrestartuj backend: `docker compose restart backend`.

**Hot reload frontendu nie działa**

W Windows z WSL2 czasem trzeba dodać w `frontend/vite.config.ts` opcję `server.watch.usePolling: true`. Sprawdź, czy projekt znajduje się w systemie plików WSL, a nie w `/mnt/c/`, ponieważ to drugie znacznie spowalnia pracę.

**Wiadomości e-mail nie docierają**

Aplikacja używa Mailtrap (sandbox), więc wiadomości NIE są wysyłane do prawdziwych odbiorców. Trafiają wyłącznie do Twojej skrzynki testowej w Mailtrap. Sprawdź panel Mailtrap, czy `MAILTRAP_USER` i `MAILTRAP_PASSWORD` w `.env` są ustawione poprawnie.

## Wdrożenie produkcyjne

Konfiguracja w `docker-compose.yml` została zaprojektowana wyłącznie do uruchomienia lokalnego:

- Backend uruchamia `runserver` (serwer deweloperski Django)
- Frontend uruchamia `npm run dev` (serwer Vite z hot reload)
- `DJANGO_DEBUG=1`
- Połączenia bez TLS

Wdrożenie publiczne wymaga osobnych przygotowań, między innymi:

- Obraz backendu z Gunicornem albo Uvicornem zamiast `runserver`
- Statyczny build Vite za serwerem Nginx zamiast `npm run dev`
- `DJANGO_DEBUG=0` i `DJANGO_SECURE_SSL_REDIRECT=1`
- Własna domena w `DJANGO_ALLOWED_HOSTS`, `VITE_API_BASE_URL`, `VITE_WS_BASE_URL`
- Prawdziwy dostawca SMTP zamiast Mailtrap
- Certyfikat TLS, kopie zapasowe, monitoring, sekrety w menedżerze sekretów

Wskazówki znajdują się w komentarzach w `.env.example` (sekcja „Production hints"). Pełne przygotowanie środowiska produkcyjnego zostało wymienione w pracy inżynierskiej jako jeden z kierunków dalszego rozwoju.
