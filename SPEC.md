# Anchor Alarm – Specification

Status: **v1 AGREED (round 2)** (round-1 answers in section 8; sections 1-5 and 7 are history) – extracted from `2025_10_18_anchor_alarm.json` (Node-RED, 60 nodes).
Sections 1–5 describe what the existing flow does ("AS-IS"). Section 6 lists new requirements.
Section 7 lists open questions. **You edit this file, I implement it.** Items marked `[?]` need your decision.

## 1. Purpose
Raise an alarm on the boat when the bow/anchor reference point leaves a circle around the dropped anchor position. Works headless on the Pi (OpenPlotter / Signal K); no browser has to be open.

## 2. Signal K interface (AS-IS)

| Direction | Path | Value | Notes |
|---|---|---|---|
| in | `navigation.position2` `[?]` | `{latitude, longitude}` | Source filter `signalk-node-red`. The `2` suffix looks like a test/derived path. |
| in | `navigation.headingTrue2` `[?]` | radians | Subscribed every 3 s, same `2`-suffix question. |
| in/out | `navigation.anchor.drop` | boolean | PUT handler. `true` = drop, `false` = raise. Also published as state. |
| in/out | `navigation.anchor.maxRadius` | metres | PUT handler. Published as state. |
| out | `navigation.anchor.position` | `{latitude, longitude}` | Only published after a manual nudge, not at drop `[?]`. |
| out | `notifications.navigation.anchor` | `{state, method, message}` | See section 4. |

## 3. Position model
1. **Antenna → anchor point correction.** GPS antenna sits 9 m behind the anchor point and 0.5 m to the side (`offset_length = 9`, `offset_width = -0.5`). The antenna position is shifted by this offset rotated by the current heading:
   `dy = L·cos(h) − W·sin(h)`, `dx = L·sin(h) + W·cos(h)`, converted to degrees with R = 6378137 m.
   If no heading has ever been received, **no correction** is applied.
2. **Anchor position** = the corrected position at the moment of "drop".
3. **Distance** = haversine (R = 6371000 m) between corrected position and anchor position, rounded to 0.1 m.
4. **Heading filter.** The stored heading is only updated if it changes by more than `0.9` (Node-RED RBE "narrowband", unit radians ≈ 51°) `[?]`.

## 4. Alarm logic (AS-IS)

**Armed** only while `drop = true`.

**Radius alarm**
- A position sample is "outside" if `distance > maxRadius`.
- Counter `alarm_count` +1 per outside sample. When `alarm_count > 2` (3rd outside sample) → send alarm and reset counter to 0.
- A second counter counts every sample; after 7 samples (`> 6`) both counters reset to 0. Net effect: **3 outside samples within a window of 7 samples** (not necessarily consecutive).
- Alarm message: `{state:"alarm", method:["sound","visual"], message:"Anchor radius exceeded"}` on `notifications.navigation.anchor`.
- Because the counter resets after each alarm, a boat staying outside re-sends the alarm every ~3 samples. That is the "comes back after acknowledge" behaviour.
- **There is no explicit "back to normal" message when the boat re-enters the circle** `[?]` (see Q3).

**Position-lost watchdog**
- If no valid position (lat & lon not null) arrives for **60 s** while armed → `{state:"alarm", method:["sound","visual"], message:"Position lost"}`.
- Not repeated by a timer, and no explicit clear `[?]`.

**Other notifications**
- Drop → `{state:"normal", message:"Anchor is fine"}`
- Raise → `{state:"normal", message:"Anchor is raised"}`

## 5. Operations & UI (AS-IS)

| Control | Behaviour |
|---|---|
| Drop/Raise button | Toggles. Drop stores anchor = current corrected position, `drop=true`. Raise sets `drop=false`. Same via PUT `navigation.anchor.drop`. |
| Radius +/– | ±1 m, rounded to 0.1 m, published to `navigation.anchor.maxRadius`. |
| N/S/E/W | Moves the anchor point by 1 m (111320 m per degree, longitude scaled by cos(lat)); republishes `navigation.anchor.position`, redraws circle. Crashes if no anchor is set. |
| Track it / Delete track | Toggles track recording / clears track layer. Track is drawn when tracking is on **or** anchor is dropped, thinned to ≈1 point per 10 s. |
| Map | Baltic OpenSeaMap tiles (`.mbtiles`), boat icon with heading, red circle with 10 % green fill, anchor icon with radius label. Boat label shows distance (m) or "Anchor raised". Default view 53.96 N / 10.90 E when no position is known. |

**Persistence:** state `{anchor, maxradius, drop}` written to `/home/pi/.signalk/anchor.json` at drop/raise and 30 s after the last change (debounce). On start-up: set `drop=false`, `maxRadius=35`, wait 2 s, read the file; **if it says `drop=true`, the anchor, radius and armed state are restored**.

## 6. New requirements (not in the current flow)
- **R1** The alarm runs inside the Signal K server (plugin), independent of any browser/UI.
- **R2** Alarm logic is a pure module with unit tests and replayable GPS tracks.
- **R3** Heartbeat path (e.g. `navigation.anchor.monitor`) updated every few seconds so KIP/another check can detect a dead monitor.
- **R4** Heading missing/stale while armed must not silently disable the offset correction `[?]` (Q5).
- **R5** After reboot while anchored: restore state automatically (as today) and raise "Position lost" if no position arrives.
- **R6** Alarm clears itself (state `normal`) when boat is back inside the circle `[?]` (Q3).
- **R7** Config (offsets, defaults, counters, timeouts) in plugin settings, not in code.
- **R8** UI is a remote control only; anchor state lives in the plugin.

## 7. Open questions
1. **`navigation.position2` / `headingTrue2`** – real paths or a leftover? What are the real source paths on the boat (`navigation.position`, `navigation.headingTrue`, a specific `$source`)?
2. **Alarm counting** – keep "3 of 7 samples", or use time-based ("outside for more than N seconds")? At what position update rate does your GPS run (1 Hz?)?
3. **Return to normal** – should the notification go back to `normal` when the boat is inside the circle again? (Today it seems it never does until raise/drop.)
4. **Heading filter 0.9** – radians (≈51°, so heading rarely updates) or did you mean ≈0.9°? With 9 m offset a 51° heading error is up to ≈8 m position error.
5. **No heading** – use last known heading with a max age, or alarm "heading lost", or skip correction as today?
6. **Position-lost** – repeat the alarm periodically? 60 s timeout ok?
7. **East/West icons** – "East" shows a left arrow and "West" a right arrow. Intentional (e.g. map orientation) or a bug?
8. **Anchor position on drop** – publish `navigation.anchor.position` at drop (so KIP etc. can show it)?
9. **Vertical/other limits** – do you want extras such as max drift speed, depth, or a second "warning" radius (e.g. 80 % of the radius)?
10. **Antenna offset sign** – confirm: antenna is 9 m *aft* of the anchor point and 0.5 m *to starboard* of it? (Code shifts the antenna position 9 m forward and 0.5 m to port, i.e. the anchor point lies 0.5 m to port of the antenna.)

## 8. Decisions and proposals (round 2)

Legend: **DECIDED** = you said so. **PROPOSAL** = my suggestion, please confirm or change.

### 8.1 Paths - DECIDED
Input: `navigation.position`, `navigation.headingTrue` (no `2`). `$source` is not filtered by default (configurable).

### 8.2 Data rate and computing load - PROPOSAL
- Position: subscribe with `minPeriod = 1000 ms`, i.e. at most 1 evaluation per second. Per evaluation: one haversine, one array write, no disk I/O. This is negligible for a Pi.
- Heading: subscribe with `minPeriod = 2000 ms`; keep only the **latest value + timestamp**. No smoothing and no change filter. Reason: 1 deg heading error moves the anchor point by only 9 m x 0.017 = 0.16 m, far below GPS noise, and at anchor the heading changes slowly.
- Old rules dropped: RBE heading filter, 10 s track thinning logic in the alarm path (track belongs to the UI only).

### 8.3 Glitch-proof alarm rule - PROPOSAL
Rolling window of the **last 5 samples (= 5 s at 1 Hz)**:
- **Alarm** when **at least 3 of the last 5** samples are outside the radius. A single glitch (or even two) never triggers it, a real exit does after about 3 s.
- **Clear (back to normal)** when **at least 4 of the last 5** samples are inside `radius - hysteresis` (hysteresis 2 m, avoids flapping at the circle edge).
- Samples with no/invalid position are not counted; they feed the watchdog instead.
- **Re-alarm:** while the state is still "outside", the plugin re-sends the `alarm` notification every **30 s**, so an acknowledgement in KIP is not final until the boat is back inside (replaces your old counter trick).
- Optional later: a pre-warning (`warn`) at 80 % of the radius. Not in scope unless you say so.
All numbers (5 / 3 / 4 / 2 m / 30 s) are plugin settings.

### 8.4 Return to normal - DECIDED
When the clear condition above is met the notification goes back to `normal` ("Back inside anchor circle"). The KIP acknowledgement stays possible while in alarm.

### 8.5 Position-lost watchdog - DECIDED (60 s)
- No valid position for 60 s while armed -> `alarm` "Position lost".
- Repeated every 30 s like the radius alarm; **clears itself** when a valid position arrives again (then the radius rule takes over; the sample window starts empty).
- Same logic after a reboot: if the Pi starts anchored and has no position within 60 s -> alarm.

### 8.6 Persistence - DECIDED
- State file (`anchor`, `maxRadius`, `armed`, drop time) in the plugin data dir `~/.signalk/plugin-config-data/`, written **atomically** (temp file + rename) shortly after every change (2 s debounce, not every 30 s as before).
- On start: restore and arm immediately. The state is also published to Signal K. No hard-coded 35 m reset at start; 35 m is only the default for a first drop.

### 8.7 Drop requires fresh data - DECIDED / PROPOSAL
- **Drop is refused** with the error message **"No heading information"** if there is no `headingTrue` younger than **10 s**. Same for position: **"No position information"** (position must be younger than 10 s). Refusal comes back as a failed PUT (visible in the UI and to KIP) and no anchor is stored.
- Raise is always allowed.
- **Heading lost while armed - DECIDED:** no alarm and no warning. The last known heading (the one valid at drop, or newer) keeps being used for the offset correction. Heading is only a requirement at the moment of drop. A "heading age" value may be shown in the UI, nothing more.
  Known trade-off: if the boat swings a lot while no heading arrives, the corrected position can be off by up to 9 m. The radius alarm itself stays on the position only.

### 8.7a Alarms only while armed - DECIDED
**Every alarm (radius, position lost) exists only while the anchor is dropped.** Anchor raised = no monitoring, no alarm, notification state `normal` ("Anchor is raised"). Raising the anchor immediately clears any active alarm. The same applies to errors at drop: they are only reported to the person dropping (refused PUT / UI message), never as a Signal K alarm.

### 8.7b Plugin configuration - DECIDED
All parameters are Signal K plugin settings (Admin UI -> Server -> Plugin Config), with these defaults:
- antenna offset: **length 9 m** (forward from antenna to anchor point), **width -0.5 m** (negative = anchor point to port of antenna) - editable, any boat can set its own
- default radius 35 m, radius step 1 m, nudge step 1 m
- sample window 5 / alarm at 3 / clear at 4 / hysteresis 2 m / re-alarm 30 s
- position-lost timeout 60 s, max data age at drop 10 s
- input paths (default `navigation.position`, `navigation.headingTrue`) and optional `$source` filter

### 8.8 Still open
- Resolved by default: East/West arrows follow the compass direction; `navigation.anchor.position` is published at drop; offsets as in the old flow but configurable (8.7b).
- **Backlog (later improvements, not in v1):** pre-warning (`warn`) at e.g. 80 % of the radius; drift-speed alarm; other extras you think of.

### 8.9 Signal K GNSS antenna correction (tested 2026-10-26 on Signal K 2.34.0)
Test with simulated data (antenna 9 m aft, 0.5 m starboard of the bow point; Signal K vessel length 10 m, "In place correction"):
- Signal K corrects `navigation.position` to the **vessel reference point (CCRP) = midship (length / 2)**, not to the bow/anchor roller. Measured distance from the true bow point: 5.00 m, constant, rotating with the heading.
- It rotates the offset with `navigation.headingTrue` correctly. If heading is lost it keeps using the **last** heading (same behaviour as this plugin).
- So the plugin still has to shift from the reference point to the anchor point (heading-dependent).
- **Decision (v1): keep the plugin's own offset** (default 9 / -0.5, antenna -> anchor point), Signal K correction stays on "No correction", because the alarm then does not depend on a second configuration (vessel length, sensor labels) that could silently change.
- **If Signal K correction is switched on later**, the plugin settings must be changed to: length = half the vessel length (CCRP -> bow), width = 0. Otherwise the offset is applied twice.

### 8.10 OPEN: detect Signal K "In place correction" automatically
Dilemma: if a user enables Signal K "In place correction", `navigation.position` is already moved to the vessel reference point and our own offset would be applied twice. Wanted: the plugin detects whether the correction is active and reacts (no double correction, or a clear warning).
To investigate: whether the setting is readable with a normal token (admin API / settings endpoint / meta of `navigation.position`), and how "Correction as copy" shows up (`<label>.ccrp` source). Fallback if it cannot be detected: a plugin setting "position is already corrected by Signal K" plus a visible warning in the UI.
