# Bergtagebuch – Mountain Diary

A personal logbook for mountain tours in South Tyrol and beyond. Native Android app built with [B4A](https://www.b4x.com/b4a.html) (B4XPages). Available in German and Italian.

All data stays on your phone. There is no account, no login and no server.

## Features

- **Log tours:** activity, date, region, starting point, ascent and descent, distance, summit altitude, duration, weather, conditions, key passages, description, companions and a 1–5 star rating
- **Activities:** hiking, mountaineering, climbing, via ferrata, ski touring, mountain biking and skiing, plus your own custom activities with name, icon and colour
- **Difficulty grades:** each activity offers the common international scales.

  | Activity | Scales |
  |---|---|
  | Hiking | SAC T1–T6, CAI T/E/EE/EEA |
  | Mountaineering | IFAS F–ABO, SAC L–EX, French, UIAA |
  | Climbing | French, UIAA, YDS |
  | Via ferrata | Schall A–F, Hüsler K1–K6 |
  | Ski touring | SAC L–EX, Blachère MS–OSA, Toponeige 1.1–5.6 |
  | Mountain biking | Singletrail S0–S5 |

  Hiking, mountaineering, via ferrata, ski touring and biking also offer the easy/medium/difficult (blue/red/black) classification shared by the Alpine Clubs DAV, ÖAV and AVS.
- **Photos:** add several at once, set a cover photo and swipe through them full screen
- **GPX import:** open a GPX file exported from Komoot, Strava or Garmin. Distance, ascent and descent, summit altitude, duration, date and position are filled in automatically, and the track is shown on the map.
- **Map:** all tours on one map, built with Leaflet and MarkerCluster.
  - Map types: topo, OpenStreetMap, cycling, satellite, satellite with labels, South Tyrol orthophoto 2023 and South Tyrol base map
  - Colour filters for the map
- **Diary:** a timeline of all tours with search, filters by year and activity, and sorting
- **Statistics:** yearly totals with a comparison to the previous year, ascent per month, records, most frequent companions and regions, and the "Everest factor"
- **Backup:** export everything as a ZIP file and restore it on another phone
- **Diagnostics:** a shareable diagnostic report and a crash log
- **Updates:** the app checks the GitHub releases of this repository and installs new versions
- **Built-in help** in German and Italian

## Installation

1. Download the latest `.apk` from [Releases](../../releases).
2. Open it on your Android phone (Android 8.0 or newer). Allow installation from this source when Android asks.
3. Later updates are found by the app itself: *Mehr → Nach Updates suchen*.

## Building from source

Requirements: B4A 12.8 or newer (tested with 14.20), Android SDK, Java JDK.

1. Clone the repository and open `Bergtagebuch.b4a` in B4A.
2. Enable these libraries: B4XPages, Core, XUI Views, SQL, JSON, JavaObject, Phone, GPS, XmlSax, RuntimePermissions, StringUtils, OkHttpUtils2.
3. Make the three adaptive icon files in `Objects/res` read-only, otherwise B4A deletes them during compilation:
   - `drawable/icon_bg.xml`
   - `drawable/icon_fg.xml`
   - `drawable-anydpi-v26/icon.xml`
4. Compile in Release mode with your own private signing key (*Tools → Private Sign Key*).

The user interface is built entirely in code. There are no Designer layouts.

## Project structure

| Module | Purpose |
|---|---|
| `B4XMainPage` | Bottom navigation (Diary, Map, Statistics, More), page management, start messages |
| `ViewDiary`, `ViewMap`, `ViewStats`, `ViewMore` | The four main tabs |
| `PageEdit` | Tour entry form |
| `PageDetail` | Tour view with photos and map |
| `PageMapPick` | Pick a position on the map |
| `PagePhoto` | Full-screen photo viewer |
| `PageHelp` | Built-in help |
| `PageActivities`, `PageNames` | Manage activities, regions and companions |
| `DB` | SQLite schema, migrations (`PRAGMA user_version`) and queries |
| `Grades` | Difficulty scales and formatting |
| `Gpx` | GPX parser: distance (Haversine), smoothed elevation gain, highest point, duration |
| `PhotoTool` | Photo import: resize, thumbnail, EXIF orientation, GPS and date |
| `Backup` | ZIP backup and restore (inline Java) |
| `Updater` | Update check and install via GitHub Releases |
| `Diag` | Diagnostic log and report |
| `DatePicker` | Custom calendar |
| `Lang`, `UI` | Translations and UI helpers |
| `Files/` | `map.html` with Leaflet, help pages, language files |

## Releasing a new version

See [RELEASE.md](RELEASE.md) (German).

1. Increase `#VersionCode` and `#VersionName`.
2. Build a release APK.
3. Publish a GitHub release tagged `v<version>` (for example `v1.2`) with the APK attached. You can do this in the browser or with `release.ps1`.

The app treats such a release as an update when its version is higher than the installed one. Every APK must be signed with the same key, otherwise Android refuses the update.

## Privacy

- Tours, photos and tracks are stored only on the device.
- The map loads tiles from the selected tile provider. Only the visible map area is requested, never any tour data.
- Location is only read when you tap *Mein Standort*.
- Once a day the app asks the GitHub API for the latest version number. No personal data is sent.

## Map data and credits

- [Leaflet](https://leafletjs.com) and [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster)
- Map tiles: [OpenTopoMap](https://opentopomap.org), [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, [CyclOSM](https://www.cyclosm.org), Esri World Imagery, [CARTO](https://carto.com/attributions)
- South Tyrol orthophoto and base map: Autonomous Province of Bolzano – South Tyrol (geoservices.buergernetz.bz.it)

Check the terms of use of each tile provider before distributing the app widely.
