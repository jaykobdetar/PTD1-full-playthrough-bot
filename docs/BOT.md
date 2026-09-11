# Deterministic playthrough bot

The bot plays the native JavaScript game rules in an isolated Node.js process. It chooses a party, places and moves towers, selects moves, trains, captures, uses potions, launches invasions, follows story choices, and navigates Rock Tunnel through the game's exported actions. It records results and problems so game fixes can be investigated separately.

Run it from a source checkout with Node.js 22 and npm:

```sh
npm ci
npm run bot -- --mode all --seed 1 --out artifacts/bot/full-run
```

No web server or production build is required for the bot. The output directory must be new or empty. Without `--out`, the CLI creates a directory under `artifacts/bot/`. Use `npm run bot -- --help` for the current option list.

## What the run verifies

The runner uses the recovered move classes, animation timelines, abilities, boss AI, wave scripts, story controllers, and stage rules. Each logical battle tick represents 1/21 second of game time. Node executes those ticks as quickly as the machine permits, without changing their order or duration inside the simulation. Native NPC behavior remains active, and explicit stage policies handle objectives that need particular team choices, timing, or navigation.

This is headless game-model testing. It does not verify Phaser rendering, browser startup, mouse hit areas, keyboard controls, audio playback, or browser/disk-server save coordination. It also does not automate local two-player multiplayer. Those surfaces need separate UI testing.

The bot does not write victories, edit HP to win, invent captures, or grant money/XP. Normal source/model operations perform the changes. Reproducibility controls the random generators and identity timestamps in the dedicated bot process. Recorded errors are findings for later investigation; running the bot does not apply game fixes or push anything to GitHub.

## Modes and completion

| Mode | Work attempted | Successful scope |
| --- | --- | --- |
| `all` | Campaign, challenges, then collection; retry with the improved earned team | All campaign entries, additional single-player phases, challenges, and species below |
| `campaign` | Campaign through `--through` | Every campaign entry up to that number is complete |
| `challenges` | Challenges in unlock order | All six challenges are complete |
| `collection` | Collection work on the loaded profile | The Pokédex contains all 151 species across its forms |

The full `all` criterion is **42 campaign entries, 23 additional single-player variants, six challenges, and 151 species**. The variants comprise 20 battle phases and three navigation scenes; battles require wins and navigation scenes require visits. Resumed runs retain previously recorded phase coverage.

The 151-species count is the union of normal, shiny, and shadow ownership history. The normal local Center service shares earned Pokédex entries across the three profiles in this isolated account (`syncCenterDex`); this count is account-wide, not a claim that the primary profile holds every species simultaneously. Each form has its own count and missing-species list in `report.json`. Completing that union does **not** claim 453 separate species/form entries. Achievement records are reported separately and are not an additional success condition.

`--through` limits campaign traversal; it does not reduce the complete-game requirements of `--mode all`. Use `--mode campaign --through 4` for a small requested scope. Collection can revisit any completed stage, so a resumed partial campaign can make collection progress. Later encounters remain gated by their real campaign prerequisites. A fresh collection-only run has no completed stages to revisit.

Completion is evidence from actual save progression and successful visits. A route listed in the [completion audit](BOT_COMPLETION_AUDIT.md), [content manifest](BOT_COMPLETION_MANIFEST.json), or [encounter candidates](BOT_ENCOUNTER_CANDIDATES.json) is a planned acquisition opportunity, not proof that the bot has won it or captured its species. The run's report is the record of what happened. Errors prevent a successful completion result even if the coverage counters otherwise qualify.

## Starter progression and optional Center assistance

`--center trades` is the default. Campaign play begins with the chosen level-5 starter and the normal 50 money. Adoptions, daily credits and gifts are disabled. The sole reward-purchase exception is the regular level-1 Porygon prize, bought with exactly 5,500 battle-earned coins (`--corner earned`, or `--corner off` to disable). The team must earn XP, training money, captures and story rewards through gameplay. Collection can create the other starter/version profiles and exchange genuinely owned Pokémon through local trades. Those profiles start their campaigns with their own level-5 starters; they receive no high-level loans.

`--center on` explicitly selects the older **assisted** mode. It uses the real local Center transaction service to claim available credits and buy adoption Pokémon. The catalog offers level-90 Pokémon for one credit each; the earlier verified run acquired ten before its first battle. This follows the application's transaction rules but bypasses ordinary early-game progression and does not validate starter-based balance.

In assisted mode, auxiliary collection trips can borrow the primary team's Pokémon, play through the first two badges, then claim badge credits and return the loans. In starter-and-captures mode, auxiliaries earn their own progress and proceed to the stages needed for version exclusives. Every auxiliary battle is separately recorded. A strict auxiliary may return as soon as all its requested species are earned, including a capture in a lost battle; that does not mark the lost stage complete. All-mode can revisit campaign/challenge/collection phases up to eight times while its earned team or coverage improves, always within the total battle budget. Assisted legacy runs retain their single pass.

The clock remains fixed throughout a run; it does not advance to farm daily or weekly rewards. Center wallets and claim history are saved in the run's bank artifact and retained on resume. An earlier claim cannot be repeated to collect badges earned later on the same day. Auxiliary profiles and trades exist only in this isolated bot account.

The runner does not discover, import, or modify your existing browser profiles or `saves/profiles.json`. Resume reads the bot report directory you explicitly name. To exercise starter-based progression without Center purchases, use:

```sh
npm run bot -- --mode campaign --through 4 --center off --seed 1 --out artifacts/bot/starter-run
```

The run rules are part of the reported configuration. An assisted account cannot be resumed and relabeled as starter-and-captures progression. Compare runs with the same setting when evaluating policy changes.

## Options and budgets

| Option | Default | Meaning |
| --- | --- | --- |
| `--seed N` | `1` | Integer random seed from 0 through 4,294,967,295 |
| `--starter 1\|4\|7` | `1` | Bulbasaur, Charmander, or Squirtle for a fresh profile |
| `--mode MODE` | `all` | `all`, `campaign`, `challenges`, or `collection` |
| `--through N` | `42` | Campaign stopping point, 1–42 |
| `--center trades\|off\|on` | `trades` | Earned teams and trades; no account; or explicit assisted adoptions/gifts |
| `--max-attempts N` | `12` | Maximum attempts per objective |
| `--grind N` | `3` | Training visits between eligible retries; 0 disables them |
| `--max-battles N` | `1500` | Total primary and auxiliary visit budget for this invocation |
| `--max-ticks N` | `100000` | Maximum logical battle ticks per visit |
| `--dex-visits N` | `250` | Collection visit budget, including auxiliary campaign/capture visits; 0 disables those visits |
| `--out PATH` | Generated path | New or empty artifact directory |
| `--replay REPORT` | — | Repeat a recorded run and compare its result hash |
| `--resume REPORT` | — | Continue from a recorded run's final save and bank |
| `--checkpoint PATH` | — | With `--resume`, recover from a recorded pre-visit checkpoint in that report |

Budget exhaustion is an incomplete result, not a forced victory. Failed strategies and resource or collection prerequisites are classified separately from runtime errors. A recorded runtime, save-integrity, or auxiliary error stops further gameplay; reports and recovery snapshots preserve the failure for investigation. Larger budgets permit more attempts; they do not guarantee a win.

## Replay and resume

Replay uses the saved configuration and checks the source/data fingerprint. Keep the matching checkout and bot files when reproducing a historical report:

```sh
npm run bot -- --replay artifacts/bot/full-run/report.json --out artifacts/bot/full-run-replay
```

A matching replay writes `replay.json` with `match: true`. A mismatch or source fingerprint change exits with an error. The check compares the resulting save, coverage, attempts, and decision history; it is not a replay of rendered mouse input.

An `auxiliary-<slot>-<trip>/report.json` is a nested part of its parent invocation. Its `parentReplay` field points to the report that must be replayed. Replaying that nested report alone is rejected because the trip shares the parent process's random/identity state and account transactions. Replay the top-level report to repeat the loans, auxiliary gameplay, captures, rewards, and returns together.

Resume starts a new invocation from the prior final save, retains its bank and inherited completion records, and allows a new configuration or larger budgets:

```sh
npm run bot -- --resume artifacts/bot/full-run/report.json --mode all --center on --seed 1 --max-attempts 24 --out artifacts/bot/full-run-continued
```

For collection work on a campaign save:

```sh
npm run bot -- --resume artifacts/bot/full-run/report.json --mode collection --center on --dex-visits 300 --out artifacts/bot/collection-pass
```

Resume retains progress but starts at a visit boundary, rather than restoring an actor halfway through a battle. The original game treats the Rock Tunnel Pikachu counter as session-only, so a new process begins a new capture session. Identity reservation prevents new Pokémon from reusing saved identities. The initial save and bank stored with a resumed run allow that invocation itself to be replayed later. `--replay` and `--resume` are mutually exclusive.

When a game error corrupts the final snapshot, restart from the corresponding valid pre-visit checkpoint:

```sh
npm run bot -- --resume artifacts/bot/full-run/report.json --checkpoint artifacts/bot/full-run/checkpoints/00011.json --mode all --out artifacts/bot/recovered-run
```

Replace the checkpoint number with the failing visit's recorded checkpoint. Recovery restores its save and bank, removes inherited coverage from later visits, and records the source checkpoint. The standalone `last-valid-save.json` and `last-valid-bank.json` files are additional validated snapshots; they do not have the checkpoint file format required by `--checkpoint`.

## Artifacts and investigation

| Artifact | Contents |
| --- | --- |
| `report.json` | Configuration, source fingerprint, inherited coverage, primary attempts, auxiliary summaries, missing content, issues, and deterministic result hash; `totalVisits` includes both primary and auxiliary visits |
| `BUGS.md` | Human-readable run findings, classifications, seeds, and checkpoint references |
| `actions.jsonl` | Ordered policy decisions, story controls, navigation, training, captures, and Center transactions |
| `events.jsonl` | Selected engine events, including waves, spawns, captures, faints, finishes, warnings, and errors |
| `checkpoints/NNNNN.json` | Save, stage, seed, party/policy options, story choices (`storyOptions`), required trade participants (`requiredDeployUids`), and available bank immediately before a visit |
| `initial-save.json` / `final-save.json` | Starting and latest recorded primary-profile snapshots |
| `last-valid-save.json` / `last-valid-bank.json` | Most recent snapshots that passed the save checks; the bank file exists when Center is enabled |
| `initial-bank.json` | Starting bank when one was loaded for the run |
| `final-bank.json` | Latest three-profile account, wallet, ownership, and claim history when Center is enabled |
| `replay.json` | Expected/actual result hashes and the match result for a replay |
| `auxiliary-<slot>-<trip>/` | Nested report, initial save/account snapshot, checkpoints, actions/events, and final auxiliary save; linked from the parent's `auxiliary` array |

Reports and final snapshots are updated at visit boundaries. A final snapshot can retain an invalid state for investigation after a game error; use a valid checkpoint to recover. Preserve the entire directory, including nested auxiliary directories, when sharing a reproduction. For an error, begin with its issue classification, stage and seed, pre-visit checkpoint, and the nearby action/event records. Auxiliary errors are surfaced in the parent report with the nested report reference. A lost battle or exhausted retry budget alone does not establish a game bug.

See [reproduced bug findings](BOT_BUG_FINDINGS.md) for the recorded gameplay XP overflow, isolated runtime/model reproductions, and explicitly ruled-out suspicions. The isolated fixture script is separate from the gameplay runner and never contributes wins or captures to coverage:

```sh
node tools/bot/reproduce-findings.mjs
```

Exit codes are:

| Code | Meaning |
| --- | --- |
| `0` | The requested scope completed without recorded errors |
| `2` | The requested scope is incomplete or blocked |
| `1` | Configuration/tool failure, incompatible replay, or replay divergence |

The bot's implementation lives in `tools/bot/`. Its focused tests run with the normal `npm test` suite, or directly:

```sh
node --test tests/bot-*.test.js
```
