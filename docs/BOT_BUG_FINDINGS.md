# Reproduced findings and ruled-out suspicions

Historical audit date: 2026-09-08. The observations below describe the pre-fix game.

**Status update, 2026-09-09:** the user authorized fixes before recording. QA-001 through QA-007 are now patched; see [the fix notes and recovered first-clear source evidence](BOT_GAME_FIXES.md). The diagnostic fixtures and archived failures remain available. References below to unchanged source, unknown reward eligibility, and bot workarounds describe the earlier audit, not the current implementation.

The later `policy-late-4` campaign run encountered an XP overflow that invalidated its save. QA-004 below reproduces that actual gameplay failure from its recorded checkpoint using legal controls. QA-001 through QA-003 use separate model/runtime fixtures and do not contribute to completion coverage. The earlier `full-calibration-1` and `full-calibration-2` runs contained no recorded runtime exceptions or warnings.

Reproduce the isolated observations from the repository root:

```sh
node tools/bot/reproduce-findings.mjs
```

The script prints JSON, reads calibration artifacts if present, and makes no file writes. Its explicit HP and quest prerequisites are diagnostic fixtures, not player actions. It temporarily replaces `Math.random` for one isolated API test and restores it.

## Observed gameplay failure

### QA-004 — Recalled contributors compound bonus XP until signed integer overflow corrupts the save

**Classification:** confirmed game-runtime and save-integrity defect encountered during a real campaign visit; reproduced from recorded player state without manufactured HP, XP, money, or progression.

In `policy-late-4`, visit 11 played campaign 40's `class_953` phase with seed `2633394879`. The native battle won at frame 2274, but its final Nidoking (`center-pc-22`) had **−1,103,410,264 XP**. The game's `validateSave` rejected the result with `Invalid experience.` The report correctly recorded an error despite the native battle's victory. The player cannot reload that invalid save normally.

The [archived reproduction](bot-repros/xp-overflow/README.md) contains the unchanged valid pre-visit checkpoint, unchanged invalid final save, relevant original report/actions/events, and instrumented reproduction evidence. Run:

```sh
node tools/bot/reproduce-xp-overflow.mjs --out artifacts/bot/xp-overflow-repro
```

Use a new or empty output directory. This replay intentionally retains all six recorded party members and skips the bot's subsequent three-member party workaround. It uses the actual story runtime, default policy, native battle ticks, training menu, moves, and tower controls. Instrumentation only observes XP operations and delegates them unchanged. The script produces `evidence.json`, full `actions.jsonl`/`events.jsonl`, and the resulting `final-save.json`; exit 0 means the documented bug reproduced, not that the game's completion requirements passed.

The first corrupting award is deterministic:

| Observation | Value |
| --- | --- |
| Battle frame | 2088 |
| Defeated target | Muk, level 102, base experience 314 |
| Contributor actor references | 24 |
| Distinct contributor Pokémon identities | 5, from a six-member party |
| Initial shared XP value | `floor(314 × 102 / (7 × 24)) = 190` |
| Amount passed to the 24th contributor | `190 × 2^24 = 3,187,671,040` |
| Nidoking XP before / immediately after | `702,408` / `−1,106,593,848` |
| Nidoking XP at the end of battle | `−1,103,410,264` |

[`Battle.defeat`](../src/battle.js) takes contributors from [`move-native.js`](../src/move-native.js), which returns the native enemy's `hit_Me_List` actor references without deduplicating their Pokémon identities. Recall/redeployment can leave multiple actors for the same owned Pokémon in this list. `Battle.defeat` mutates one shared `xp` variable with `xp *= 2` inside the contributor loop, so each eligible actor doubles the next actor's award again. The native receiver's signed 32-bit integer conversion wraps the oversized amount negative. The archived evidence records the individual amounts and profile values, including the exact overflow.

The bot now chooses three party members for this phase to avoid this observed trigger and rejects negative/out-of-range XP during integrity checks. Those are bot workarounds, not a game fix or proof that other legal team configurations are safe. Investigate contributor identity handling and per-recipient bonus calculation together; preserve this recorded-state reproduction when implementing the fix.

### QA-005 — Dojo and fossil reward choices have no eligibility producer in the native runtime

**Classification:** confirmed unreachable reward branch in the current production API, with recorded gameplay evidence; the intended original eligibility rule still needs recovery. This does not establish that every victory should receive these rewards.

Three valid recorded player checkpoints were replayed through the real battle, party policy, and win movie. All native battles won. Their win movies immediately offered only `butt_end`; no Hitmon or fossil choice appeared and no popup Pokémon was awarded:

| Stage | Seed | Victory frame | Remaining candy | Observed `var_334` |
| --- | --- | --- | --- | --- |
| Saffron Dojo, 26 | 132541240 | 606 | 0, all four stolen | `false` |
| Cinnabar Island, 32 | 814657751 | 7851 | 7 of 8 | `false` |
| Cinnabar Gym, 33 | 3363306467 | 8035 | 1 of 8 | `false` |

The [archived checkpoints and evidence](bot-repros/story-rewards/README.md) can be replayed with full native action/event logs:

```sh
node tools/bot/reproduce-story-rewards.mjs --out artifacts/bot/story-rewards-repro
```

Source inspection explains the missing choice branch. Popups `class_1069` (Dojo), `class_1037` (Island), and `class_998` (Gym) require `stage.var_334` to offer their species choice. No production battle, stage hook, or story caller writes that property. [`StoryRuntime.stageProxy`](../src/story-runtime.js) returns `false` for an unknown `var_*` property, and [`original-story-ui.js`](../src/original-story-ui.js) passes the same battle facts as the bot. This is shared native-runtime behavior, not a choice button that the bot declined. The generic driver cannot lawfully enable a reward by inventing that flag.

The separate Aerodactyl route is implemented: stage 32/33 requires every candy retained and no previous extra-info flag 29/34, then passes `var_556`. The two recorded Cinnabar visits lost candy, so **their missing Aerodactyl is expected and is not a bug finding**. The unexplained `var_334` branch concerns Kabuto/Omanyte and the Dojo selection; inspect the original stage eligibility rules before deciding how to restore it.

Available legal collection alternatives in the existing Center catalog are:

| Species | Shiny adoption ID | Credit cost |
| --- | --- | --- |
| Hitmonlee | `uncommon-21` | 5 |
| Hitmonchan | `uncommon-22` | 5 |
| Omanyte | `uncommon-39` | 5 |
| Kabuto | `uncommon-40` | 5 |
| Aerodactyl | `uncommon-41` | 5 |

These species are also in the `corner-13` random shiny egg pool. Each actual purchase costs 200,000 Casino Coins; `exchangeCoins` converts earned Pokédollars one for one. Purchases have no daily cap, but a particular species is not guaranteed within a finite budget. Daily/weekly mystery gifts can also return them, once per profile and period. These are catalog acquisition opportunities, not a claim that the bot obtained them in the three visits above.

A further Hitmonchan opportunity is the actual Dojo achievement: launch only level-70-or-lower attackers and steal candy four first. After Challenge 3, `claimAchievement(6)` awards Hitmonchan when extra-info flag 30 is absent, or Hitmonlee when it is present. A qualifying restricted battle must be played before claiming; the archived unrestricted high-level victory does not satisfy that prerequisite.

## Source/model findings

### QA-001 — Rock Tunnel's model reward misses the immediate Pokédex update

**Classification:** confirmed model consistency defect; not reproduced in a complete gameplay visit.

With quest flag 32 earned, ten session Pikachu captures, and level-42 Pikachu/Electrode in the party, `RockTunnel.choose('check-quest')` grants shiny Voltorb. The Pokémon is present in the collection and quest flag 33 is recorded, but shiny species 100 is absent from the save's Pokédex until the save is reloaded.

Observed output:

```json
{
  "received": true,
  "rewardSpecies": 100,
  "rewardShiny": 1,
  "inCollection": true,
  "inDexBeforeReload": false,
  "inDexAfterReload": true
}
```

Cause: [`checkShinyQuest`](../src/rock-tunnel.js) pushes the profile into `save.pokemon` but never calls `recordOwned`. `validateSave` reconstructs ownership during reload. The recovered `class_985` popup uses `update_Pokedex`, so the two navigation implementations disagree.

Impact: the fallback/model route can show a stale shiny Pokédex or report a missing species immediately after awarding it. A future fix should update ownership when the native model grants the reward and retain a regression test for the immediate state. Reload is an existing workaround.

### QA-002 — Recovered story encounter code ignores the injected RNG

**Classification:** confirmed runtime API defect; deterministic bot adapter already compensates for it.

Construct the genuine `StoryRuntime` for room 1 (`class_954`, popup `class_985`) with `rng: () => 0.1`, keep global `Math.random` at `() => 0.99`, and click the exposed Left/Next/Close controls. The supplied RNG indicates Zubat; the actual transition selects Machop:

```json
{
  "suppliedRoll": 0.1,
  "globalRoll": 0.99,
  "expectedWaveClass": "class_23",
  "actualWaveClass": "class_69",
  "closed": true
}
```

Cause: [`StoryRuntime`](../src/story-runtime.js) places the supplied RNG on its Math adapter, but the generated functions in [`story-data-controllers.js`](../src/story-data-controllers.js) call unqualified `Math.random()` (room 1 at line 9994; similar room rolls at lines 7045 and 7614).

Impact: callers cannot reliably control these encounters through the advertised RNG parameter. This is not a claim that the game selects invalid species. [`tools/bot/story.mjs`](../tools/bot/story.mjs) currently scopes/restores global randomness for its synchronous movie execution, so bot runs remain reproducible. A game fix should make the translated controller use the supplied adapter directly.

### QA-003 — Cerulean achievement checks conflict with the independent descriptions

**Classification:** confirmed rules/description mismatch; whether to preserve original exclusivity or award both requires a product decision.

The descriptions in [`achievements.js`](../src/achievements.js) independently qualify achievement 3 for no Grass/Electric deployment and achievement 8 for keeping every candy with Pokémon at level 30 or below. The actual [`stageWinAchievements`](../src/stage-hooks.js) callback uses `else if`, so the first condition suppresses the second award.

Direct callback fixtures returned:

| All deployed levels ≤30 | All candies retained | Grass/Electric deployed | Awarded IDs |
| --- | --- | --- | --- |
| Yes | Yes | No | `[8]` |
| No | Yes | No | `[3]` |
| Yes | No | No | `[3]` |

This fixture supplies already-observed battle facts to the actual victory callback; it does not simulate or claim a victory. The implementation's exclusivity is also documented in `COMBAT_PARITY.md`. Thus the reproducible issue is the mismatch with the player-facing conditions, not proven divergence from the original Flash game. Achievement 3 remains obtainable by another qualifying visit that does not also satisfy achievement 8.

## Investigated and not bugs

### False Swipe preserves 1 HP on an exactly lethal hit

The early `class_553.do_Attack` test uses `damage > current life`, which alone looks suspicious. Its delayed `class_301.remove_Me` handler rechecks **`damage >= current life`** immediately before applying damage and clamps it to current life minus one. The final clamp is in [`move-source-generated.js`](../src/move-source-generated.js), around line 15780.

The reproduction runs the actual native move and its effect timeline with a deterministic calculated damage of 42:

| Starting target HP | Case | Target HP after impact | Alive |
| --- | --- | --- | --- |
| 42 | Exactly lethal before clamp | 1 | Yes |
| 41 | Overkill before clamp | 1 | Yes |
| 1 | Already at minimum | 1 | Yes |

The suspected off-by-one defect is **not reproduced**. Do not change the early comparison based only on reading `do_Attack`; the impact handler already enforces the rule.

### Calibration persistence changes are benign normalization

| Artifact set | Visits in that run | Logged events | Runtime warnings | Runtime errors |
| --- | --- | --- | --- | --- |
| `full-calibration-1` | 40 | 3,335 | 0 | 0 |
| `full-calibration-2` | 50 | 6,430 | 0 | 0 |

The first report records strategy blockers at stage 14 and Challenge 2. The second records a strategy blocker at stage 25. Losses and retry exhaustion are not evidence of a broken game rule.

Both `final-save.json` files pass the game's `validateSave`. Comparing before/after values finds only missing `nickname`/`myTag` defaults, plus numeric `haveFlash: 1` becoming boolean `true` in the second run. There are 2 and 51 such field changes, respectively. Campaign flags, money, party membership, identities, levels, moves, and owned species survive. The second run's Center bank sorts Pokédex arrays; their species sets exactly match the standalone save for normal, shiny, and shadow forms.

These serialization differences do not demonstrate lost progress. The reproduction prints the event counts and semantic checks again when the corresponding artifact directories are available.

## QA-006 — enemy Mirror Move copies Earthquake and crashes

Confirmed in the earned-team diagnostic `artifacts/bot/starter-policy-14/report.json`, attempt 37, stage 21, seed 1974644251, frame 2481. The original Mirror Move controller reads the target profile's first move slot, which was Earthquake (194) on the player's Graveler. Its enemy Fearow then executes Earthquake. `class_590.do_Attack` in `src/move-source-generated.js:32550` casts the attacking enemy to `poke_Tower`; `src/move-native.js:49` throws `Original cast to poke_Tower failed`. The saved checkpoint is `artifacts/bot/starter-policy-14/checkpoints/00037.json` and the report contains the full stack and battlefield snapshot.

The bot's workaround excludes Pokémon whose first slot is Earthquake from stage 21's party. The game implementation is unchanged. This is a runtime defect, unlike the separately recorded strategy losses.

## QA-007 — projectile effect continues after its list is disposed

Two earned-team Saffron Gym diagnostics threw `Cannot read properties of null (reading 'length')` inside native projectile controllers:

- `starter-policy-16`, attempt 61, seed 494992048, frame 346: Stone Edge's `class_307.run`, `src/move-source-generated.js:16577`.
- `starter-policy-17`, attempt 18, seed 1370345969, frame 1552: Air Slash's `class_248.run`, `src/move-source-generated.js:9584`.

Each controller iterates its projectile array, applies damage during that loop, and has a disposal method that nulls the array. The failures are consistent with synchronous effect disposal during damage processing; the exact disposal caller still needs tracing. Reports contain the stack, battlefield snapshot and pre-battle checkpoint. These are confirmed runtime errors; that causal explanation remains a hypothesis. The bot avoids Stone Edge and friendly-fire Earthquake while further strategies are tested. No game code was patched.
