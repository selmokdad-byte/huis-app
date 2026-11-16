# Stappenplan: Huis installeren

Er zijn twee manieren. Kies er één.

| | **A. Als Home Assistant-add-on** (aanbevolen) | **B. Op een eigen server met Docker** |
|---|---|---|
| Voor wie | Home Assistant OS of Supervised (bijv. Raspberry Pi, HA Green, HA Yellow) | Home Assistant Container/Core, of je hebt een NAS of mini-pc |
| Extra apparaat nodig | Nee | Ja, iets dat altijd aan staat |
| Https regelen | Niet nodig, gaat via Home Assistant | Wel nodig (Tailscale of Cloudflare) |
| Op je telefoon | In de **Home Assistant-app** | Als losse app op je beginscherm |
| Meldingen | Via de Home Assistant-app | Webmeldingen |
| Huisgenoten | Hebben elk een Home Assistant-gebruiker nodig | Alleen de pincode |
| Tijd | 15 minuten | 30 tot 45 minuten |

Weet je niet welke Home Assistant je hebt? Kijk bij **Instellingen → Over**. Staat daar *Home Assistant OS* of *Supervised*, dan kun je route A gebruiken.

Je kunt ook allebei: de add-on in Home Assistant, plus de losse app voor wie geen Home Assistant-account wil. Zie "Huis als losse app" onderaan route A.

---

# Route A: Home Assistant-add-on

## A1. De add-on in Home Assistant zetten

1. Ga in Home Assistant naar **Instellingen → Add-ons → Add-on store**.
2. Tik rechtsboven op **⋮ → Repositories**.
3. Plak `https://github.com/selmokdad-byte/huis-app` en tik op **Toevoegen**, en daarna op **Sluiten**.
4. Ververs de pagina. Onderaan staat nu **Huis add-ons** met **Huis** erin.
5. Tik op **Huis** en kies **Installeren**. Op een Raspberry Pi duurt dat een paar minuten, want de add-on wordt op je eigen apparaat gebouwd.

Op een computer kan het ook met de knop **Add repository to my Home Assistant** op de GitHub-pagina van de repository.

## A2. Starten

1. Zet op de pagina van de add-on **Toon in zijbalk** aan, en **Start bij opstarten** en **Watchdog**.
2. Tik op **Starten**.
3. Klik in de zijbalk op **Huis**. Je bent automatisch ingelogd met je Home Assistant-account.
4. Maak je profiel. Je naam staat al ingevuld. Kies je kleur.

Je hebt **geen token** nodig: de add-on praat rechtstreeks met Home Assistant.

## A3. Huisgenoten toevoegen

Elke huisgenoot heeft een eigen Home Assistant-gebruiker nodig.

1. **Instellingen → Personen → Persoon toevoegen**. Zet **inloggen toestaan** aan en maak een gebruikersnaam en wachtwoord. **Beheerder** hoeft niet aan.
2. De huisgenoot logt in (zie A4), opent **Huis** en maakt een eigen profiel.

## A4. Op je telefoon

1. Installeer de **Home Assistant-app** uit de App Store of Play Store.
2. Log in met je eigen Home Assistant-gebruiker.
3. Open het menu (☰) en tik op **Huis**.

Onderweg werkt dit als je Home Assistant ook buitenshuis kunt bereiken, bijvoorbeeld met **Home Assistant Cloud (Nabu Casa)**.

## A5. Meldingen aanzetten

1. Open **Huis → Ik**.
2. Kies onder **Meldingen via de Home Assistant-app** je eigen telefoon.
3. Je krijgt meteen een testmelding.
4. Kies welke meldingen je wilt en hoe laat je het ochtendoverzicht krijgt.

Staat je telefoon er niet bij? Open dan eerst één keer de Home Assistant-app en geef toestemming voor meldingen.

## A6. Agenda koppelen

Precies zoals in stap 8 hieronder: **Huis → Ik → Mijn agenda's delen**.

## A7. Meldingen vanuit automatiseringen (optioneel)

**Huis → Ik → Meldingen sturen vanuit Home Assistant** geeft een kant-en-klaar stukje voor `configuration.yaml`. Het adres daarin werkt meteen; je hoeft niets aan te passen.

## Huis als losse app (optioneel, naast de add-on)

Voor wie Huis als losse app met eigen icoon wil, bijvoorbeeld een huisgenoot zonder Home Assistant-account:

1. Stel bij de add-on onder **Configuratie** een **pincode** in (minimaal 8 cijfers) en herstart de add-on.
2. Thuis is Huis nu bereikbaar op `http://homeassistant.local:8765`.
3. Voor gebruik onderweg en voor webmeldingen op de iPhone heb je https nodig. Gebruik de **Tailscale**-add-on (`tailscale serve` naar poort 8765) of de **Cloudflared**-add-on met een eigen domein.
4. Ga daarna verder bij stap 5 van route B hieronder.

## Updaten

Nieuwe versies verschijnen vanzelf bij **Instellingen → Updates**. Tik op **Bijwerken**. Je gegevens blijven bewaard. Wil je meteen kijken, kies dan in de Add-on store **⋮ → Controleer op updates**.

---

# Route B: eigen server met Docker

Reken op 30 tot 45 minuten. Daarna doet elke huisgenoot alleen stap 5 tot en met 9 op de eigen telefoon (5 minuten).

## Zo zit het in elkaar

1. **De server**: draait thuis op een apparaat dat altijd aan staat. Bewaart taken en afspraken, praat met Home Assistant en verstuurt de meldingen.
2. **De app op je telefoon**: een webapp die je via Safari (iPhone) of Chrome (Android) op je beginscherm zet. Er is geen App Store of Play Store nodig.

Pushmeldingen werken alleen als de app via **https://** wordt geopend. Op de iPhone moet hij bovendien op het beginscherm staan. Daarom zit er een stap in om een beveiligde verbinding te maken (stap 4).

## Wat je nodig hebt

- [ ] Een iPhone met **iOS 16.4 of nieuwer**, of een Android-telefoon met een actuele versie van **Chrome**. iPhones en Android-telefoons kunnen door elkaar.
- [ ] Een apparaat dat **altijd aan** staat en **Docker** kan draaien: een NAS (Synology, QNAP), een mini-pc, een Raspberry Pi 4/5 of een oude laptop
- [ ] Home Assistant, en je kunt erop inloggen als beheerder
- [ ] Voor B2 in stap 4: een eigen domeinnaam (bijv. `jouwnaam.nl`)

## Stap 1: Code op de server zetten

Log in op je server (bijvoorbeeld met `ssh`) en voer uit:

```bash
git clone https://github.com/selmokdad-byte/huis-app.git
```

```bash
cd huis-app/huis
```

## Stap 2: Instellingen invullen

```bash
cp .env.example .env
```

```bash
nano .env
```

Vul in:

| Regel | Wat je invult |
|---|---|
| `HUIS_PIN` | Een pincode van **minimaal 8 cijfers**. Geen geboortedatum. |
| `HA_URL` | Het adres van Home Assistant, gezien vanaf de server. Bijvoorbeeld `http://192.168.1.10:8123` |
| `HA_TOKEN` | Zie hieronder |
| `VAPID_SUBJECT` | `mailto:` plus je eigen e-mailadres. Apple gebruikt dit alleen als contactadres voor de meldingen. |

**Home Assistant-token maken:**

1. Open Home Assistant en klik linksonder op je naam (profiel).
2. Kies bovenaan het tabblad **Beveiliging**.
3. Scroll naar **Tokens voor lange levensduur** en kies **Token aanmaken**.
4. Noem het `Huis-app`, kopieer het token (je ziet het maar één keer) en plak het achter `HA_TOKEN=`.

Opslaan in nano: `Ctrl+O`, `Enter`, `Ctrl+X`.

## Stap 3: Starten

```bash
docker compose up -d --build
```

Controleer of het draait:

```bash
docker compose logs --tail 20
```

Je ziet `Huis-app draait op http://localhost:8080`. Open op een laptop in hetzelfde wifi-netwerk `http://<ip-van-de-server>:8080`. Je krijgt dan het pincode-scherm te zien.

## Stap 4: Beveiligde verbinding (https) maken

Kies **één** van deze twee.

### B1: Tailscale (gratis, geen domein nodig, meest privé)

Alleen telefoons met Tailscale erop kunnen de app openen. Meldingen komen ook binnen als Tailscale uit staat, omdat die via Apple gaan.

1. Maak een gratis account op tailscale.com.
2. Installeer Tailscale op de server:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   ```
   ```bash
   sudo tailscale up
   ```
   Open de link die verschijnt en log in.
3. Ga in de Tailscale-beheeromgeving naar **DNS**. Zet **MagicDNS** aan en daaronder **HTTPS Certificates**.
4. Zet de app open binnen je Tailscale-netwerk:
   ```bash
   sudo tailscale serve --bg 8080
   ```
   Je krijgt een adres als `https://server.tail1234.ts.net`. **Dit is het adres van je app.**
5. Elke huisgenoot installeert de **Tailscale-app** (App Store of Play Store) en logt in. Gebruik hetzelfde account, of nodig ze uit via **Users → Invite** in de beheeromgeving.
6. Tip: zorg dat de verbinding vanzelf aan staat. Op de iPhone helpt **VPN On Demand**, op Android **Altijd-aan VPN** (Instellingen → Netwerk → VPN → ⚙️ naast Tailscale).

### B2: Cloudflare Tunnel (eigen domein, geen app nodig op de telefoons)

Iedereen met het adres en de pincode kan de app openen. Kies daarom een sterke pincode.

1. Zet je domein bij Cloudflare (gratis abonnement is genoeg).
2. Ga in het Cloudflare-dashboard naar **Zero Trust → Networks → Tunnels → Create a tunnel**. Kies **Cloudflared**, geef hem de naam `huis` en kopieer het **token** uit het installatiecommando (de lange tekst na `--token`).
3. Zet in `.env`:
   ```
   CLOUDFLARE_TUNNEL_TOKEN=<het token>
   ```
4. Haal in `docker-compose.yml` de `#` weg voor het blok `cloudflared` en start opnieuw:
   ```bash
   docker compose up -d
   ```
5. Voeg in Cloudflare bij de tunnel een **Public hostname** toe: subdomein `huis`, jouw domein, type **HTTP**, URL `huis:8080`.
6. **Het adres van je app** is nu `https://huis.jouwdomein.nl`.

---

## Stap 5: De app op je telefoon zetten

### iPhone

1. Open **Safari**. Het moet Safari zijn, niet Chrome.
2. Ga naar het adres uit stap 4 (bijv. `https://huis.jouwdomein.nl`).
3. Tik op de **deelknop** (vierkantje met pijl omhoog, onderin).
4. Scroll en kies **Zet op beginscherm**, en tik op **Voeg toe**.
5. Sluit Safari en open **Huis** via het nieuwe oranje icoon.

### Android

1. Open **Chrome**.
2. Ga naar het adres uit stap 4 (bijv. `https://huis.jouwdomein.nl`).
3. Tik rechtsboven op **⋮** en kies **App installeren** (op sommige telefoons heet het **Toevoegen aan startscherm**). Na het inloggen staat er ook een knop **Installeer Huis** onderaan bij **Ik**.
4. Bevestig met **Installeren**.
5. Open **Huis** via het nieuwe oranje icoon op je startscherm of in je app-lade.

Op Android kun je het Huis-icoon ingedrukt houden voor snelkoppelingen naar **Agenda**, **Taken** en **Huis**.

## Stap 6: Inloggen en je profiel maken

1. Vul de pincode in. Op de iPhone moet dit in de beginscherm-app mogelijk nog een keer, ook als je het in Safari al deed: iOS houdt die twee gescheiden.
2. Kies **Ik ben nieuw**, vul je naam in en kies je kleur.

## Stap 7: Meldingen aanzetten

1. Tik onderin op **Ik**.
2. Tik onder **Meldingen** op **Zet meldingen aan**.
3. Kies **Sta toe** in de vraag van je telefoon.
4. Je krijgt direct een testmelding: *"Het werkt! 🎉"*.
5. Kies welke meldingen je wilt en hoe laat je het ochtendoverzicht krijgt.

Je kunt meldingen krijgen bij:

| Melding | Standaard |
|---|---|
| Iemand geeft jou een taak | aan |
| Nieuwe gezinsafspraak voor jou of iedereen | aan |
| Herinnering 30 minuten voor een gezinsafspraak | aan |
| Ochtendoverzicht met afspraken en taken van vandaag | aan, om 08:00 |
| Iemand zet iets op het boodschappenlijstje | uit |
| Home Assistant (zie stap 10) | aan |

## Stap 8: Je agenda delen

1. Blijf bij **Ik → Mijn agenda's delen**.
2. Zoek de link van je agenda.
   - **iPhone-/iCloud-agenda**: open de **Agenda**-app → onderin **Agenda's** → **ⓘ** naast de agenda → zet **Openbare agenda** aan → **Deel link… → Kopieer**.
   - **Google Agenda (de meeste Android-telefoons)**: dit kan niet in de app op je telefoon. Open in Chrome `calendar.google.com`, kies via **⋮** de optie **Desktopversie**, en ga naar ⚙️ **Instellingen** → kies je agenda → **Agenda integreren** → kopieer het **Geheime adres in iCal-indeling**.
3. Plak de link in Huis, geef de agenda een naam (bijv. *Werk*) en kies of anderen **alle details** of **alleen "bezet"** zien.
4. Tik op **Koppel agenda**.

Voor Outlook staat de uitleg in de app onder de knop.

## Stap 9: Gezinsagenda in je gewone agenda-app (optioneel)

- **iPhone**: tik bij **Ik → Gezinsagenda** op **Abonneer in Agenda** en dan op **Abonneer**. De afspraken en taken uit Huis staan dan ook in de Agenda-app van je iPhone.
- **Android**: tik bij **Ik → Gezinsagenda** op **Toevoegen aan Google Agenda** en bevestig met **Toevoegen**. Daarna staat de agenda ook in de Google Agenda-app.
  - Google haalt de agenda zelf via internet op. Dat lukt alleen met B2 (Cloudflare) uit stap 4, of met een server in de cloud. Met alleen Tailscale (B1) werkt dit stuk niet.
  - Google ververst de agenda een paar keer per dag, dus nieuwe afspraken verschijnen niet meteen. In de Huis-app zelf zie je ze wel direct.

## Huisgenoten erbij

Stuur ze het adres uit stap 4 en de pincode. Ze doen zelf stap 5 tot en met 9. Gebruik je Tailscale (B1), dan installeren ze eerst de Tailscale-app.

---

## Stap 10: Meldingen vanuit Home Assistant (optioneel)

Bijvoorbeeld "De was is klaar" of "De voordeur staat al 10 minuten open".

1. Open in Huis **Ik → Meldingen sturen vanuit Home Assistant**. Daar staat een stukje tekst met jouw eigen token erin.
2. Plak het in `configuration.yaml` van Home Assistant. Gebruik als adres het **lokale** adres van de server, bijvoorbeeld `http://192.168.1.20:8080/api/notify`.
3. Herstart Home Assistant.
4. Kies in een automatisering de actie **rest_command.huis_melding**, met `title`, `message` en `to` (`all` of een naam, bijv. `Eva`).

---

## Updaten

```bash
cd huis-app/huis && git pull && docker compose up -d --build
```

## Back-up

Alles staat in één bestand: `huis-app/data/huis.json`. Kopieer dat af en toe naar een veilige plek.

## Problemen oplossen

| Probleem | Oplossing |
|---|---|
| iPhone: geen knop "Zet meldingen aan", maar uitleg over het beginscherm | Open Huis via het **icoon op je beginscherm**, niet via Safari. |
| "Meldingen werken alleen via https" | Je gebruikt het `http://192.168…`-adres. Gebruik het adres uit stap 4. |
| "Meldingen zijn geblokkeerd" | iPhone: **Instellingen → Meldingen → Huis** → Sta meldingen toe. Android: houd het Huis-icoon ingedrukt → **App-info → Meldingen** → aan. |
| Android: geen optie "App installeren" | Gebruik **Chrome** en het https-adres uit stap 4. Herlaad de pagina eens en wacht een paar seconden. |
| Android: meldingen komen laat binnen | Zet batterijbesparing uit voor Chrome: houd het Chrome-icoon ingedrukt → **App-info → Batterij → Onbeperkt**. |
| Meldingen komen niet meer binnen | **Ik → Zet uit**, en daarna weer **Zet meldingen aan**. |
| Ochtendoverzicht komt niet | Het komt alleen als er die dag iets in je agenda of takenlijst staat. |
| Huis-scherm: "Home Assistant reageert niet" | Controleer `HA_URL` en `HA_TOKEN` in `.env` en herstart met `docker compose up -d`. |
| "Kon de agenda niet lezen" | Controleer of de link begint met `webcal://` of `https://`, en bij iCloud of **Openbare agenda** aan staat. |
| App toont oude versie | Sluit de app helemaal (omhoog vegen) en open hem opnieuw. |
