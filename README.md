# Huis

Een gezinsapp voor Home Assistant: gedeelde agenda's, taken, boodschappen en de bediening van je huis, op één plek.

[![Voeg deze repository toe aan je Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fselmokdad-byte%2Fhuis-app)

## Wat het doet

- **Agenda's delen**: iedereen koppelt een eigen iCloud-, Google- of Outlook-agenda. Je ziet elkaars week in één overzicht, ieder in een eigen kleur. Per agenda kies je of anderen alles zien of alleen "bezet".
- **Taken en boodschappen**: gedeelde taken met wie, wanneer en herhalen, en een gezamenlijk boodschappenlijstje dat live bijwerkt.
- **Huis**: lampen, schakelaars, thermostaat, zonwering, sloten, scènes en sensoren uit Home Assistant.
- **Meldingen**: nieuwe taak voor jou, nieuwe afspraak, herinnering vooraf, ochtendoverzicht, en meldingen uit je eigen automatiseringen.
- **Op je telefoon**: in de Home Assistant-app (iPhone en Android), of als losse app op je beginscherm.

## Installeren

**Als Home Assistant-add-on** (Home Assistant OS of Supervised):

1. **Instellingen → Add-ons → Add-on store → ⋮ → Repositories**.
2. Voeg `https://github.com/selmokdad-byte/huis-app` toe.
3. Installeer **Huis**, zet **Toon in zijbalk** aan en start de add-on.

**Zonder add-ons** (Home Assistant Container of Core): draai Huis met Docker op een eigen server.

Het volledige stappenplan, ook voor de telefoons, staat in [huis/INSTALLEREN.md](huis/INSTALLEREN.md). De uitleg in de add-on zelf staat in [huis/DOCS.md](huis/DOCS.md).

## Opbouw

- `repository.yaml`: maakt hiervan een add-on-repository voor Home Assistant
- `huis/`: de add-on en de app (Node.js, zonder build-stap voor de voorkant)
