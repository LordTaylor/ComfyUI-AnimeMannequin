# Finger Control — Design Spec

**Data:** 2026-06-05
**Status:** Zatwierdzony (brainstorming)
**Feature:** Kontrola palców manekina — pełne kości anatomiczne, sterowane presetami; output do OpenPose hand ControlNet.

---

## 1. Cel

Dodać do edytora manekina kontrolę palców dłoni. Po kliknięciu przycisku **Hands** w toolbarze użytkownik wybiera predefiniowaną pozę palców (preset). Pozy palców trafiają do outputu jako:
- osobny obraz `hands.png` (21 keypointów na rękę, format OpenPose hand),
- dorysowane do istniejącego `pose.png` (body + ręce w jednym obrazie).

Zakres podzielony na dwie iteracje. **Ten spec opisuje iterację 1.**

---

## 2. Zakres

### Iteracja 1 (ten spec)
- 30 nowych kości palców (pełna anatomia: 5 palców × 3 falangi × 2 dłonie).
- Geometria palców **zawsze widoczna** na manekinie (część modelu dłoni).
- Przycisk **Hands** → side-panel z **presetami** póz palców.
- Preset ustawia rotacje wszystkich kości palców danej dłoni przez istniejący Command pattern (undo/redo, mirror L/R, serializacja sceny działają automatycznie).
- Output: `hands.png` (osobny) + palce dorysowane w `pose.png` + nowy output w ComfyUI node + przycisk downloadu w trybie standalone.

### Iteracja 2 (poza zakresem teraz)
- Ręczna edycja per-falanga: klikalne jointy kontrolne + gizmo (TransformControls) po kliknięciu Hands.
- Auto-zoom kamery do wybranej dłoni przy wejściu w tryb edycji palców.

---

## 3. Model danych — kości palców

### Nazewnictwo
Konwencja: `{palec}_{strona}_{falanga}`, gdzie falanga ∈ {1,2,3} (proximal → distal).

```
thumb_L_1,  thumb_L_2,  thumb_L_3
index_L_1,  index_L_2,  index_L_3
middle_L_1, middle_L_2, middle_L_3
ring_L_1,   ring_L_2,   ring_L_3
pinky_L_1,  pinky_L_2,  pinky_L_3
(analogicznie *_R dla prawej dłoni → łącznie 30 kości)
```

### Zmiany w `static/src/mannequin-model.js`
- **`BONE_NAMES`** — dopisanie 30 nazw kości palców.
- **`BONE_CHILDREN`** — `hand_L` / `hand_R` zyskują po 5 dzieci (kość bazowa każdego palca: `*_1`); każda falanga jest rodzicem następnej (`*_1 → *_2 → *_3`, `*_3` to liść).
- **`PROPORTIONS`** (F + M) — małe kapsułki dla każdej falangi:
  - długość ≈ 0.020–0.025 (względem wzrostu = 1.0), radius ≈ 0.007,
  - przypisane do grupy proporcji **`arms`** (skalują się razem z ramionami).
- **`defaultScene`** — kości palców dostają identity quaternion (palce wyprostowane) jak pozostałe kości; brak zmian w strukturze funkcji.

### Mapowanie kość → OpenPose hand (21 keypointów / rękę)
Pozycja keypointu = `worldPosition` proksymalnego końca odpowiedniego segmentu kości. Końcówki palców (tip) liczone przez ekstrapolację: proksymalny koniec ostatniej falangi + kierunek segmentu × jego długość.

```
kp[0]  = hand_L (wrist)
kciuk:  kp[1]=thumb_L_1, kp[2]=thumb_L_2, kp[3]=thumb_L_3, kp[4]=tip(ekstrapolacja)
index:  kp[5]=index_L_1, kp[6]=index_L_2, kp[7]=index_L_3, kp[8]=tip
middle: kp[9]=middle_L_1, kp[10]=middle_L_2, kp[11]=middle_L_3, kp[12]=tip
ring:   kp[13]=ring_L_1, kp[14]=ring_L_2, kp[15]=ring_L_3, kp[16]=tip
pinky:  kp[17]=pinky_L_1, kp[18]=pinky_L_2, kp[19]=pinky_L_3, kp[20]=tip
(analogicznie dla prawej dłoni)
```

---

## 4. Interakcja — przycisk Hands + panel presetów

### Toolbar (`static/index.html`)
- Nowy przycisk `#btn-hands` (obok `#btn-overlays`), styl toggle (`.active` jak inne panele).

### Panel (`static/src/panels/hands-panel.js`)
- Nowy panel wzorowany na `static/src/panels/pose-library.js` (ten sam mechanizm mount/show/hide).
- Dołączony do **koordynatora side-paneli** w `main.js` (`SIDE_PANELS` — tylko jeden docked panel otwarty naraz: Poses ⟷ Model ⟷ Hands).
- Zawartość: lista presetów (przyciski). Klik presetu aplikuje pozę palców.

### Aplikacja presetu
- Preset = stała mapa `{ boneName: [x, y, z, w] }` obejmująca kości palców (dla obu dłoni lub per-dłoń — patrz §6).
- Aplikacja przez **istniejący Command pattern** (analogicznie do wczytania pozy z `pose-library`): nowa komenda lub ponowne użycie istniejącej (np. `ResetPoseCommand` z `prevPose`/`nextPose`), tak by:
  - trafiała do historii (undo/redo),
  - aktualizowała store (`pose`),
  - była uwzględniana przy mirror L/R (kości palców dochodzą do `MIRROR_PAIRS`).

### Mirror L/R
- `MannequinEditor.MIRROR_PAIRS` rozszerzone o pary kości palców (`thumb_L_1↔thumb_R_1`, … wszystkie 15 par na falangę).

---

## 5. Output — `pose.png` + `hands.png`

### `static/src/mannequin-renderer.js`
- Nowa funkcja licząca 21 keypointów hand z `worldPosition` kości palców (osobno L i R), wraz z ekstrapolacją tipów.
- **`hands.png`**: czarne tło, rozmiar = output `W×H`. Rysunek standardową paletą OpenPose hand (5 palców w gradiencie kolorów, białe/kolorowe punkty na stawach, linie segmentów). Metoda analogiczna do `_captureOpenPose` (projekcja 3D→2D + canvas 2D).
- **`pose.png`**: istniejące body keypoints **+** dorysowane 21-kp obie dłonie. Rysowane **zawsze** (gdy palce w domyślnej wyprostowanej pozie wychodzą neutralnie — brak flag do pilnowania).
- **`captureImages()`** zwraca dodatkowo `hands`: `{ pose, depth, canny, openpose, hands }`.

### ComfyUI (`nodes.py`, `web/js/mannequin_node.js`)
- Nowy output `hands` (obraz do hand ControlNet) obok istniejących wyjść.
- Bridge (`static/src/comfyui-bridge.js`) przekazuje `hands.png` do node’a przy zapisie.

### Standalone (`static/src/main.js`)
- Nowy przycisk eksportu `#btn-dl-hands` (`⬇ hands.png`) w `#export-bar`, podpięty przez `withFeedback` jak pozostałe pobierania.

---

## 6. Presety póz palców (start)

Sześć presetów w iteracji 1:

| Preset            | Opis |
|-------------------|------|
| Pięść             | wszystkie palce zgięte |
| Otwarta dłoń      | wszystkie palce wyprostowane / rozłożone |
| Wskazywanie       | index wyprostowany, reszta zgięta |
| Peace ✌           | index + middle wyprostowane, reszta zgięta |
| OK 👌             | kciuk + index w kółko, reszta wyprostowana |
| Półzgięte         | naturalny relaks (domyślny stan dłoni) |

Każdy preset to zestaw rotacji (quaternionów) na kościach palców. Domyślny stan manekina (po reset/load) = palce wyprostowane (identity) — preset `Półzgięte` można potraktować jako wizualnie naturalniejszy default, ale **reset pozy nadal zwraca do identity** (spójność z resztą szkieletu).

Presety przechowywane jako stała tabela danych (analogicznie do póz w `pose-library.js`), per-dłoń symetryczne (ta sama mapa dla L i R z odbiciem osi).

---

## 7. Wpływ na istniejące systemy (regresje do sprawdzenia)

- **Random pose** (`RANDOM_LIMITS_SAFE` / `_WILD`): kości palców **nie** dostają wpisów w limitach → przy losowaniu pozostają w bieżącym stanie (nie losują się dziko). Świadoma decyzja — palce kontrolowane tylko presetami.
- **Serializacja sceny** (`getSceneData` / `applyScene` / `jsonToScene`): 30 nowych kości dochodzi automatycznie (iterują po `BONE_NAMES`); stare zapisane sceny bez kości palców → uzupełniane identity quaternionem (już obsłużone w `jsonToScene` i `applyScene`).
- **Proporcje**: kości palców w grupie `arms` skalują się ze suwakiem ramion — sprawdzić, czy nie psuje to pozycji jointów body.
- **Skeleton lines / openpose viewport**: bez zmian (palce mają osobny rendering w `hands.png`, nie wchodzą do `SKELETON_LIMBS` body).

---

## 8. Testy

- **JS unit** (`tests/js/`): mapowanie kość→21 kp (pozycje + ekstrapolacja tipów), aplikacja presetu (poprawne quaterniony na właściwych kościach), mirror L/R par palców, undo/redo presetu.
- **Serializacja**: round-trip sceny z pozą palców; wczytanie starej sceny bez palców (uzupełnienie identity).
- **Render**: smoke-test, że `captureImages()` zwraca `hands` jako poprawny dataURL PNG o wymiarach `W×H`.
- **Python** (`tests/python/`): node zwraca poprawny dodatkowy output `hands` (jeśli dotyczy logiki w `nodes.py`).
- Weryfikacja wizualna w trybie standalone: każdy preset + podgląd `hands.png` i `pose.png`.
