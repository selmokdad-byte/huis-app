# Huis

Een webapp voor iPhone en Android (te installeren op het beginscherm) voor het hele huishouden:

- **Vandaag**: wie er thuis is, de afspraken van vandaag en morgen, jouw taken en snelle scènes.
- **Agenda**: één weekoverzicht met de agenda's van alle huisgenoten (elk in een eigen kleur), plus gezamenlijke afspraken die je in de app maakt.
- **Taken & boodschappen**: gedeelde to-do's met wie, wanneer en herhalen (dagelijks/wekelijks/maandelijks), en een gezamenlijk boodschappenlijstje. Wijzigingen zie je meteen op elkaars telefoon.
- **Huis**: Home Assistant-bediening: lampen, schakelaars, thermostaat, zonwering, sloten, scènes, sensoren.
- **Meldingen**: pushmeldingen op je telefoon bij een nieuwe taak voor jou, een nieuwe gezinsafspraak, 30 minuten voor een afspraak, een ochtendoverzicht, boodschappen, en vanuit Home Assistant-automatiseringen. Iedereen kiest zelf welke.
- **Ik**: je eigen agenda delen, kiezen wat anderen zien (alles of alleen "bezet") en je abonneren op de gezinsagenda in de Agenda-app van je iPhone.

## Als Home Assistant-add-on

Deze map is ook een Home Assistant-add-on (`config.yaml`). Als add-on staat Huis in de zijbalk van Home Assistant en werkt het in de Home Assistant-app op je telefoon, ook onderweg via Nabu Casa. Je bent automatisch ingelogd met je HA-gebruiker, je hebt geen token nodig, en meldingen gaan via de Home Assistant-app. Zie route A in [INSTALLEREN.md](INSTALLEREN.md) en [DOCS.md](DOCS.md).

## Hoe het werkt

```
iPhone (PWA)  ──►  Huis-server (Node)  ──►  Home Assistant (REST API)
                         │
                         ├──►  iCloud / Google / Outlook agenda-links (ICS)
                         └──►  data/huis.json  (taken, boodschappen, afspraken, leden)
```

- De server praat met Home Assistant. Het HA-token staat dus alleen op de server, nooit op de telefoons.
- Agenda's delen gaat via de **geheime ICS-link** die iCloud, Google en Outlook allemaal aanbieden. De server haalt ze elke 10 minuten op en pakt herhalende afspraken uit.
- Inloggen gaat met één **pincode voor het huis**. Daarna kies je wie je bent (of je maakt een profiel). Je blijft 180 dagen ingelogd.

## Installeren

**Volg het stappenplan in [INSTALLEREN.md](INSTALLEREN.md)**, van server tot meldingen op je iPhone. Hieronder de korte versie.

Draai de server op een apparaat dat thuis altijd aan staat en Home Assistant kan bereiken (NAS, Raspberry Pi, of dezelfde machine als HA).

### Met Docker (aanbevolen)

```bash
cp .env.example .env    # vul HUIS_PIN, HA_URL en HA_TOKEN in
docker compose up -d
```

### Zonder Docker (Node 22+)

```bash
npm install
cp .env.example .env
npm start
```

Open daarna `http://<ip-van-de-server>:8080`.

### Home Assistant-token

1. Home Assistant → je profiel (linksonder) → tabblad **Beveiliging**.
2. Onderaan: **Token voor lange levensduur aanmaken**, geef het de naam "Huis-app".
3. Zet het in `.env` als `HA_TOKEN`, met `HA_URL` bijvoorbeeld `http://homeassistant.local:8123`.

In de app tik je bij **Huis → Bewerk** aan welke apparaten op het scherm komen.

## Op je iPhone zetten

1. Open het adres in **Safari**.
2. Deelknop → **Zet op beginscherm**.

Voor gebruik **buiten huis** en de beste app-ervaring heb je HTTPS nodig. Makkelijke opties:

- **Tailscale** op server en telefoons (privé, geen poorten openzetten). Met `tailscale serve` krijg je ook HTTPS.
- **Cloudflare Tunnel** naar `http://localhost:8080`, met een eigen domein.
- Een reverse proxy (Caddy, Nginx Proxy Manager, of de HA-add-on) met een Let's Encrypt-certificaat.

Zet de app niet zonder HTTPS open op internet.

## Agenda delen

Elke huisgenoot doet dit zelf bij **Ik → Mijn agenda's delen**:

| Agenda | Waar vind je de link |
|---|---|
| iPhone / iCloud | Agenda-app → Agenda's → ⓘ naast de agenda → **Openbare agenda** aan → Deel link |
| Google | calendar.google.com → Instellingen → je agenda → **Geheim adres in iCal-indeling** |
| Outlook / Microsoft 365 | Outlook web → Instellingen → Agenda → Gedeelde agenda's → **Een agenda publiceren** → ICS-link |

Per agenda kies je of anderen **alle details** of **alleen "bezet"** zien.

Andersom kan iedereen zich bij **Ik → Gezinsagenda** abonneren op de afspraken en taken uit de app, zodat ze ook in de gewone Agenda-app van de iPhone staan.

## Pushmeldingen

- iPhone: vanaf iOS 16.4, alleen als Huis op het beginscherm staat en via https wordt geopend.
- Android: in Chrome via https. Installeren als app is niet verplicht, maar wel aan te raden.
- De server maakt bij de eerste start zelf de sleutels aan (VAPID, in `data/huis.json`).
- Home Assistant kan meldingen sturen via `POST /api/notify` met `Authorization: Bearer <token>` en de body `{"title", "message", "to"}`. Het token en een kant-en-klaar `rest_command` staan in de app bij **Ik → Meldingen**.

## Instellingen (`.env`)

| Variabele | Betekenis |
|---|---|
| `HUIS_PIN` | Pincode om de app te openen (verplicht) |
| `HA_URL` | Adres van Home Assistant zoals de server het bereikt |
| `HA_TOKEN` | Token voor lange levensduur |
| `VAPID_SUBJECT` | `mailto:` + je e-mailadres, contact voor de pushdiensten |
| `PORT` | Poort van de server (standaard 8080) |
| `TZ` | Tijdzone, standaard `Europe/Amsterdam` in Docker |
| `DATA_DIR` | Map voor `huis.json` (standaard `./data`) |

Maak af en toe een back-up van `data/huis.json`.

## Code

- `server.js`: API, inloggen, live updates (Server-Sent Events)
- `lib/ha.js`: Home Assistant (alleen een vaste lijst veilige acties is toegestaan)
- `lib/calendars.js`: agenda's ophalen en samenvoegen, en de ICS-feed van de gezinsagenda
- `lib/addon.js`: draaien als add-on (Supervisor, ingress, instellingen)
- `lib/push.js`: pushmeldingen, ochtendoverzicht en herinneringen
- `lib/store.js`: opslag in één JSON-bestand
- `public/`: de app zelf (HTML/CSS/JS zonder build-stap), manifest en service worker
