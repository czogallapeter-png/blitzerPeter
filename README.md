# Peters Foto App

Karte mit GPS, Warnung vor festen Blitzern (Daten: OpenStreetMap), Sprachansage,
Benachrichtigung und Hintergrund-GPS als Android-App (React + Vite + Capacitor).

## Im Browser testen

```bash
npm install
npm run cameras   # optional: Offline-Daten für Deutschland laden
npm run dev
```

Öffne http://localhost:5173 (GPS geht nur über localhost oder HTTPS).

## APK bauen (empfohlen: GitHub Actions)

1. Projekt in ein GitHub-Repo pushen.
2. Actions → "APK bauen" → Run workflow.
3. Fertige `app-debug.apk` unter "Artifacts" herunterladen und installieren.

## APK lokal bauen (PC mit Android Studio, JDK 21)

```bash
npm install
npm run cameras
npm run build
npm run android:add     # legt android/ an, setzt Berechtigungen und Icons
npx cap sync android
npx cap open android    # Build > Build APK
```

## Hinweise

- Ohne `public/cameras.json` (leere Liste) lädt die App die Blitzer online von OSM.
- OSM enthält nur feste Anlagen, keine mobilen Blitzer.
- Auf Android: Standort "Immer zulassen" erteilen und Akku-Optimierung für die App ausschalten.
- In Deutschland darf der Fahrer während der Fahrt keine Blitzer-Warn-App nutzen (§ 23 Abs. 1c StVO).
- Kartenkacheln brauchen Internet.
