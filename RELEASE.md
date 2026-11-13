# Neue Version veröffentlichen

Die App prüft bei jedem Start und unter *Mehr → Nach Updates suchen* die **neueste Release** dieses Repositorys.
Eine Release wird als Update erkannt, wenn

1. ihr Tag `v<Version>` lautet, z. B. `v1.2`,
2. die Version größer ist als die installierte (`#VersionName` im Hauptmodul), und
3. eine `.apk`-Datei angehängt ist.

## Einmalig: eigener Signaturschlüssel

Updates lassen sich nur installieren, wenn jede APK mit **demselben Schlüssel** signiert ist.
In B4A unter *Tools → Private Sign Key* einen eigenen Schlüssel anlegen und gut sichern (z. B. im Passwort-Tresor).
Ohne eigenen Schlüssel signiert B4A mit dem Debug-Schlüssel des jeweiligen PCs – dann funktionieren Updates nicht, sobald von einem anderen Rechner gebaut wird.

## Ablauf je Version

1. Im Hauptmodul (`Bergtagebuch.b4a`, Region *Project Attributes*) erhöhen:
   - `#VersionCode` um 1 (z. B. 2 → 3)
   - `#VersionName` (z. B. 1.1 → 1.2)
2. In B4A auf **Release** stellen und kompilieren. Die APK liegt danach in `Objects\`.
3. Veröffentlichen – eine der beiden Varianten:
   - **Mit Skript** (benötigt Git und die GitHub-CLI `gh`, einmalig `gh auth login`):
     ```powershell
     .\release.ps1 -Notes "Was ist neu: …"
     ```
     Das Skript committet und pusht den Quellcode, legt die Release `v<Version>` an und hängt die APK an.
   - **Im Browser:** GitHub → *Releases* → *Draft a new release* → Tag `v1.2` → Titel und Beschreibung → APK-Datei hineinziehen → *Publish release*.

Der Beschreibungstext der Release erscheint in der App im Update-Hinweis.

## Web-App (iPhone) aktualisieren

Die Web-App liegt im Ordner `docs/` und wird über GitHub Pages ausgeliefert (*Settings → Pages → Deploy from a branch → `main` / `/docs`*).

1. Geänderte Dateien in `docs/` hochladen.
2. In `docs/sw.js` die Zeile `const VERSION = 'bt-1.8.0';` hochzählen (z. B. `bt-1.8.1`). Ohne neue Nummer laden installierte iPhones die neuen Dateien nicht.
3. Optional `APP_VERSION` in `docs/js/core.js` anpassen (wird unter *Mehr → Über die App* angezeigt).

Beim nächsten Start fragt die Web-App „Neu laden?“ und übernimmt die neue Version. Die Daten bleiben erhalten.
