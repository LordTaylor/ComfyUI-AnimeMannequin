# Finger Control — Design Spec

**Data:** 2026-06-05
**Status:** Zatwierdzony (brainstorming)
**Feature:** Kontrola palców manekina — sterowanie presetami; output do OpenPose hand ControlNet.

---

## 0. Historia decyzji (ważne — odbiega od pierwotnego pomysłu)

Pierwotnie zakładano pełną anatomię: 30 kości (5 palców × 3 falangi × 2 dłonie), każda
indywidualnie sterowalna. **Inspekcja assetów GLB to wykluczyła:** palce w `male.glb`
i `female.glb` to **pojedyncze sztywne meshe** (1 mesh na palec, 10 łącznie, bez kości
falang, bez rigu). Potwierdzone w `static/src/geometry-adapter-gltf.js` i `glb_renderer.py`
(palce w `EXTRA_NODES`, komentarz: *"Fingers/toes are rigid … not individually posable"*)
oraz przez grep stringów w GLB (dokładnie 15 nazw palców, bez `_1/_2/_3`).

**Decyzja:** **1 kość na palec** (10 kości). Każdy palec zgina się jako całość od kostki
(knuckle). Zachowuje stylizowany wygląd meshy GLB, działa z obecną geometrią, zero przeróbki
assetów. OpenPose 21-kp jest przybliżane (realne: knuckle + tip; pośrednie stawy interpolowane).

**Podział na plany:** output przechodzi przez 3 renderery (`mannequin-renderer.js`,
`headless_render.js`, `glb_renderer.py`) + node. Iterację 1 dzielimy:
- **Plan 1a (ten spec, priorytet):** kontrola palców w edytorze + output w JS rendererze
  (przeglądarka) + pobieranie w trybie standalone.
- **Plan 1b (osobno, później):** propagacja na serwer — `headless_render.js`,
  `glb_renderer.py`, 5. output (`hands`) w `nodes.py`.
- **Iteracja 2 (poza zakresem):** ręczna edycja per-palec (klikalne jointy + gizmo),
  auto-zoom kamery do dłoni.

---

## 1. Cel (Plan 1a)

Po kliknięciu przycisku **Hands** w toolbarze użytkownik otwiera panel z predefiniowanymi
pozami palców (presety). Preset ustawia rotacje 10 kości palców przez Command pattern.
W trybie standalone użytkownik widzi efekt na manekinie i może pobrać `hands.png` oraz
`pose.png` (z dorysowanymi palcami).

---

## 2. Zakres Planu 1a

- 10 nowych kości palców (1 na palec: `thumb/index/middle/ring/pinky` × `L/R`).
- Geometria palców (meshe GLB) **zawsze widoczna**, teraz przypięta do własnych kości
  (przeniesiona z rigid `EXTRA_NODES` do prawdziwych kości z pivotem w knuckle).
- Przycisk **Hands** → docked side-panel z presetami (koordynator: Poses ⟷ Model ⟷ Hands).
- Preset aplikowany przez Command pattern → undo/redo, mirror L/R, serializacja gratis.
- Output w JS rendererze: osobny `hands.png` (21 kp/rękę) + palce dorysowane w `pose.png`;
  `captureImages()` zwraca dodatkowo `hands`.
- Standalone: przycisk `⬇ hands.png`.

**Poza Planem 1a:** headless_render.js, glb_renderer.py, nowy output w nodes.py (→ Plan 1b);
ręczna edycja per-palec, auto-zoom (→ iteracja 2).

---

## 3. Model danych — kości palców

### Nazewnictwo
Konwencja: `{palec}_{strona}`, palec ∈ {thumb, index, middle, ring, pinky}, strona ∈ {L, R}.

```
thumb_L, index_L, middle_L, ring_L, pinky_L
thumb_R, index_R, middle_R, ring_R, pinky_R   (→ 10 kości)
```

### Zmiany w `static/src/mannequin-model.js`
- **`BONE_NAMES`** — dopisanie 10 nazw (łączna liczba: 20 → 30).
- **`BONE_CHILDREN`** — `hand_L` zyskuje dzieci `[thumb_L, index_L, middle_L, ring_L, pinky_L]`,
  `hand_R` analogicznie; każda kość palca jest liściem (`[]`).
- **`PROPORTIONS`** (F + M) — wpis dla każdej kości palca z `radius` (np. 0.012) używanym do
  ewentualnych jointów; długość nie jest potrzebna (geometria z GLB). Grupa proporcji: `arms`.
- **`defaultScene`** — kości palców dostają identity quaternion (jak pozostałe; iteracja po
  `BONE_NAMES` obejmie je automatycznie, bez zmian strukturalnych).

### Geometria — przeniesienie palców z `EXTRA_NODES` do kości
W `static/src/geometry-adapter-gltf.js`:
- Usunąć wpisy `hand_L`/`hand_R` z `EXTRA_NODES` (palce przestają być rigid sub-meshami).
- Dodać kości palców do `MESH_MAP` (F + M), mapując każdą kość na jej GLB node
  (`GEO-thumb_*`, `GEO-finger_index_*`, `_middle_*`, `_ring_*`, `_pinky_*`).
- `computeBoneOffsets` wyznaczy pivot kości palca z world position GLB node palca (knuckle).
- `buildSegments` zbuduje segment palca jak każdy inny segment kości (worldQ/worldS),
  więc rotacja kości obraca mesh palca wokół knuckle.
- `SEGMENT_PROPORTION_GROUP` — dopisać 10 kości palców z grupą `arms`.

### Mapowanie kość → OpenPose hand (21 keypointów / rękę)
21-kp layout OpenPose: wrist + 4 kp na palec (MCP, PIP, DIP, tip) × 5 palców.
Z 1 kością/palec mamy realnie **2 punkty na palec**: knuckle (= base kości palca = MCP)
oraz tip (ekstrapolacja: base + kierunek osi palca × długość segmentu). Pozostałe dwa
(PIP, DIP) **interpolowane** liniowo wzdłuż odcinka knuckle→tip (1/3 i 2/3).

```
kp[0] = hand_L (wrist)
kciuk:  kp[1..4] = base(thumb_L), lerp 1/3, lerp 2/3, tip(thumb_L)
index:  kp[5..8] = base(index_L), lerp 1/3, lerp 2/3, tip(index_L)
middle: kp[9..12]
ring:   kp[13..16]
pinky:  kp[17..20]
(analogicznie prawa dłoń)
```

Długość palca do ekstrapolacji tipu: rozmiar bounding-boxa segmentu palca wzdłuż jego
osi (liczony raz przy budowie, zapisany w `userData`), lub stała frakcja proporcji `arms`.

---

## 4. Interakcja — przycisk Hands + panel presetów

### Toolbar (`static/index.html`)
- Nowy przycisk `#btn-hands` (obok `#btn-overlays`), styl toggle (`.active`).

### Panel (`static/src/panels/hands-panel.js`)
- Wzorowany na `static/src/panels/pose-library.js` (mount/show/hide/isVisible, ten sam
  styl docked panelu po prawej).
- Dołączony do koordynatora `SIDE_PANELS` w `main.js` (jeden docked panel naraz).
- Zawartość: lista 6 przycisków-presetów. Klik = aplikacja pozy palców.

### Aplikacja presetu
- Preset = stała mapa `{ boneName: [x, y, z, w] }` obejmująca 10 kości palców.
- Aplikacja przez nową metodę edytora `applyFingerPreset(presetMap)`, która:
  - czyta `prevPose` ze store,
  - buduje `nextPose` = `prevPose` z nadpisanymi kośćmi palców,
  - wykonuje przez istniejący `ResetPoseCommand(prevPose, nextPose)` (trafia do historii,
    aktualizuje store; renderer reaguje przez subskrypcję / `applyScene`),
  - kości nie-palcowe pozostają nietknięte.

### Mirror L/R
- `MannequinEditor.MIRROR_PAIRS` rozszerzone o 5 par palców
  (`thumb_L↔thumb_R`, `index_L↔index_R`, `middle_*`, `ring_*`, `pinky_*`).

---

## 5. Output — `pose.png` + `hands.png` (JS renderer)

W `static/src/mannequin-renderer.js`:
- Nowa metoda `_computeHandKeypoints(side)` → 21 punktów ekranowych (projekcja 3D→2D),
  z interpolacją PIP/DIP i ekstrapolacją tipów (§3).
- Nowa metoda `_captureHands(W, H)` → `hands.png`: czarne tło, rozmiar `W×H`,
  standardowa paleta OpenPose hand (5 palców w odrębnych kolorach, linie segmentów,
  punkty na stawach). Sposób rysowania jak `_captureOpenPose` (canvas 2D).
- `_captureOpenPose` rozszerzone: po narysowaniu ciała dorysować 21-kp obie dłonie
  (palce rysowane **zawsze** — w domyślnej pozie wychodzą neutralnie).
- `captureImages()` zwraca dodatkowo `hands`:
  `{ pose, depth, canny, openpose, hands }`.

### Standalone (`static/src/main.js` + `static/index.html`)
- Nowy przycisk eksportu `#btn-dl-hands` (`⬇ hands.png`) w `#export-bar`, podpięty przez
  `withFeedback` jak pozostałe pobierania.

---

## 6. Presety póz palców (start)

Sześć presetów. Każdy = mapa rotacji (quaternionów) na 10 kościach palców.

| Preset       | Opis (zgięcie całego palca od knuckle) |
|--------------|----------------------------------------|
| Pięść        | wszystkie palce mocno zgięte |
| Otwarta dłoń | wszystkie palce wyprostowane |
| Wskazywanie  | index wyprostowany, reszta zgięta |
| Peace ✌      | index + middle wyprostowane, reszta zgięta |
| OK 👌        | kciuk + index lekko zgięte ku sobie, reszta wyprostowana |
| Półzgięte    | naturalny relaks (lekkie zgięcie wszystkich) |

Presety symetryczne L/R (ta sama mapa z odbiciem osi dla strony przeciwnej).
**Reset pozy** nadal zwraca palce do identity (wyprostowane) — spójność z resztą szkieletu.

---

## 7. Wpływ na istniejące systemy (regresje)

- **Test `BONE_NAMES contains exactly 20 bones`** (`tests/js/mannequin-model.test.js`) →
  zaktualizować do 30 + dodać asercje na kości palców.
- **Random pose** (`RANDOM_LIMITS_SAFE`/`_WILD`): kości palców **bez** wpisów → przy
  losowaniu pozostają w bieżącym stanie (świadoma decyzja).
- **Serializacja** (`getSceneData`/`applyScene`/`jsonToScene`): 10 nowych kości dochodzi
  automatycznie; stare sceny bez palców → identity (już obsłużone).
- **Proporcje `arms`**: segmenty palców skalują się ze suwakiem ramion — zweryfikować,
  że pivoty palców nie odjeżdżają od dłoni.
- **EXTRA_NODES**: usunięcie palców z rigid extras zmienia tylko ścieżkę JS (Plan 1a);
  **`glb_renderer.py` i `headless_render.js` pozostają na razie z palcami jako rigid** —
  zsynchronizowane w Planie 1b. Do tego czasu output serwerowy ComfyUI pokazuje palce
  w pozie domyślnej (bez presetów) — akceptowalne dla 1a (standalone działa w pełni).
- **Skeleton lines / openpose viewport body**: bez zmian (palce mają osobny rendering,
  nie wchodzą do `SKELETON_LIMBS`).

---

## 8. Testy (Plan 1a)

- **JS unit** (`tests/js/`, vitest — `npm test`):
  - `mannequin-model`: `BONE_NAMES` ma 30 kości i zawiera 10 palców; `BONE_CHILDREN.hand_L/R`
    zawiera 5 palców; każdy palec to liść; `PROPORTIONS` F/M mają wpisy palców (grupa arms).
  - `hands-panel` / preset: `applyFingerPreset` ustawia poprawne quaterniony na właściwych
    kościach, nie rusza kości ciała; trafia do historii (undo cofa).
  - mirror: pary palców odbijane poprawnie.
  - hand keypoints: `_computeHandKeypoints` zwraca 21 punktów; tip = ekstrapolacja,
    PIP/DIP na odcinku knuckle→tip.
  - serializacja: round-trip sceny z pozą palców; wczytanie starej sceny bez palców → identity.
- **Smoke**: `captureImages()` zwraca `hands` jako poprawny dataURL PNG `W×H`.
- **Weryfikacja wizualna** (standalone): każdy preset + podgląd `hands.png` i `pose.png`.
