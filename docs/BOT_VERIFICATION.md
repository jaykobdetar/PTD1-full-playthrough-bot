# Bot verification — 2026-09-08

This is the earlier **Pokécenter-assisted** playthrough. It began with a new Bulbasaur profile and no inherited completion, then bought ten level-90 adoptions before the first battle. The bot earned auxiliary badge rewards by playing through stage 11 with borrowed Pokémon. The matching replay proves this assisted run's consistency; it does not establish starter-and-captures progression. Its frozen bot source is preserved in `artifacts/bot/assisted-source-snapshot/`.

Source repository: `jaykobdetar/Phaser-PTD1`, downloaded at commit `2f73d0c8588e52a8c0c53ee1485a289c34e2962b`. Bot development branch: `codex/deterministic-playthrough-bot`. Environment: Node.js v22.16.0, Linux x64, `en-US`.

## Fresh result

| Check | Result |
| --- | --- |
| Requested scope / process exit | Complete / `0` |
| Complete fresh-run replay | **Exact match / `0`** |
| Campaign | **42 / 42** |
| Additional single-player content | **20 / 20 battle phases won; 3 / 3 navigation scenes visited** |
| Challenges | **6 / 6** |
| Pokédex species | **151 / 151** |
| Recorded issues in this final run | **0** |
| Visits | **204**: 178 primary, 15 Blue auxiliary, 11 Red auxiliary |
| Logical battle ticks | 1,527,939 |
| Logged primary/account actions | 39,164; auxiliary actions also have their own logs |

The Pokédex result counts species owned in any form: 136 normal entries, 19 shiny entries, and 4 shadow entries, with overlap. It does not claim all 453 form entries or all optional achievements. The six Challenge-mode levels and all additional single-player phases are covered. Phaser rendering, browser controls, audio, and multiplayer are outside this headless verification.

Run the same configuration from the repository root:

```sh
npm run bot -- --mode all --seed 1 --out artifacts/bot/full-run
npm run bot -- --replay artifacts/bot/full-run/report.json --out artifacts/bot/full-run-replay
```

Use new output directories. Defaults used: starter 1, campaign through 42, Center on, 12 attempts per objective, 3 training visits between retries, 1,500 total visit limit, 100,000 ticks per battle, and 250 collection visits.

## Recorded identity

```text
Source/data fingerprint
d16b26971f2605bd5b1a5655258a23611362efef75cc1c93f483652b6eff41ab

Result SHA-256
1569df2573a28630408a02bdac2169a1b1231eed26325f60316a43305757eda4

Primary/account action SHA-256
54443fd94dbcd072568d2b4a927443f815d48a375ee693648457caa57d07896f
```

The full [fresh report](../artifacts/bot/final-seed-1/report.json), [run findings](../artifacts/bot/final-seed-1/BUGS.md), checkpoints, saves, bank, actions, and events remain in `artifacts/bot/final-seed-1/`. Large run artifacts are intentionally ignored by Git; preserve the directory when sharing the execution evidence.

The [complete replay](../artifacts/bot/final-seed-1-replay/report.json) also reached every completion requirement. Its [replay comparison](../artifacts/bot/final-seed-1-replay/replay.json) reports `match: true`, with the exact result hash above. The primary/account action hashes and both auxiliary result hashes matched as well.

## Checks and findings

- `npm test`: **304 passed, 0 failed**.
- `npm run build`: passed; the existing bundle-size warning remains.
- `reproduce-findings.mjs`, `reproduce-xp-overflow.mjs`, and `reproduce-story-rewards.mjs`: all completed successfully against the retained evidence.
- Independent save/account audit: all three profiles passed the game's validators, the final primary save matched its bank slot, all 294 roster identities were unique, and source/account ownership checks passed. Both auxiliary reward claims followed actual two-badge wins. No paid eggs were needed.

The [five recorded findings](BOT_BUG_FINDINGS.md) distinguish real gameplay reproductions, isolated model/runtime observations, and a rules/description mismatch. The XP overflow and unavailable reward branches have portable recorded-state reproductions under `docs/bot-repros/`. The final bot avoids the observed XP-overflow trigger through legal team selection; no game fixes were applied.

See the [bot guide](BOT.md) for replay, resume, checkpoint recovery, and report formats.
