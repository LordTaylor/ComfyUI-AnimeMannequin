# Props / Attachments — Design Spec

**Data:** 2026-06-09
**Status:** Zatwierdzony (brainstorming)
**Feature:** Doczepianie obiektów 3-D (rekwizytów) do kości manekina — czapki, okulary,
naszyjniki, peleryny, miecze, gitary, pistolety — tak, by podążały za pozą i trafiały do
control-images (depth/canny).

---

## 1. Cel

Użytkownik dodaje przedmioty 3-D do manekina: z **wbudowanej biblioteki** lub **wgrane własne
GLB**. Każdy przedmiot doczepia się do kości (domyślnej lub wybranej), ma regulowany
transform (offset/rotacja/skala) i pojawia się w wyjściach **depth** oraz **canny** (do
ControlNet). Nie wpływa na szkielet OpenPose.

## 2. Zakres (v1)

- Ładowanie propsów: biblioteka (`static/assets/props/<file>.glb`) **+** upload własnego GLB.
- Doczepienie do kości (props = dziecko grupy kości → podąża za pozą).
- Domyślna kość per prop biblioteczny; przy uploadzie użytkownik wybiera kość.
- Regulacja transformu: gizmo (`TransformControls`) + suwaki w panelu.
- Output: props renderują się normalnie → automatycznie w **depth** i **canny** (render JS);
  **brak** w OpenPose/pose (tam rysowane są tylko kości).
- Trwałość: props zapisywane w stanie i w **scenie JSON** (save/load + round-trip ComfyUI).
- Undo/redo dla add/remove/transform (Command pattern).
- Biblioteka sterowana manifestem; start z działającym uploadem + 0–2 przykładami.

**Poza zakresem v1 (osobny krok później):**
- Serwerowy re-render propsów w `glb_renderer.py` / `headless_render.js` (analogicznie do
  „Plan 1b" dla palców). W v1 props są w depth/canny tylko przez render JS edytora
  (gotowe PNG-i, które edytor wysyła do node’a).

## 3. Model danych

W `app-store.js` (stan) i w scenie (`mannequin-model.js`): nowa tablica `props`:

```js
props: [
  {
    id:       'p-<unique>',          // identyfikator instancji
    source:   'lib' | 'upload',      // skąd geometria
    ref:      'hat_01' | '<filename>',// id z manifestu (lib) lub nazwa pliku (upload)
    bone:     'head',                // kość docelowa (z BONE_NAMES)
    position: [x, y, z],             // offset lokalny względem kości
    rotation: [x, y, z, w],          // quaternion
    scale:    s,                     // jednolita skala (lub [x,y,z] — patrz §7 decyzja)
  },
]
```

- Upload: geometria nie jest serializowana do JSON (za duża) — przechowywana w sesji;
  scena zapisuje `source:'upload'` + `ref` (nazwa), a po reloadzie bez pliku prop jest
  „brakujący" (placeholder/pominięty). Biblioteczne (`source:'lib'`) odtwarzają się z manifestu.
- `getSceneData`/`applyScene`/`jsonToScene` w `mannequin-model.js` obsługują tablicę `props`
  (brak pola → `[]`, jak przy innych polach).

## 4. Ładowanie i biblioteka

`static/src/props.js`:
- `PROP_LIBRARY` — manifest: `[{ id, name, file, defaultBone, category }]`
  (np. `{ id:'hat_01', name:'Cap', file:'hat_01.glb', defaultBone:'head', category:'head' }`).
- `loadLibraryProp(id)` — ładuje `./assets/props/<file>` (GLTFLoader, cache).
- `parsePropGLB(arrayBuffer)` — upload (wzorzec jak `parseCustomGLB` w geometry-adapter).
- Zwraca `THREE.Object3D` (sklonowana geometria) gotowy do doczepienia.

## 5. Doczepienie i transform (renderer)

W `mannequin-renderer.js`:
- `addProp(propState)` — ładuje geometrię, tworzy `THREE.Group` propsa, ustawia
  position/rotation/scale, dodaje jako **dziecko grupy kości** (`this._bones.get(bone)` lub jej
  grupy segmentu) → prop dziedziczy transform kości i podąża za pozą.
- `removeProp(id)` / `updatePropTransform(id, {position,rotation,scale,bone})`.
- Mapa `this._props: Map<id, THREE.Group>`.
- Props mają `userData.isProp = true` (do filtrowania: nie są kością/jointem; nie wpływają na
  raycast selekcji kości — selekcja propsa osobno).
- Po przebudowie manekina (`buildMannequin`) props są od-budowywane z `store.props`.

## 6. Output

- **depth / canny:** props są zwykłą geometrią w scenie → `captureImages()` ujmuje je
  automatycznie (depth z `MeshDepthMaterial`, canny z renderu). Bez zmian w logice — tylko
  upewnić się, że props NIE są ukrywane razem z jointami/gizmo podczas capture.
- **pose / openpose:** `_captureOpenPose` i `_drawHand` rysują wyłącznie kości/keypointy —
  props ignorowane (nic do zmiany).
- **viewport:** props widoczne zawsze.

## 7. UI

`static/src/panels/props-panel.js` (wzorzec jak `hands-panel.js`/`pose-library.js`):
- Sekcja **Biblioteka** — przyciski z `PROP_LIBRARY` (klik → dodaj prop z `defaultBone`).
- Przycisk **Upload GLB** (input file; po wczytaniu pyta o kość lub bierze domyślną `hand_R`).
- Lista **dodanych propsów** — select (zaznacza + pokazuje gizmo) / usuń.
- Dla zaznaczonego: dropdown **kość** (z `BONE_NAMES`) + kontrolki **transform**
  (offset XYZ, rotacja, skala) — synchronizowane z gizmem.
- Toolbar: **nowy przycisk** — uwaga, `#btn-props` jest już zajęty przez „Model" (proporcje).
  Nowy props-panel dostaje osobne id, np. `#btn-objects`, tekst **„Props"**. Dołącza do
  koordynatora docked-paneli (jeden otwarty naraz: Poses ⟷ Model ⟷ Hands ⟷ Props).
- Transform: reużycie `TransformControls` (gizmo) w trybie translate/rotate/scale; przełącznik
  trybu w panelu. Selekcja propsa przez klik w viewport (raycast po `userData.isProp`).

**Decyzja (skala):** jednolita skala (pojedyncza liczba) w v1 — prostsze UI; nierównomierną
(`[x,y,z]`) dodamy jeśli będzie potrzebna. (YAGNI.)

## 8. Commands / undo

`static/src/commands.js`: `AddPropCommand`, `RemovePropCommand`, `TransformPropCommand` —
mutują `store.props` (jak inne komendy), renderer reaguje. Spójne z istniejącym wzorcem.

## 9. Testy

- **JS unit:** round-trip sceny z `props` (getSceneData/applyScene/jsonToScene); domyślne `[]`
  gdy brak; mapowanie `defaultBone` z manifestu; aplikacja transformu do stanu; add/remove/
  transform przez Command (undo cofa); manifest `PROP_LIBRARY` ma poprawny kształt.
- **Wizualnie (przeglądarka):** prop doczepiony podąża za pozą (obrót kości rusza props);
  prop jest w depth/canny, NIE w openpose; upload działa; gizmo przesuwa/obraca/skaluje.

## 10. Wpływ na istniejące systemy

- Brak zmian w szkielecie/kościach (props to osobna warstwa dzieci kości).
- `captureImages` — sprawdzić, że props nie są chowane przy depth/canny (są chowane tylko
  joints/gizmo/grid).
- Selekcja kości (`_onCanvasClick`) — props nie mogą być łapane jako kości; osobny raycast/flag.
- Koordynator paneli w `main.js` — dochodzi Props.
