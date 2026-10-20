# Content format

All game content is JSON in this folder. Code reads it; nobody should need to touch code to add a casualty or a scene.

| File | What it holds |
|---|---|
| `vocab.json` | Poses, body regions, overlays (the illustration vocabulary), hazards, bystander behaviours, scene events, look options |
| `actions.json` | Every action the player can pick: time cost, effect, when it is correct, feedback |
| `triage-rules.json` | Categories, scoring, and the sieve steps per age group (placeholder until NZRT confirms) |
| `casualties/*.json` | Casualties, grouped by theme |
| `scenes/*.json` | Scenes: one casualty (Learn mode) or many (Full scene), plus bystanders, hazards and timed events |

Run `node tools/validate.mjs` after any change. It checks every reference, the pose/region/overlay rules below, and runs the rules engine to confirm each casualty's expected category at the start and after every deterioration stage.

## Core idea: truth vs what the player sees

- **`state`** is the casualty's true physiology. The rules engine reads only `state` (plus `ageGroup`) to compute the correct category. Players never see it directly.
- **Vital signs are revealed generically.** `check_breathing`, `check_radial_pulse`, `check_crt`, `give_command`, `check_response` and `ask_to_walk` reveal `state` fields and draw their probe overlays (defined in `actions.json`). Authors do not write findings for vital signs.
- **`findings`** are everything else the player can see or uncover: injuries, entrapment, soot, etc. Each finding maps to exactly one overlay from `vocab.json`, on a region, and fills one triage card field.
- **`appearance`** is how the casualty looks overall on approach (eyes, expression, pallor, speech, motion). It is always visible.

The picture always equals: base pose + `look` + `appearance` + visible findings + findings revealed so far + probes run so far + interventions done so far.

## Files

A casualty file is `{ "prefix": "ci_", "theme": "Circulation and bleeding", "casualties": [ ... ] }`. A scene file is `{ "scenes": [ ... ] }`. One theme per file, so several authors can work in parallel without touching each other's files.

## Casualty

```jsonc
{
  "id": "ci_thigh_bleed_01",              // unique across all files; prefix = your file's prefix
  "title": "Catastrophic thigh bleed",     // internal / editor name
  "ageGroup": "adult",                      // vocab.ageGroups
  "pose": "supine",                         // vocab.poses at the start
  "look": { "skinTone": "medium", "hair": "short", "top": "hi_vis", "bottom": "trousers" },
  "approach": "Man lying on his back beside a collapsed shop front, a dark pool spreading under his left leg.",
  "appearance": [
    { "overlay": "eyes", "params": { "state": "open" } },
    { "overlay": "expression", "params": { "mood": "distress" } },
    { "overlay": "speech", "params": { "text": "My leg! Help!" } }
  ],
  "identity": { "name": "Sione Taufa", "age": 34, "sex": "male", "source": "self" },
  "history": {
    "mechanism": "Hit by falling glass when the shop front collapsed in the earthquake.",
    "allergies": "None known",
    "medications": "None",
    "background": "Asthma as a child",
    "source": "self"
  },
  "state": {
    "canWalk": false,
    "canTalk": true,
    "responsive": "alert",                  // alert | voice | pain | unresponsive (AVPU)
    "painResponseAppropriate": null,        // child only, when responsive = pain: true/false
    "obeysCommands": true,
    "breathing": true,                      // spontaneous breathing on arrival
    "breathesAfterAirwayOpen": null,        // required (true/false) when breathing = false
    "breathesAfterRescueBreaths": null,     // child only, when not breathing after airway and pulse present
    "rr": { "range": [24, 28] },            // rate when breathing (after airway opening if it needed it); 0 if never breathes
    "breathingDepth": "normal",             // normal | shallow | deep | gasping | noisy | none
    "radialPulse": { "present": true, "rate": { "range": [118, 130] } },  // rate null when absent
    "crtSeconds": { "range": [3, 4] },      // whole seconds
    "catastrophicBleed": true,              // must match a bleed finding with severity catastrophic
    "entrapped": false                      // must match an entrapment finding
  },
  "findings": [
    {
      "id": "bleed_thigh_l",
      "label": "Catastrophic bleeding, left thigh",   // text that lands on the triage card
      "cardField": "injuries",
      "overlay": "bleed",
      "region": "left_thigh",
      "params": { "severity": "catastrophic" },
      "visible": true,                                // seen on approach
      "lifeThreat": "catastrophic_bleed"              // the only value; omit otherwise. Airway problems live in state.
    },
    {
      "id": "wound_forearm_r",
      "label": "Deep cut to right forearm, bleeding controlled by sleeve",
      "cardField": "injuries",
      "overlay": "wound",
      "region": "right_forearm",
      "params": { "type": "laceration" },
      "visible": false,
      "revealedBy": "expose_check_bleeding"           // an action whose effect is reveal_findings
    }
  ],
  "deterioration": [
    {
      "id": "d1",
      "atSeconds": 90,                                // scene clock: seconds since the scene started
      "unless": ["apply_tourniquet", "direct_pressure", "instruct_bystander_pressure"],
      "note": "Uncontrolled bleed: loses radial pulse, pale, confused.",
      "state": { "radialPulse": { "present": false, "rate": null }, "crtSeconds": { "range": [4, 5] }, "obeysCommands": false, "responsive": "voice", "canTalk": false },
      "appearance": [{ "overlay": "pallor" }, { "overlay": "eyes", "params": { "state": "half_closed" } }],
      "expectedCategory": "red"
    },
    {
      "id": "d2",
      "atSeconds": 240,
      "unless": ["apply_tourniquet", "direct_pressure", "instruct_bystander_pressure"],
      "note": "Stops breathing.",
      "state": { "breathing": false, "breathesAfterAirwayOpen": false, "rr": 0, "breathingDepth": "none", "responsive": "unresponsive" },
      "expectedCategory": "black"   // dead now, even though the bleed was catastrophic
    }
  ],
  "expected": {
    "category": "red",
    "lifeSavingInterventions": ["apply_tourniquet"],   // any one of these counts
    "keyActions": [],                                  // other actions needed for full marks, e.g. flag_for_medical
    "traps": ["splint_limb", "give_water"],            // traps this casualty is designed to tempt
    "targetSeconds": 45
  },
  "teaching": [
    "Stop catastrophic bleeding before anything else, then tag red.",
    "The tourniquet goes high on the thigh; note the time on the card."
  ],
  "tags": ["bleeding", "earthquake"]
}
```

### Field rules

- `id`s are lowercase snake_case. Casualty ids start with your file's prefix (e.g. `ci_`). Finding ids are unique within the casualty.
- `identity.name` may be `null` (unknown). `identity.source` is `self`, `bystander`, `id_card` or `none`. `history.source` is `self`, `bystander` or `none`. A casualty who can't talk and has no bystander has `source: "none"`.
- Ranges are `{ "range": [min, max] }` with min <= max. Use them for `rr`, `radialPulse.rate` and `crtSeconds`. Plain numbers are also fine.
- **No straddling.** The validator samples every combination of range ends and the midpoint. All samples must give the same category, so a range must not cross a threshold. Near-threshold ranges (RR 28-30 with a >30 threshold) are encouraged: they test whether the player actually counts.
- `expected.category` must equal what the engine computes from `state`. Each deterioration stage's `expectedCategory` must equal the engine's result after applying that stage (and every earlier time stage).
- Mobility aids (wheelchair, walking frame, crutches, stick) are drawn with the `mobility_aid` appearance overlay. `canWalk` describes whether the person can get themselves to the walking-wounded point; a broken wheelchair means `canWalk: false`.
- Pick names that fit Aotearoa New Zealand (Maori, Pakeha, Pasifika, Asian, other), varied ages and sexes, and NZ incidents: earthquake, tsunami, flood, landslide, volcanic ash, bus or train crash, building or stand collapse, gas explosion, crowd crush, fire.
- No gore in any text. Plain, clinical and short.

### State consistency (the validator enforces these)

- `breathing: false` requires `breathesAfterAirwayOpen` true or false.
- Never breathes (`breathing: false`, `breathesAfterAirwayOpen: false`, and for children `breathesAfterRescueBreaths` not true): `rr: 0`, `breathingDepth: "none"`, `responsive: "unresponsive"`, `obeysCommands: false`, `canTalk: false`, `canWalk: false`. Adults also have `radialPulse.present: false`.
- `obeysCommands: true` and `canTalk: true` need `responsive` alert or voice.
- `canWalk: true` needs `obeysCommands: true` (warning only) and `entrapped: false`.
- `radialPulse.present: false` needs `rate: null`.
- `catastrophicBleed: true` exactly when a finding has overlay `bleed` with `severity: catastrophic` and `lifeThreat: "catastrophic_bleed"`.
- `entrapped: true` exactly when a finding uses the `entrapment` overlay.

### Deterioration stages

- Time stage: `atSeconds` on the scene clock, which starts when the scene starts and advances by each action's `timeCostSeconds` plus walking time between casualties. Strictly increasing across time stages. In a big scene, a casualty you reach late may already have deteriorated; that is intended.
- Action stage: `afterAction` (an action id) and `delaySeconds` instead of `atSeconds`. Use this for consequences such as `release_from_entrapment` (crush) or `give_water`. Action stages branch off the state at that point in the list; they don't carry forward to later stages.
- `unless`: action ids. If any of them was done before the stage time, the stage doesn't happen.
- `state`: a partial patch merged into `state`. Objects merge; a range or number replaces.
- `pose`: optional new pose (e.g. `sitting` to `slumped`).
- `appearance`: overlays added. `eyes`, `expression`, `speech` and `motion` replace any earlier value of the same overlay.
- `removeAppearance`: appearance overlay ids that stop showing (e.g. `["speech", "motion"]` when someone falls silent and stops shivering). Don't fake this with speech text such as "...".
- `addFindings`: new findings that become visible, same shape as findings.
- `removeFindings`: finding ids that are no longer there (e.g. the rebar after `remove_impaled_object`).
- `expectedCategory`: required.
- Deterioration only changes what the player sees automatically through `appearance`, `pose` and visible `addFindings`. Vital signs update only when re-checked.

## Illustration consistency rules

These keep the art matching the data. The validator enforces them.

1. `overlay` must exist in `vocab.overlays`, and authored findings may use only kinds `injury` or `entrapment`. `appearance` entries may use only kind `appearance`. `probe` and `intervention` overlays are attached by actions, never authored.
2. `region` must be allowed for that overlay (`vocab.overlays[x].regions`, which is a region list or a `regionGroups` name). `entrapment` takes `regions` (a list) instead of `region`.
3. `params` must use only the listed keys and allowed values. `speech.params.text` is free text, max 40 characters.
4. A finding with `visible: true` must be on a region the pose shows (not in `vocab.poses[pose].hiddenRegions`). Hidden regions need `revealedBy`.
5. Findings on regions covered by an `entrapment` finding can't be `visible: true`. They are hidden under the debris, and `revealedBy` must not be `expose_check_bleeding` either (you can't expose under a slab), so leave them for `release_from_entrapment` or omit them.
6. A `catastrophic_bleed` that should be treated with `apply_tourniquet` must be on a `tourniquet_sites` region. Junctional bleeds (groin, neck) use `pack_wound` or `direct_pressure`.
7. `amputation` must be paired with a `bleed` finding on the same region.
8. `revealedBy` must be an action whose effect is `reveal_findings` (`expose_check_bleeding`; `full_head_to_toe` reveals everything anyway).

## Scenes

```jsonc
{
  "id": "sc_quiet_one",
  "title": "The quiet one",
  "mode": "learn",                       // learn (1-3 casualties) | full_scene (8-10)
  "briefing": {                          // METHANE
    "major": "Major incident declared",
    "exactLocation": "Cashel Mall, Christchurch",
    "type": "Earthquake, shop fronts collapsed",
    "hazards": "Aftershocks, falling glass",
    "access": "From Colombo St, south side",
    "number": "About 6 casualties",
    "emergencyServices": "Fire and ambulance 10 minutes out"
  },
  "startClock": "10:30",
  "targetSeconds": 120,
  "casualties": [ { "ref": "cw_loud_arm_01", "position": [30, 60] }, { "ref": "ne_quiet_head_01", "position": [40, 62] } ],
  "bystanders": [
    { "id": "by_friend", "description": "Woman in a red raincoat", "ageGroup": "adult", "look": { "skinTone": "light", "hair": "long", "top": "jacket", "bottom": "trousers" }, "behaviour": "pulls_to_friend", "canHelp": ["instruct_bystander_pressure"], "position": [50, 40], "lines": ["Please, my friend first!"] }
  ],
  "hazards": [ { "id": "hz_glass", "type": "falling_glass", "position": [20, 20], "activeAtStart": false } ],
  "events": [
    { "id": "ev1", "atSeconds": 60, "type": "hazard_appears", "hazard": "hz_glass", "description": "Glass panels start to crack above you.", "correctResponse": "withdraw", "deadlineSeconds": 15, "penaltyIfWrong": "major" }
  ],
  "teaching": [ "The loudest casualty is rarely the sickest. Go to the quiet one first." ],
  "tags": ["earthquake"]
}
```

- `casualties[].ref` must exist in some `casualties/*.json` file. `position` is `[x, y]` on a 0-100 map.
- `casualties[].override` may replace the casualty's `approach`, `mechanism`, `speech` (text of the speech bubble, max 40 characters) and `teaching` so one casualty can be reused in a different incident. Only text can be overridden; the overridden approach must still describe only what is drawn (pose, look, appearance, visible findings), so don't place a casualty with `wet` appearance in a dry scene or `soot` where there was no fire.
- `bystanders[].behaviour` is from `vocab.bystanderBehaviours`; `canHelp` lists action ids. Bystanders are drawn with the same figure system (pose `standing`, with `look`).
- `hazards[].type` is from `vocab.hazards`; `events[].type` is from `vocab.sceneEvents`; `events[].hazard` refers to a hazard id in the same scene.
- `deadlineSeconds` runs from the moment the player sees the alert (the end of the action in progress), and the player must *start* the response within it. Hazards and aftershocks missed this way cost the danger penalty; other events (bystander demands) cost a small penalty.
- `correctResponse` is an action id (`withdraw`, `drop_cover_hold`, `make_safe`, `move_casualty`, etc.), a list of them in order (aftershock: `["drop_cover_hold", "withdraw"]`), or `ignore`. Each hazard's `defaultResponse` in vocab is an action id too.
- Casualty full names must be unique across the library, because bystanders call casualties by name.

### Safety: being careful is rewarded, never punished

Safety actions (`check_danger`, `don_gloves`, `make_safe`, `withdraw`, `drop_cover_hold`, `evacuate`, `stop_and_listen`, `resume_work`, `radio_methane`, `call_for_help`; marked `"safety": true` in `actions.json`) are never scored as wrong. Doing one that wasn't needed only costs its time. Scenes reward the right ones:

```jsonc
"safety": {
  "dangerCheckEachCasualty": true,      // default true: check_danger at each casualty before hands-on care
  "expected": [
    { "id": "s_cones", "action": "make_safe", "by": "first_casualty", "hazard": "hz_traffic",
      "credit": "Cones out and a lookout posted before anyone worked near the road.",
      "miss": "Nobody slowed the traffic: every casualty was treated next to moving vehicles." },
    { "id": "s_scene", "action": "check_danger", "by": "first_casualty",
      "credit": "Checked the scene for danger before going in.",
      "miss": "You went in without checking the scene for danger." }
  ]
}
```

- `by` is `"first_casualty"` (started before walking to the first casualty), a number of seconds on the scene clock, or `"end"`.
- Missing an expected action costs `scoring.missedSafetyAction`; doing it shows the `credit` text in the debrief.
- A hazard that is there from the start (passing traffic, a downed line) has `"activeAtStart": true`. `make_safe` clears active hazards whose vocab `defaultResponse` is `make_safe`.

**Per-casualty danger.** Going hands-on (any assessment, intervention or trap action except `ask_to_walk`) without `check_danger` at that casualty costs `scoring.skippedDangerCheck`. Walking wounded who came to you after the call-out are exempt. A casualty placement can carry a local hazard:

```jsonc
{ "ref": "bl_thigh_bleed_01", "position": [40, 46],
  "localHazard": { "type": "broken_glass",
    "found": "Glass from the shop window is scattered around him; you sweep a space clear before you kneel.",
    "injury": "You kneel straight onto a shard of window glass and cut your knee.",
    "timeLostSeconds": 30 } }
```

`type` comes from `vocab.localHazards`. Checking first shows `found` and earns a credit; skipping the check shows `injury`, costs the time and `scoring.rescuerInjured`. Give local hazards to some casualties, not all, and make them fit the scene (glass at shop fronts, fuel and sharp metal at vehicles, live wires and unstable debris in collapses, slippery ground in floods).

### Quick-time events and signals

When the player turns quick-time events on, every `aftershock`, `hazard_appears` and `signal` event that has a `correctResponse` pauses play and asks for a response against a real-time limit (`qteSeconds`, default 12 s, minimum 8; a right answer within twice the limit still counts, as slow). The player sees only the `cue`, never the description, and picks from the same six answers every time (drop, cover and hold; leave the zone; evacuate; stop and stay quiet; resume work; keep working).

- `cue`: what the player senses, in the second person, without naming the answer ("The ground lurches and the shelving beside you starts to sway.", "You notice a smell of gas, getting stronger."). The validator warns when a cue gives the answer away.
- `followUpCue`: what they sense after the first response when `correctResponse` is a list (aftershock: drop, cover and hold, then "The shaking stops. The wall above you has a new crack running through it." → leave the zone).
- `qte: false` keeps an event as a normal alert even when quick-time is on.
- `signal` events use a signal from `vocab.signals` (`evacuate`: three short blasts; `cease`: one long blast, stop work and be quiet; `resume`: one long and one short blast). Their response, cue and description come from vocab. These defaults follow the international USAR signals; NZRT should confirm them.
- With quick-time off, the same events are normal alerts with a `deadlineSeconds` (signals default to 20 s).
- When the option is on, `vocab.qtePool` also adds random events (one in Learn scenes, two in Full scenes) matched to the scene's tags and briefing words.

## Condition language

Used by `correctWhen` in actions and by `when` in sieve steps:

```jsonc
true | false
{ "field": "rr", "op": "gt", "value": 30 }      // ops: eq ne lt lte gt gte in exists
{ "all": [ ... ] }  { "any": [ ... ] }  { "not": { ... } }
```

Fields: any `state` field (dotted for nested, e.g. `radialPulse.present`), `ageGroup`, `phase` (`sieve`, `re_triage`, `handover`), `hazardActive`, `bystanderPresent`, `catastrophicBleedSite` (`tourniquet_site`, `junctional`, `other` or null) and `majorBleed` (true/false), both derived from findings, `listedForCasualty` (true when the action being judged is in this casualty's `lifeSavingInterventions` or `keyActions`; used by presentation-specific help such as `give_oral_glucose` and `help_use_inhaler`), and `done.<actionId>`.
