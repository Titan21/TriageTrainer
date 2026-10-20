# Triage Trainer — Game Plan

A browser game for practising mass casualty incident (MCI) triage before an NZRT exercise. The player approaches casualties, picks actions (correct, plausible-but-wrong and a few silly ones), uncovers findings, does life-saving interventions, and tags each casualty **red, orange, green or black**. Hosted on GitHub Pages and played on a phone.

> **Protocol status:** the triage rules in `content/triage-rules.json` are a placeholder (UK sieve / START for adults, JumpSTART-style for children), not NZRT's. `"approved": false` makes the app show a banner until NZRT's protocol replaces them.

## Where things stand (2026-10-20)

**Playable at https://titan21.github.io/TriageTrainer/**: every Learn and Full scene can be played from briefing to debrief, on a phone or a desktop. The art contact sheet is at `/preview/`.

| Path | What it is |
|---|---|
| `content/FORMAT.md` | The content contract: how casualties, deterioration and scenes are written. Start here. |
| `content/vocab.json` | Illustration vocabulary: poses, body regions, overlays, mobility aids, hazards, bystander behaviours, scene events |
| `content/actions.json` | 52 actions with time cost, effect, when each is correct, and feedback when it isn't |
| `content/triage-rules.json` | Categories, penalty matrix and the sieve steps per age group (placeholder) |
| `content/casualties/*.json` | 64 casualties in 8 themed files |
| `content/scenes/*.json` | 12 Learn scenes and 4 Full scenes |
| `src/engine/rules.js` | Rules engine: computes the correct category from a casualty's true state, and which checks the player needed to justify it |
| `src/art/` | SVG illustration system driven entirely by `vocab.json` |
| `src/game/session.js` | Game engine: scene clock, actions, reveals, deterioration, events, triage card, hints, debrief and scoring |
| `src/ui/`, `src/main.ts`, `src/styles.css` | The app: home, briefing, play (casualty strip, map, picture, actions, card), tag dialog and debrief |
| `tools/validate.mjs` | Content validator (`npm run validate`) |
| `tools/simulate.mjs` | Plays every scene and every casualty with a careful and a careless player (`npm run simulate`) |
| `tools/render-preview.mjs` | Contact sheet of every pose, overlay and casualty (`npm run preview:art` → `preview/index.html`) |

The casualties and scenes were drafted by several parallel agents against the shared contract. The validator checks every file, and every casualty was spot-checked for text vs picture and clinical sense. They still need a review by an NZRT clinician (see [Content review notes](#content-review-notes)).

## Goals
- Build the habit of a fast, ordered triage sieve (roughly 30–60 s per casualty), not a full single-casualty DRSABCD.
- Make it obvious what is visible at a glance versus what you only learn by checking.
- Teach through feedback: every wrong choice gets a short explanation in the debrief.

## Decisions
- **Hosting: GitHub Pages**, deployed by GitHub Actions on every push to `main`. The workflow runs the validator first, so broken content never deploys (see [Hosting and deployment](#hosting-and-deployment)).
- **Stack:** Vite + TypeScript, no framework, no backend. The engine and art are pure ES modules with no DOM or Node APIs, so the app, the validator and the preview share them.
- **Content is JSON imported at build time.** It's bundled and precached for offline play; edits deploy through the same Action.
- **Offline:** PWA via `vite-plugin-pwa`. The first visit caches the whole game (about 390 KB); after that it plays with no connection and can be added to a phone's home screen. New deploys update it automatically. The art contact sheet at `/preview/` is deliberately not cached.
- **The truth is computed, never hard-coded.** The rules engine derives the correct category from a casualty's state at the moment of tagging. Each casualty's expected categories are assertions the validator checks, so a rules change immediately shows which casualties change outcome.
- **Randomised vitals use a seeded RNG,** so a debrief or bug report can replay the exact run.
- **Placeholder banner** while `triage-rules.json` has `"approved": false`.
- **Clock: game time.** Each action costs its `timeCostSeconds` and walking between casualties costs time by distance, all on one scene clock. Deterioration and hazard deadlines run on that clock, so speed matters without real-time pressure. A real-time option for Full scenes is still open.
- **The player sees observations, not the truth.** The picture's vital-sign probes show the values as last checked, so a casualty who deteriorates looks the same until you re-check (visible changes such as pallor or slumping show straight away).
- **Casualties are "Casualty N" until you learn their name.** Internal titles describe the diagnosis and are never shown during play.
- **CI plays the game.** The deploy workflow runs the validator and the simulator before building, so content or engine changes that break play never deploy.
- **Being careful is never punished.** Safety actions (check for danger, gloves, make safe, leave the zone, drop/cover/hold, evacuate, stop and listen) are never scored as wrong; an unneeded one only costs its time. The simulator checks this on every deploy with an extra-cautious player.
- **Progress stays on the device.** Completed scenes and best scores (with and without hints) are kept in the browser's local storage; there is no account or server.

## Core loop (single casualty)
1. **Briefing:** short METHANE summary.
2. **Approach:** the picture shows only the pose, look, appearance and visible findings.
3. **Act:** the core sieve actions are always on screen in a fixed order (walk, breathing, airway, pulse/CRT, command, expose, life-saving interventions), plus 3 rotating extras drawn from traps and silly options that look exactly like the core buttons. Everything else is under "More actions". Fixed positions build the habit; the extras test judgement.
4. Each action costs game time. It reveals state or findings, applies an intervention, or triggers a consequence (an action-triggered deterioration stage).
5. **Tag** at any point. Tagging ends the sieve for that casualty.
6. **Re-triage:** go back to a casualty, re-check and re-tag. Vitals change only when re-checked; visible changes (pallor, slumping) show automatically, with a "looks different" message. Walking wounded who answer the call-out come to you, so they can be tagged green straight away and re-triaged later.
7. **Handover** (later milestone): IMISTAMBO from the card.
8. **Debrief:**
   - correct category at the moment of tagging
   - checks the player skipped (from the engine's `requiredChecks`)
   - missed life-saving and key actions
   - traps taken, with their feedback
   - time against target
   - the full picture with missed findings highlighted

## Data model
Full spec: [content/FORMAT.md](content/FORMAT.md). The key ideas:

- **`state`** is the casualty's true physiology: walking, talking, AVPU, obeys commands, breathing (spontaneous / after airway opening / after rescue breaths), RR, depth, radial pulse, CRT, catastrophic bleed, entrapped. The rules engine reads only `state`.
- **Vital signs are revealed generically** by the assessment actions, which also draw their probe overlays. Authors never write findings for vital signs.
- **`findings`** are what can be seen or uncovered: injuries, entrapment, soot, etc. Each maps to exactly one vocab overlay on an allowed region, is visible on approach or revealed by an action, and fills one triage card field.
- **`appearance`** is how the casualty looks overall: eyes, expression, pallor, speech, motion, guarding, mobility aid.
- **`deterioration`** stages change state, pose, appearance and findings:
  - Time stages (`atSeconds`) can be prevented by named actions (`unless`), so a tourniquet or the recovery position has a visible effect in play.
  - Action stages (`afterAction`) model trap consequences: crush syndrome after release, choking after a drink, bleeding after pulling out an impaled object.
  - Stages can also remove appearance or findings.
- **`expected`** holds the correct category at the start and after each stage, life-saving interventions, key actions (e.g. `flag_for_medical`), traps it tempts, and a target time.
- **Scenes** place casualties on a 0–100 map with bystanders, hazards and timed events. A scene can override a casualty's approach, mechanism, speech and teaching text so one casualty can be reused in another incident.

## Triage rules (placeholder)
`content/triage-rules.json` holds the categories, the penalty matrix and an ordered sieve per age group. Each step has a condition, a category, the actions needed to evaluate it (`checks`) and the actions needed to rule it out (`ruleOutChecks`).

**Adult:**
1. Catastrophic bleeding (in someone still alive) → red, after controlling it
2. Can walk (or get themselves to the collection point) → green
3. Not breathing even after the airway is opened → black
4. Breathing only after the airway is opened → red
5. RR < 10 or > 30 → red
6. No radial pulse or CRT > 2 s → red
7. Can't follow simple commands → red
8. Otherwise → orange

**Child** (JumpSTART-like): catastrophic bleed → red; walking → green; breathes only after airway opening → red; no breathing and no pulse → black; with a pulse, 5 rescue breaths decide red or black; RR < 15 or > 45 → red; no palpable pulse → red; unresponsive or inappropriate pain response → red; otherwise orange.

Fixes from the first draft:
- added the "breathes only after airway opening → red" step
- added the RR lower bound (the old deterioration example went from red to orange)
- added catastrophic bleed as a rule (scenario 3 had no rule making it red)
- the child sieve differs in structure, not just thresholds

Scoring uses a penalty matrix by correct vs assigned category. Under-triage costs more than over-triage, and tagging a salvageable casualty black is the worst outcome.

## Illustration system
The picture always reflects what the player knows, nothing more. Code: `src/art/` (pure ES modules, returns SVG strings). Spec: the `overlays`, `poses` and `regions` in `content/vocab.json`.

- **Skeleton figures:**
  - Each pose (standing, sitting, slumped, supine, prone, recovery) is a set of limb angles in one shared 240×240 viewBox, so every casualty renders at the same scale.
  - Children use the same skeleton with child proportions, so every overlay anchors the same way.
  - Base appearance comes from `look` (skin tone, hair, top, bottom). Clothing colours are picked deterministically from the casualty id from a muted palette that never uses tag colours.
- **Region anchors** (position, angle, length, width) come from the skeleton for all 21 regions. Regions a pose hides (e.g. face and chest when prone) have no anchor.
- **One draw function per overlay** (33 in total): injuries, entrapment, appearance (including mobility aids), probes, interventions and the tag. Casualties never carry their own art, only overlay ids, regions and params, so consistency is by construction.
- **Fixed layer order:** ground (pools, shadows) → body → clothing → injuries → entrapment → appearance → interventions → probes and callouts → tag.
- **Rules that keep the picture honest:**
  - Entrapment hides everything underneath it.
  - Hidden bleeds appear in a cut-away patch of clothing once exposed.
  - Probes fall back to another region when theirs is hidden (breathing on the back when prone).
  - Findings on hidden regions get an "(other side)" callout.
  - Wheelchair users keep their seated pose when they "walk".
  - Deterioration applies pose, appearance and finding changes cumulatively.
- **Accessibility:**
  - Blood is dark maroon with a hatch texture, never the tag red.
  - Burns are never orange.
  - The tag always prints its text label.
- **`checkCoverage(vocab)`** lists any pose, age group, region, overlay or param value without an implementation; the preview fails if there are gaps (currently 0).
- **Contact sheet:** `npm run preview:art` writes `preview/index.html`:
  - every pose with labelled anchors
  - every overlay on every allowed region and param
  - every casualty as Approach, Debrief (everything revealed, vitals, life-saving interventions, tag) and one panel per deterioration stage, next to its approach text and teaching points

  The renderer agent checked it visually in headless Edge. I've only spot-checked the pose sheet so far; a casualty-by-casualty visual pass is still to do.

## Triage card (IMISTAMBO)
The findings panel is the team's triage card in IMISTAMBO order. Confirm field names and layout against the real NZRT card.

- **I – Identification:** name, age, sex, from the casualty, a bystander or ID. "Unknown" is valid; searching pockets is a trap.
- **M – Mechanism:** from the briefing, a bystander or asking.
- **I – Injuries:** visible and exposed findings.
- **S – Signs:** each vital as checked, with time. Re-checks add entries, never overwrite.
- **T – Treatment and trends:** interventions with time ("Tourniquet left thigh 10:42") and changes on re-check ("RR 34 → 38").
- **A, M, B – Allergies, medications, background:** greyed out during the first sweep and active in re-triage and handover. Asking during the sieve is a time trap, and blank greyed fields shouldn't read as mistakes. Confirm this matches team practice.
- **O – Other:** scene notes, e.g. "Trapped — medical needed before release".

Tapping a card field highlights the body region; tapping a callout jumps to its card field. Card completeness is scored per phase: sieve fields during the sieve, everything at handover.

**Handover step (later):** put card items in IMISTAMBO order and pick the right values, with distractors (an outdated vital, another casualty's injury). Scored on order, accuracy and using the latest vitals.

## Actions
`content/actions.json` has 52 actions in six groups. Each has a time cost, one effect from a fixed set implemented in code (`scene`, `reveal_state`, `reveal_findings`, `ask`, `intervene`, `set_pose`, `tag`, `waste`), a `correctWhen` condition and feedback.

- **Scene and self:** check danger, gloves, call walking wounded, withdraw, drop/cover/hold, make safe, METHANE.
- **Assessment:** make your own way to me, response, breathing and rate, radial pulse, CRT, simple command, expose.
- **Life-saving and key interventions:** open airway, recovery position, tourniquet, direct pressure, packing, get a bystander to press, self-pressure, rescue breaths (child), oral glucose and own reliever inhaler (only where the casualty lists them), flag for medical before release.
- **Communication:** name and age, what happened, AMB (a sieve trap), reassure, tag, move on.
- **Traps:** CPR, splint, water, full head-to-toe, detailed history, release from entrapment, stay and comfort, drag to safety, pull out impaled object, collar, cool burn, blanket, search for ID, blood pressure, clean wounds.
- **Silly:** call mum, check phone, selfie, snacks, post on social media.

Walking actions are wheelchair-inclusive: "make your own way to the collection point". A wheelchair user who self-propels keeps their seated pose.

## Content library
**64 casualties** with 66 deterioration stages (13 triggered by traps): 17 green, 19 orange, 24 red and 4 black at the start, 56 adults and 8 children. Learn mode is deliberately red-heavy; the full scenes use realistic mixes.

| File | Theme | Count | Start mix | Highlights |
|---|---|---|---|---|
| `walking.json` (`wk_`) | Walking wounded, behaviour | 8 | 7 G, 1 O | Loud broken arm, panicking uninjured, Deaf man who follows gestures, walker who collapses on re-triage, older person who lost her frame |
| `variety.json` (`vr_`) | Scene fillers | 12 | 7 G, 3 O, 2 B | Wet, dusty and clean greens for each incident type; hidden rib and heart problems on re-triage; drowned and ejected blacks |
| `breathing.json` (`br_`) | Airway and breathing | 8 | 5 R, 2 O, 1 B | Black after one airway attempt (CPR trap), breathes only with the airway open, prone unconscious, RR 8–9 and 31–38, smoke, near-drowning |
| `bleeding.json` (`bl_`) | Bleeding and circulation | 8 | 6 R, 2 O | Thigh and arm tourniquets, groin packing (tourniquet is the trap), blast amputation, bleed hidden under a jacket, pelvic and abdominal bleeding, rebar left in place, dramatic but minor scalp cut |
| `neuro.json` (`ne_`) | Head, burns, environmental, medical | 8 | 4 R, 4 O | The quiet head injury, lucid interval, spinal (collar and drag traps), postictal, low blood sugar (confused), partial burns with airway swelling, hypothermia |
| `entrapment.json` (`en_`) | Entrapment and crush | 8 | 4 R, 4 O | Hours under a slab (flag, don't release), arm under a beam, chest wedged in a bus, landslide, trapped with an arm bleed, bookshelf |
| `children.json` (`ch_`) | Children | 8 | 4 R, 2 O, 1 G, 1 B | Lost walker, toddler who can't walk by age, rescue breaths, no pulse, RR 42–44 vs 50, abnormal pain response, forearm tourniquet, a 14-year-old on the adult sieve |
| `medical.json` (`md_`) | Medical and disability | 4 | 2 G, 1 O, 1 R | Wheelchair user with a wrecked chair, self-propelling wheelchair user, low blood sugar while still walking (sugar early), severe asthma with own reliever (falling RR means exhaustion) |

**Scenes:**
- **Learn (12):**
  - walking wounded self-sort
  - not breathing → black (CPR trap)
  - leg bleed
  - head injury not obeying
  - child sieve
  - long entrapment
  - the quiet one
  - panic
  - bystander pulling you to their friend
  - aftershock mid-scene (drop, cover, hold, then withdraw)
  - junctional bleed with a helper bystander
  - airway opens
- **Full (4), 9–10 casualties each, no casualty repeated between them:**

  | Scene | Mix | Events |
  |---|---|---|
  | Christchurch CBD collapse | 4 G, 3 O, 2 R, 1 B | Aftershock and gas leak |
  | Coach crash on a state highway | 4 G, 2 O, 2 R, 1 B | Smoke hazard |
  | Grandstand collapse | 5 G, 3 O, 2 R | Aftershock, three children |
  | Edgecumbe river flood | 4 G, 2 O, 2 R, 1 B | Rising water, rescue boat |

**Gaps to fill next:**
- More face-down and slumped casualties: only 7 of 64. These are the poses where the chest is hidden or the airway is at risk.
- More blacks in varied settings.
- Infants.
- Crowd crush, chemical exposure and electrical injury.
- A shortened, rotated leg overlay for hip fractures (currently pelvis bruising plus guarding).

## Safety and quick-time events
- **Scene safety.** Each scene lists the safety actions a good responder does, with a credit and a miss text: cones and a lookout on a live road, a danger check before entering a collapse, a METHANE report early in a full scene. Hazards present from the start (passing traffic) are active until made safe.
- **Danger check at every casualty.** Going hands-on without checking for danger first is a process mistake. Some casualties have a local hazard (broken glass, fuel, a live cable, unstable debris, slippery ground): checking finds it ("you sweep a space clear before you kneel"); skipping the check means the rescuer meets it ("you kneel onto a shard of glass"), losing time and points. Walking wounded who came to you are exempt.
- **Quick-time events (optional).** With the option on, aftershocks, sudden hazards (gas, fuel, rising water) and whistle signals pause play and show only what you sense. You pick from the same six responses every time (drop/cover/hold, leave the zone, evacuate, stop and stay quiet, resume work, keep working) within 5 real seconds; aftershocks need a second response once the shaking stops. Extra random events are added from `vocab.qtePool` to match the scene. With the option off, the same events are alerts with a game-time deadline.
- **Whistle signals** default to the international USAR signals: three short blasts = evacuate, one long = stop work and be quiet (listening for survivors), one long and one short = resume work. They are data in `vocab.json`; NZRT should confirm them.

## Scoring
- Category penalty matrix (`triage-rules.json`): under-triage costs more than over-triage; a salvageable casualty tagged black is the maximum.
- Missed life-saving intervention: major penalty. Missed key action (e.g. not flagging an entrapment): smaller penalty.
- Skipped required checks (tagged before checking breathing, tagged black without opening the airway): process penalty and debrief note.
- Entering or staying in danger, missing a hazard deadline, or the wrong quick-time response: major penalty. A right but slow response: small penalty.
- Missed scene safety action, going hands-on without a danger check, meeting a local hazard: penalties, all weighted in `triage-rules.json`. Safety done well is listed as credits in the debrief.
- Time over target reduces score.
- Card completeness per phase, and handover accuracy (order, latest vitals).

## Modes
1. **Learn:** one to three casualties, hints available, the 12 Learn scenes.
2. **Full scene:** 8–10 casualties on a simple map (4 scenes so far), against the clock, with bystanders, hazards, deterioration and re-triage.
3. **Exercise mode (later):** mimic how the real exercise presents injuries (e.g. casualty cards).

## Build order
1. ✅ Content contract, rules engine, validator, casualty library and scenes.
2. ✅ Illustration system and contact sheet. Spot-checked the riskiest casualties; the front-view sitting pose could read more clearly as sitting.
3. ✅ Vite + TS app, GitHub repo, Pages workflow (validate → simulate → build → deploy), placeholder banner, seeded RNG (`?seed=`).
4. ✅ Learn mode: action panel, game clock, reveals, triage card, tagging, hints, debrief with process checks.
5. ✅ Deterioration and interventions in play (time and action stages), re-triage by revisiting and re-tagging.
6. ✅ Scoring and the debrief view: full picture at the moment of tagging, mistakes, missed findings, what changed over time, teaching.
7. ◐ Full-scene mode: playable with a map, walking between casualties, hazards with deadlines and bystander events. Still to do: bystanders you can talk to and direct beyond "hold pressure", and casualties arriving mid-scene.
8. Handover builder.
9. ◐ Mobile polish and offline: ✅ offline (PWA, installable, tested with the server stopped). Mobile polish continues with play-testing.
10. Swap in NZRT's protocol and card. The validator then lists every casualty whose expected category changes, so content and rules are updated together.

## Hosting and deployment
- **GitHub Pages from a GitHub Actions workflow** (Pages source: "GitHub Actions"). On push to `main` the workflow:
  1. runs `npm ci`
  2. runs `npm run validate` and fails on any content error
  3. runs `vite build`
  4. builds the contact sheet into `dist/preview/`
  5. uploads the Pages artifact and deploys it
- **Base path:** Vite `base` set to `/<repo-name>/`, with PWA scope matching. A custom domain later would change it to `/`.
- **Public repo recommended:** Pages on a private repo needs a paid GitHub plan. The content has no personal data (all casualties are fictional).
- **Editing content without code:** edit a JSON file on github.com and commit. The Action validates it, and the error log names the casualty and field if something's wrong.
- **The contact sheet is published** at `<site>/preview/` so an NZRT clinician can review every casualty's picture, text and stages without installing anything.

## Progress tracking
The home screen shows how many Learn and Full scenes you have completed, your best score per scene (and best without hints), plays, and a suggested next scene. The debrief says when you beat your best. Progress can be reset.

## Next steps
- **Clinician review** of the content using the contact sheet and the content review notes below.
- **Handover builder** (build step 8).
- **Play-testing with NZRT members** to tune time costs, target times and scoring weights (all placeholder values in `actions.json` and `triage-rules.json`).
- **Art polish:** sitting pose, a shortened rotated leg for hip fractures, more prone and slumped casualties.

## Open questions
- NZRT triage steps, thresholds and category names/colours. Many tag systems use yellow rather than orange, and white rather than black.
- The child sieve: age cut-off (the library uses the adult sieve from about 12), and how infants who can't walk by age are tagged (placeholder: orange).
- Disability: is a well casualty who can't walk (broken wheelchair, lost frame) orange? Does a self-propelling wheelchair user count as walking wounded (placeholder: yes)?
- Exact fields and layout of the NZRT triage card (a photo of a blank card would help).
- Does catastrophic bleeding stay red after it is controlled (placeholder: yes)?
- Are oral glucose for a known low blood sugar, and helping with someone's own reliever inhaler, acceptable during the sieve (placeholder: yes, when quick)?
- Clock model: game time works well for learning; quick-time events add real-time pressure for hazards. Should Full scenes also get an overall real-time limit?
- Whistle signals: are NZRT's the same as the international USAR ones (3 short = evacuate, 1 long = cease work/quiet, 1 long + 1 short = resume)? INSARAG also uses an air horn for evacuation.
- Is an early METHANE report every responder's job, or only the team leader's? Full scenes currently expect one within 120 s.
- Who gives cease/resume signals before USAR arrives (the long-entrapment scene assumes another crew does)?
- Communication barriers: a Deaf casualty who writes or signs is modelled as `canTalk: false`; should identity and history be obtainable by gesture or writing?
- How will the exercise present injuries: moulage, cards or role-players?
- GitHub repo name and owner (sets the Pages base path).

## Content review notes
Drafted by agents and checked for consistency, but not yet clinically reviewed. Ask an NZRT clinician to look at:

- **Crush syndrome:** release consequences and timing. `en_slab_legs_01` ends red, `en_landslide_buried_01` and `ch_trapped_fast_breather_01` collapse quickly.
- **No radial pulse while alert and talking:** `bl_pelvic_fracture_01`, deliberately teaching that talking isn't the same as well.
- **Hypothermia tagged red through CRT:** CRT is unreliable in the cold (`ne_hypothermia_01`).
- **Smoke and airway burns** are orange at RR 25–30 under the placeholder rules (`br_smoke_inhalation_01`, `ne_burns_explosion_01`); clinically they may warrant red.
- **Tourniquet placement:**
  - below-knee amputation (`bl_blast_amputation_01`); the art places the tourniquet at the body end of the injured segment, but practice is often "high and tight"
  - a child's forearm (`ch_forearm_bleed_01`)
- **Game-paced timings,** not physiological: for example, airway obstruction to arrest in 3–6 minutes.
- **Trap consequences that are teaching devices,** not strict cause and effect: a drink leading to vomiting or choking (`wk_hidden_abdo_01`, `ne_lucid_interval_01`, `br_slow_breathing_01`, `ch_toddler_cant_walk_01`, `vr_stand_nosebleed_01`).
- **Slow pulse in asthma exhaustion** (`md_asthma_severe_01`) and in a drowned child with a pulse (`ch_rescue_breaths_01`).
- **Teaching text quotes thresholds** ("over 30"). If NZRT's numbers differ, update the text, or switch it to placeholders filled from `triage-rules.json`.
- **Medication and history details** are illustrative.
