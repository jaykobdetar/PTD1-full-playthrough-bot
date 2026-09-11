# Deterministic playthrough videos

The video tools replay an existing bot report through the native game engine and render it with the game's original Phaser scene, Pokémon artwork, story timelines and move effects. They produce silent 960 × 640 video: an 800 × 480 game frame, a progress header, and party/HP information below it.

The original playthrough reports, checkpoints and action logs remain the evidence of completion. A video is a presentation of that evidence, not a replacement for the [bot report](BOT.md) or [verified run](BOT_VERIFICATION.md).

The earlier `final-seed-1` report and assisted smoke videos use ten level-90 Pokécenter adoptions. Their full render was stopped when starter-and-captures progression was requested. They are assisted test artifacts, not the requested final videos. Record a newly verified starter-and-captures report for that deliverable. The separate `patched-smoke` videos cover only the first four legitimate levels at all three speeds; they validate the pipeline, not whole-game completion.

## Requirements and commands

Use Node.js, Google Chrome, FFmpeg and FFprobe. Chrome must support H.264 encoding through WebCodecs. The recording tools have their own small dependency installation; they do not alter the frozen gameplay dependency lockfile.

```sh
npm ci
npm ci --prefix tools/video
```

First export replay descriptors from the original fresh primary report. Use a new or empty descriptor directory. This runs the complete deterministic bot again and checks that its result hash matches the supplied report.

```sh
node --loader ./tools/video/observe-loader.mjs \
  tools/video/export-descriptors.mjs \
  artifacts/bot/strict-final/report.json \
  artifacts/video/strict-descriptors
```

Then verify every independent battle/story replay, including its final save hash and exact frame counts:

```sh
node --loader ./tools/video/observe-loader.mjs \
  tools/video/preflight.mjs \
  artifacts/video/strict-descriptors/descriptors.json
```

Record the complete timeline:

```sh
npm run bot:video -- \
  --report artifacts/bot/strict-final/report.json \
  --out artifacts/video/strict-playthrough \
  --speeds 1,20,60 \
  --workers 3
```

The default descriptor manifest is `artifacts/video/strict-descriptors/descriptors.json`. The report and descriptor manifest must describe the same original run. Resumed reports and individual auxiliary reports cannot be exported as if they were independent fresh playthroughs.

Use a separate directory for a two-visit recording smoke check:

```sh
npm run bot:video -- --out artifacts/video/smoke --limit 2
```

`--visits` selects comma-separated descriptor keys for targeted samples, such as `primary:00001`. Both selection options mark the export as partial. A limited recording does not establish whole-run video coverage.

| Option | Meaning |
| --- | --- |
| `--report PATH` | Original primary bot report. Defaults to `artifacts/bot/strict-final/report.json`. |
| `--descriptors PATH` | Verified descriptor manifest. Defaults to `artifacts/video/strict-descriptors/descriptors.json`. |
| `--out PATH` | Recording directory. Defaults to `artifacts/video/strict-playthrough`. |
| `--speeds 1,20,60` | Distinct positive integer source-frame sampling intervals. |
| `--workers 3` | Concurrent browser workers, from 1 to 8. |
| `--resume` | Reuse verified completed segments in the existing output directory. |
| `--limit 2` | Keep the first two visits and preceding activity summaries. |
| `--visits KEY,KEY` | Keep selected timeline/descriptor keys; overrides `--limit`. |
| `--chrome PATH` | Chrome executable. Defaults to `PTD_BROWSER_EXECUTABLE`, or `/usr/bin/google-chrome`. |
| `--ffmpeg PATH`, `--ffprobe PATH` | Media executables; defaults use the commands on `PATH`. |
| `--bitrate 1800000` | H.264 target bitrate in bits/second; minimum 100,000. |

Resume with the same report, speeds, bitrate and selection. The recorder checks the gameplay fingerprint, video code fingerprint, timing and completed segment hashes before continuing. It rejects an existing recording unless `--resume` is supplied. Changing renderer code requires a new recording directory. Use `npm run bot:video -- --help` to display the command syntax.

## Output files

The complete defaults create `playthrough-1x.mp4`, `playthrough-20x.mp4` and `playthrough-60x.mp4`. Partial exports append `-sample` to each filename. Each MP4 has embedded chapters and a companion `-chapters.json`, `-probe.json` and `.ffmetadata` file. FFprobe verification checks the encoded frame count, resolution, duration and chapter count before the MP4 is accepted.

`recording.json` contains settings, segment hashes, native replay comparisons, output hashes and completion status. `progress.json` reports current work, and `timeline.json` maps ordered segments to their source visits and action ranges. `segments/` retains the resumable H.264 streams; `previews/` holds representative battle/story screenshots. Descriptor export also writes `observation-check.json` and an observed replay report; preflight writes `preflight.json` beside the descriptor manifest.

## What appears in the video

- Native battle and story time advances at 21 logical ticks per second. The 1× version includes every supplied native frame. The accelerated versions sample the same deterministic sequence at the requested integer speed.
- Local Center purchases, trades, profile changes, training menus, storage cleanup and Rock Tunnel navigation receive clearly labeled activity summaries derived from action logs. These cards are reconstructed summaries; they are not recordings of menus the historical headless bot never displayed.
- Activity cards retain a fixed two-second hold at every speed so their text remains readable. Consequently, an accelerated file's total duration is not exactly the 1× duration divided by its speed.
- Every recorded visit is retained, including losses, retries, training visits and the nested auxiliary profile campaigns. Auxiliary activity is placed at its actual insertion point in the primary account's action history.
- The final Pokédex card reads the recorded final save. Its 151-species total combines normal, shiny and shadow entries. It does not claim all 453 form entries.

The battle camera fits the entire map into the game frame so off-center bot placements remain visible. This changes framing from the application's default cropped camera. Original story panels retain their source camera transforms. The footer identifies the presentation. Between-visit activity cards use the next recorded visit's checkpoint as their progress context; initial and final cards use their exact saved snapshots. A summary without a recorded save or explicit count shows `—/151`, rather than borrowing an unrelated worker's progress.

Safari Joey and the forced challenge teams come directly from their native temporary battle profiles. The video's Safari adapter draws the recovered Bait/Rock artwork at each live projectile's actual coordinates and animation age. Those projectiles are separate from the general native display list; the adapter only paints them and does not calculate damage, status, movement or capture outcomes.

These videos are silent. They do not replay the browser's sound or music clocks, which would run independently of accelerated frame export. They also do not demonstrate mouse/touch input, keyboard accessibility, ordinary menu layout, network services, or persistence in a user's browser account.

## Integrity checks and debugging

Descriptor export observes the existing runner and its original identity allocation. It records each visit's checkpoint, seed, tunnel session and ambient RNG position. The observer loader supplies read-only instrumentation without editing `src/` or the frozen bot implementation. Export fails if the complete observed replay differs from the source result hash.

Preflight checks each visit's outcome, frame count, native summary, identity allocation and final save against the recorded result. Browser recording repeats the native replay and checks the final save hash and frame count before accepting its encoded output. Timelines retain source report/action references and account for every logged action exactly once. This keeps navigation, preparation and auxiliary play from silently disappearing between battles.

The visual layer stops Phaser's automatic game loop and advances no battle or story state. It waits for the currently needed native artwork before painting, so an effect's first frame does not disappear while its renderer loads. Visual texture keys use a separate random source. Video frames are submitted directly to WebCodecs with explicit timestamps instead of recording browser wall-clock playback.

Run the focused browser renderer check with:

```sh
node tools/video/test-view.mjs
```

It launches a private Vite server and headless Chrome, renders a native attack frame, a story panel, a real Safari projectile, a temporary challenge team and a Pokédex card, and writes PNGs plus `result.json` to `artifacts/video/view-smoke/`. It checks unchanged battle/save/native-display state, unchanged story state, unchanged Safari/challenge state, no consumption of gameplay RNG, and identical PNGs for two renders of the same frame. The screenshots should also be inspected when changing the view.

The rendering API in [`tools/video/view.mjs`](../tools/video/view.mjs) is:

```js
const view = await createVideoView({ data, assets });
await view.setBattle(battle, metadata);
await view.render(metadata);                  // Same 960 × 640 canvas each time.
await view.storyFrame(storyRuntime, metadata);
await view.card({ kind: 'pokedex', save, title: 'Recorded Pokédex' });
view.dispose();
```

`data.timelines` and the Pokémon, map, effect and audio manifests are the same inputs as the application. The recording page uses `<base href="/">` so the original asset modules resolve correctly. Metadata can supply the title, profile, purpose, visit count, logical frame/time, explicit Pokédex count, saved profile, summary lines and footer. Rendering calls never click controls, tick a controller, train a Pokémon, award progress, or save an account.

Keep the source reports and descriptor directory with the video artifacts so a suspected bug or visual mismatch can be traced to its exact visit, checkpoint and action range. Game findings remain documented separately in [BOT_BUG_FINDINGS.md](BOT_BUG_FINDINGS.md); a video export failure is not automatically a gameplay defect.


## Automatic fresh-run pipeline

`node tools/video/full-run.mjs NEW_RUN_NAME` starts one local job and advances through a fresh strict run, exact observed replay, per-visit preflight, and complete 1×/20×/60× rendering. It stops on any failed stage or incomplete run. Read `artifacts/pipelines/NEW_RUN_NAME/status.json` and that directory's stage logs for the current status. It does not create recurring automations or push anything.

The job uses the approved starter/captures/trades rules and earned Porygon prize, with 12,000 total visits and 8,000 collection visits available. Every output path must be new. Gameplay source fingerprints are checked between stages; preserve the matching source snapshot and do not edit gameplay or bot files while it runs. Individual recorder segments remain resumable through the existing record command if a later rendering interruption needs recovery.

Corrected XP requires substantially more training than the earlier assisted estimate. The first fresh candidate accumulated about 482 hours of native battle time; a complete unabridged 1× export includes that training. The automatic pipeline requests 350,000 bits/second per video and checks a conservative estimate for raw streams plus finished MP4 storage before rendering. It stops if available space is insufficient. Bitrate is an encoding choice, not a change to game speed or frame coverage. Accelerated versions retain the same visits; readability and final media still require visual verification.
