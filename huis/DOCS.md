# Huis

Gezinsplanner voor het hele huis: gedeelde agenda's, taken, boodschappen en de bediening van je huis, in de zijbalk van Home Assistant.

## Eerste keer

1. Start de add-on en zet **Toon in zijbalk** aan.
2. Klik in de zijbalk op **Huis**.
3. Maak je profiel: naam en kleur. Je Home Assistant-gebruiker wordt aan je profiel gekoppeld, dus de volgende keer ben je meteen jezelf.
4. Ga naar **Huis → Bewerk** en kies welke apparaten op het Huis-scherm staan.
5. Ga naar **Ik** en koppel je agenda (iCloud, Google of Outlook). De uitleg staat in de app.

Elke huisgenoot heeft een **eigen Home Assistant-gebruiker** nodig. Maak die aan via **Instellingen → Personen → Gebruikers toevoegen**. Gewone gebruikers zonder beheerrechten kunnen Huis gewoon gebruiken.

## Op je telefoon

Installeer de **Home Assistant-app** (App Store of Play Store) en log in. Huis staat dan in het menu van de app. Dat werkt overal waar je Home Assistant kunt bereiken, dus onderweg ook als je Nabu Casa (Home Assistant Cloud) of een andere manier van externe toegang hebt.

## Meldingen

Ga in Huis naar **Ik → Meldingen** en kies bij **Meldingen via de Home Assistant-app** je telefoon. Je krijgt meteen een testmelding. Daaronder kies je welke meldingen je wilt: nieuwe taak, nieuwe afspraak, herinnering, ochtendoverzicht, boodschappen en meldingen uit je automatiseringen.

### Meldingen sturen vanuit een automatisering

Onder **Ik → Meldingen sturen vanuit Home Assistant** staat een kant-en-klaar `rest_command`, met jouw token erin. Zet het in `configuration.yaml`, herstart Home Assistant en gebruik het in een automatisering:

```yaml
action: rest_command.huis_melding
data:
  title: Wasmachine
  message: De was is klaar!
  to: all   # of een naam, bijv. Eva
```

## Instellingen

| Optie | Wanneer nodig |
|---|---|
| **Pincode** | Alleen als je Huis ook als losse app gebruikt (zie hieronder). Kies minimaal 8 cijfers. |
| **E-mailadres voor meldingen** | Alleen voor webmeldingen in de losse app. |

## Huis als losse app (optioneel)

Je kunt Huis ook los van de Home Assistant-app gebruiken, met een eigen icoon op je beginscherm. Dat is handig voor huisgenoten die geen Home Assistant-account willen.

1. Stel een **pincode** in bij de instellingen van de add-on en herstart.
2. Huis is dan thuis bereikbaar op `http://<adres-van-home-assistant>:8765`.
3. Voor gebruik buitenshuis en voor webmeldingen op de iPhone heb je **https** nodig. Je kunt de **Tailscale**-add-on gebruiken (met `tailscale serve` naar poort 8765) of de **Cloudflared**-add-on met een eigen domein.
4. Zet de app daarna op je beginscherm: Safari → deelknop → **Zet op beginscherm** (iPhone), of Chrome → ⋮ → **App installeren** (Android).

Gebruik je de losse app niet? Dan kun je de poort bij **Netwerk** leeg laten.

## Gegevens en back-up

Alles staat in de map van de add-on en gaat mee in de gewone back-ups van Home Assistant.
