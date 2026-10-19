# TriageTrainer

A browser game for practising mass casualty incident (MCI) triage, built for NZ Response Team (NZRT) volunteers preparing for exercises. Approach a casualty, run a fast triage sieve, do the life-saving interventions that matter, and tag them **red, orange, green or black**. Then get feedback on every choice.

> ⚠️ **Not a clinical reference.** The triage rules are a placeholder based on common published sieves (UK sieve / START for adults, JumpSTART-style for children), not NZRT's protocol. Don't use this for real practice until NZRT's rules replace them.

## Status

Early development. The content and the systems the game runs on exist; the playable app does not yet.

- 64 casualties and 16 scenes (12 Learn, 4 Full scene) written as JSON
- A rules engine that calculates the correct category from each casualty's true condition
- A validator that checks all content and runs the rules engine against it
- An SVG illustration system that draws every casualty from one shared vocabulary

See [PLAN.md](PLAN.md) for the design, the build order and the open questions.

## How it will play

1. Read a short METHANE briefing.
2. Approach a casualty. The picture shows only what you can see at a glance.
3. Pick actions: check breathing, open the airway, check the radial pulse, apply a tourniquet... Each one costs time and reveals or changes something. Plausible traps (start CPR, splint the arm) and a few silly options are mixed in.
4. Watch the IMISTAMBO triage card fill in as you learn things.
5. Tag the casualty. If you're slow, they may deteriorate.
6. The debrief shows:
   - the correct category
   - checks you skipped
   - interventions you missed
   - traps you fell for, and why they matter in an MCI

Modes: **Learn** (one to three casualties, with hints) and **Full scene** (8–10 casualties on a map, with bystanders, hazards and re-triage).

## Project layout

| Path | What it is |
|---|---|
| `content/FORMAT.md` | How to write casualties and scenes. Start here to add content. |
| `content/vocab.json` | Illustration vocabulary: poses, body regions, overlays, hazards |
| `content/actions.json` | Every action the player can take, with time cost and feedback |
| `content/triage-rules.json` | Triage categories, scoring and sieve steps (placeholder) |
| `content/casualties/` | Casualties, one file per theme |
| `content/scenes/` | Learn and Full-scene scenarios |
| `src/engine/` | Rules engine |
| `src/art/` | SVG illustration system |
| `tools/validate.mjs` | Content validator |
| `tools/render-preview.mjs` | Contact sheet of every pose, overlay and casualty |

## Working on it

You need [Node.js](https://nodejs.org/) 20 or later. There are no dependencies yet.

```bash
npm run validate
```

This checks every content file. It reports anything that breaks the format, for example:
- an injury drawn on a body part the pose hides
- vital signs that cross a triage threshold
- an expected category that doesn't match the rules

```bash
npm run preview:art
```

This writes `preview/index.html`, a contact sheet showing every casualty on approach, at debrief and at each deterioration stage, next to its description. To view it, serve the folder (for example `python -m http.server 8123 --directory preview`) and open http://localhost:8123.

## Adding or editing content

No coding needed. Edit the JSON in `content/`, following [content/FORMAT.md](content/FORMAT.md), and run `npm run validate`. Each casualty records its true condition, what's visible, what's hidden, how it deteriorates and what the correct outcome is. The validator confirms that the picture, the text and the rules all agree.

All casualties are fictional.

## Hosting

The game will be hosted on GitHub Pages and deployed by GitHub Actions. Content is validated before every deploy, and the game will work offline once loaded.

## Contributing

Clinical review from NZRT members is especially welcome. PLAN.md lists the casualties and protocol questions that need a clinician's eye.

## License

[GNU GPL v3](LICENSE)
