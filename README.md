# Turnieje.pro

Aplikacja internetowa do obsługi zawodów sportowych. Backend został przygotowany w Django i Django REST Framework, frontend w React (Vite + TypeScript), baza danych działa w PostgreSQL, a Redis obsługuje komunikację czasu rzeczywistego dla WebSocket. Całość jest uruchamiana lokalnie przez Docker Compose.


## 1. Uruchomienie do testowania

Ta sekcja opisuje najprostszy sposób uruchomienia aplikacji lokalnie w celu sprawdzenia jej działania. Projekt może zostać uruchomiony z folderu przekazanego na płycie albo pobrany z repozytorium GitHub.

Zalecane jest skopiowanie folderu projektu z płyty na dysk komputera, ponieważ Docker i narzędzia deweloperskie tworzą pliki robocze podczas budowania oraz uruchamiania usług. Nie zaleca się uruchamiania projektu bezpośrednio z płyty.

### Wymagania

Na stanowisku potrzebne są:

- Docker,
- Docker Compose, czyli polecenie `docker compose`,
- wolne porty lokalne: `5173`, `8000`, `5432`, `5050`, `6379`.

Aplikacja była rozwijana w środowisku WSL2 z Dockerem na Windows. Może być również uruchamiana w natywnym Linuksie albo na macOS, jeżeli dostępny jest Docker Compose.

### Wariant A - uruchomienie projektu przekazanego na płycie

Na płycie projekt źródłowy znajduje się w folderze:

```txt
organizator_turniej
```

Najpierw skopiuj folder `organizator_turniej` z płyty na dysk komputera. Następnie przejdź do katalogu projektu.

Przykład dla środowiska Linux albo WSL, jeżeli folder został skopiowany do katalogu domowego użytkownika:

```bash
cd ~/organizator_turniej
```

Jeżeli projekt został skopiowany w inne miejsce, przejdź do właściwej lokalizacji, np.:

```bash
cd /ścieżka/do/organizator_turniej
```

Następnie utwórz lokalny plik konfiguracji na podstawie przykładu:

```bash
cp .env.example .env
```

Uruchom aplikację przez Docker Compose:

```bash
docker compose up --build
```

Pierwsze uruchomienie może potrwać kilka minut, ponieważ Docker buduje obrazy, instaluje zależności, uruchamia bazę danych i wykonuje migracje. Aplikacja jest gotowa, gdy w logach frontendu pojawi się adres `Local: http://localhost:5173/`, a backend nie zgłasza błędów startowych.

Po zakończeniu startu aplikacja jest dostępna pod adresem:

```txt
http://localhost:5173
```

Backend i panel administracyjny Django są dostępne pod adresami:

```txt
http://localhost:8000
http://localhost:8000/admin/
```

### Wariant B - pobranie z GitHuba

Jeżeli zamiast kopii z płyty ma zostać użyta aktualna czysta wersja repozytorium, można pobrać projekt z GitHuba.

Repozytorium GitHub ma charakter pomocniczy i nie stanowi formalnej części pracy inżynierskiej przekazanej do oceny. Podstawowym źródłem projektu jest folder `organizator_turniej` przekazany na nośniku. Dostęp do repozytorium GitHub może w przyszłości ulec zmianie albo być czasowo niedostępny.

Ten wariant wymaga dostępu do internetu oraz zainstalowanego narzędzia Git.

```bash
git clone https://github.com/dawidmk01/aplikacja-internetowa-do-obslugi-zawodow-sportowych.git organizator_turniej
cd organizator_turniej
cp .env.example .env
docker compose up --build
```

### Konto administratora Django

Panel `/admin/` wymaga konta superużytkownika. Można je utworzyć po uruchomieniu kontenerów, w osobnym oknie terminala:

```bash
docker compose exec backend python manage.py createsuperuser
```

Kreator poprosi o adres e-mail oraz hasło. Konto administratora jest potrzebne tylko do sprawdzenia panelu administracyjnego Django. Zwykłe konto użytkownika można utworzyć bezpośrednio w aplikacji webowej.

### Ważna informacja o Mailtrap

Aplikacja uruchomi się bez własnego konta Mailtrap, jednak funkcje wymagające wysyłki wiadomości e-mail nie są częścią podstawowej konfiguracji testowej. Dotyczy to przede wszystkim resetu hasła, zmiany adresu e-mail oraz zaproszeń asystentów.

Aby przetestować wysyłkę wiadomości, trzeba utworzyć własne konto w Mailtrap, skopiować dane SMTP i wpisać je w pliku `.env` w pola:

```env
MAILTRAP_USER=...
MAILTRAP_PASSWORD=...
```

Po zmianie tych wartości należy zrestartować backend:

```bash
docker compose restart backend
```

Wiadomości wysyłane przez aplikację nie trafiają do prawdziwych odbiorców. Są widoczne wyłącznie w skrzynce testowej Mailtrap przypisanej do danych podanych w `.env`.

### Zatrzymanie aplikacji testowej

Jeżeli aplikacja została uruchomiona poleceniem `docker compose up --build`, można ją zatrzymać skrótem `Ctrl+C`. Kontenery można następnie usunąć poleceniem:

```bash
docker compose down
```

Usunięcie kontenerów nie usuwa danych bazy zapisanych w wolumenach. Aby całkowicie wyczyścić środowisko testowe, w tym konta i turnieje, należy użyć:

```bash
docker compose down -v
```

## 2. Pełna konfiguracja lokalna

Wariant testowy opisany wyżej wystarcza do uruchomienia i sprawdzenia aplikacji. Pełniejsza konfiguracja jest potrzebna dopiero wtedy, gdy użytkownik chce dłużej pracować z projektem, testować pocztę albo używać własnych danych dostępowych.

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

**Uwaga o `.env`:** plik z faktycznymi sekretami nigdy nie powinien trafić do repozytorium. Do udostępniania szablonu służy `.env.example`, w którym wartości wrażliwe są zastąpione przykładami.

## 3. Adresy usług

Po uruchomieniu poszczególne usługi dostępne są pod adresami:

| Usługa | Adres | Opis |
|---|---|---|
| Frontend (Vite dev server) | http://localhost:5173 | Aplikacja kliencka |
| Backend (Django API) | http://localhost:8000 | API REST i WebSocket |
| Django admin | http://localhost:8000/admin/ | Panel administracyjny Django |
| pgAdmin | http://localhost:5050 | Panel zarządzania PostgreSQL |
| PostgreSQL | localhost:5432 | Baza danych |
| Redis | localhost:6379 | Magazyn klucz wartość |

Wszystkie porty są przypisane do `127.0.0.1`, więc usługi nie są wystawione na zewnątrz hosta.

## 4. Konfiguracja pgAdmin

Po wejściu na `http://localhost:5050` zaloguj się danymi z `.env`:

- e-mail: wartość `PGADMIN_DEFAULT_EMAIL`,
- hasło: wartość `PGADMIN_DEFAULT_PASSWORD`.

Aby podłączyć bazę z poziomu pgAdmin, dodaj nowy serwer z parametrami:

- Host name: `db`,
- Port: `5432`,
- Maintenance database: wartość `POSTGRES_DB`,
- Username: wartość `POSTGRES_USER`,
- Password: wartość `POSTGRES_PASSWORD`.

Host `db` to nazwa kontenera w sieci Compose, dlatego pgAdmin łączy się przez nią, a nie przez `localhost`.

## 5. Konfiguracja Mailtrap

Aplikacja wysyła wiadomości związane z resetem hasła, zmianą adresu e-mail i zaproszeniami asystentów przez Mailtrap. Mailtrap jest środowiskiem testowym, dlatego wiadomości nie są dostarczane do prawdziwych odbiorców, lecz trafiają do skrzynki testowej w panelu Mailtrap.

Do samego uruchomienia aplikacji konto Mailtrap nie jest wymagane. Bez własnego konta Mailtrap oraz bez podmiany danych `MAILTRAP_USER` i `MAILTRAP_PASSWORD` w pliku `.env` funkcje pocztowe nie będą jednak możliwe do pełnego przetestowania.

Aby włączyć testową wysyłkę wiadomości:

1. Załóż konto na [mailtrap.io](https://mailtrap.io/).
2. W panelu Mailtrap przejdź do `Email Testing -> Inboxes -> wybrana skrzynka -> SMTP Settings`.
3. Skopiuj `Username` i `Password` z sekcji `Show Credentials`.
4. Wpisz wartości w `.env`:
   - `MAILTRAP_USER`,
   - `MAILTRAP_PASSWORD`.
5. Zrestartuj backend:

```bash
docker compose restart backend
```

Od tego momentu wiadomości wysyłane przez aplikację będą widoczne w skrzynce testowej Mailtrap przypisanej do danych podanych w `.env`.

## 6. Komendy administracyjne

Migracje są uruchamiane automatycznie przy starcie kontenera backendu, ale można je wykonać także ręcznie:

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

## 7. Testy i kontrola poprawności

Podstawowa kontrola konfiguracji Django:

```bash
docker compose exec backend python manage.py check
```

Testy automatyczne backendu uruchamiane są w kontenerze backendu:

```bash
# Cały pakiet testów
docker compose exec backend python manage.py test users tournaments -v 1

# Tylko moduł użytkowników
docker compose exec backend python manage.py test users -v 1

# Tylko domena turniejowa
docker compose exec backend python manage.py test tournaments -v 1
```

Kontrola kompilacji frontendu może zostać wykonana lokalnie:

```bash
cd frontend
npm run build
```

albo w kontenerze frontendu:

```bash
docker compose exec frontend npm run build
```

Wynik builda trafia do `frontend/dist/`.

## 8. Najważniejsze zmienne środowiskowe

Pełny zestaw zmiennych znajduje się w `.env.example`. Najważniejsze grupy:

**Django**

| Zmienna | Opis |
|---|---|
| `DJANGO_SECRET_KEY` | Sekret aplikacji. W trybie testowym można pozostawić wartość przykładową. W trybie deweloperskim wygeneruj własny ciąg minimum 50 znaków. |
| `DJANGO_DEBUG` | `1` w środowisku lokalnym, `0` w produkcji |
| `DJANGO_ALLOWED_HOSTS` | Hosty dopuszczone przez Django |
| `DJANGO_CORS_ALLOWED_ORIGINS` | Adresy, z których frontend może wykonywać żądania |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | Adresy zaufane dla ochrony CSRF |
| `DJANGO_WS_ALLOWED_ORIGINS` | Adresy dopuszczone dla połączeń WebSocket |

**JWT i sesja**

| Zmienna | Opis |
|---|---|
| `DJANGO_ACCESS_TOKEN_MINUTES` | Czas życia tokena dostępowego w minutach |
| `DJANGO_REFRESH_TOKEN_DAYS` | Czas życia tokena odświeżającego w dniach |
| `AUTH_REFRESH_COOKIE_*` | Ustawienia ciasteczka z tokenem odświeżającym |

**Baza danych**

| Zmienna | Opis |
|---|---|
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Konfiguracja bazy |
| `POSTGRES_HOST`, `POSTGRES_PORT` | Adres bazy w sieci Compose, domyślnie `db:5432` |

**Frontend**

| Zmienna | Opis |
|---|---|
| `VITE_API_BASE_URL` | Adres API widoczny dla frontendu |
| `VITE_WS_BASE_URL` | Adres WebSocket widoczny dla frontendu |
| `FRONTEND_RESET_URL` | Pełny URL strony resetu hasła używany w wiadomościach e-mail |

## 9. Zatrzymanie i restart

```bash
# Zatrzymanie usług z zachowaniem danych
docker compose stop

# Ponowne uruchomienie
docker compose start

# Pełne zatrzymanie i usunięcie kontenerów, bez usuwania danych z wolumenów
docker compose down

# Pełne czyszczenie razem z danymi bazy
docker compose down -v
```

Polecenie `docker compose down -v` usuwa wolumeny `pgdata` i `pgadmin_data`, więc tracisz wszystkie dane bazy, w tym konta użytkowników i utworzone turnieje. Stosuj je tylko wtedy, gdy chcesz zacząć od zera.

## 10. Struktura projektu

```txt
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

## 11. Rozwiązywanie problemów

**Port zajęty przy starcie**

```txt
Error starting userland proxy: listen tcp 127.0.0.1:5173: bind: address already in use
```

Któryś z portów (`5173`, `8000`, `5432`, `5050`, `6379`) jest już zajęty przez inną aplikację. Zatrzymaj proces lub zmień port w `docker-compose.yml`.

**Backend nie startuje, błąd `could not translate host name db`**

Baza danych nie została jeszcze w pełni uruchomiona. Compose powinien czekać przez healthcheck, ale przy bardzo powolnym dysku może to zająć więcej czasu. Wykonaj:

```bash
docker compose down
docker compose up
```

i odczekaj, aż kontenery zakończą start.

**Frontend pokazuje błędy CORS**

Sprawdź, czy `DJANGO_CORS_ALLOWED_ORIGINS` w `.env` zawiera `http://localhost:5173`. Po zmianie `.env` zrestartuj backend:

```bash
docker compose restart backend
```

**Hot reload frontendu nie działa**

W Windows z WSL2 czasem trzeba dodać w `frontend/vite.config.ts` opcję `server.watch.usePolling: true`. Sprawdź, czy projekt znajduje się w systemie plików WSL, a nie w `/mnt/c/`, ponieważ praca w `/mnt/c/` może znacząco spowalniać działanie narzędzi deweloperskich.

**Wiadomości e-mail nie docierają**

Aplikacja używa Mailtrap, czyli środowiska sandbox. Wiadomości nie są wysyłane do prawdziwych odbiorców, lecz trafiają wyłącznie do skrzynki testowej w Mailtrap. Sprawdź, czy `MAILTRAP_USER` i `MAILTRAP_PASSWORD` w `.env` są ustawione poprawnie.

## 12. Wdrożenie produkcyjne

Konfiguracja w `docker-compose.yml` została zaprojektowana wyłącznie do uruchomienia lokalnego:

- backend uruchamia `runserver`, czyli serwer deweloperski Django,
- frontend uruchamia `npm run dev`, czyli serwer Vite z hot reload,
- `DJANGO_DEBUG=1`,
- połączenia działają bez TLS.

Wdrożenie publiczne wymaga osobnych przygotowań, między innymi:

- obrazu backendu z Gunicornem albo Uvicornem zamiast `runserver`,
- statycznego buildu Vite za serwerem Nginx zamiast `npm run dev`,
- ustawienia `DJANGO_DEBUG=0` i `DJANGO_SECURE_SSL_REDIRECT=1`,
- własnej domeny w `DJANGO_ALLOWED_HOSTS`, `VITE_API_BASE_URL`, `VITE_WS_BASE_URL`,
- prawdziwego dostawcy SMTP zamiast Mailtrap,
- certyfikatu TLS, kopii zapasowych, monitoringu i sekretów przechowywanych poza repozytorium.

Wskazówki znajdują się w komentarzach w `.env.example`, w sekcji `Production hints`. Pełne przygotowanie środowiska produkcyjnego zostało wymienione w pracy inżynierskiej jako jeden z kierunków dalszego rozwoju.
