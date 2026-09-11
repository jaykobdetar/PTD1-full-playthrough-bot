# Archived native combat crash checkpoints

These five JSON files are byte-for-byte copies of the isolated bot's recorded pre-battle states. `cases.json` preserves their SHA-256 hashes, source report fingerprints, attempts, seeds, outcomes, battlefield snapshots and original error stacks. They contain bot-owned profiles, not imported user browser saves.

| Case | Finding | Stage | Seed | Original crash frame |
| --- | --- | --- | --- | --- |
| `mirror-earthquake.json` | QA-006 | 21 | 1974644251 | 2481 |
| `stone-edge.json` | QA-007 | 25 | 494992048 | 346 |
| `air-slash.json` | QA-007 | 25 | 1370345969 | 1552 |
| `mirror-whirlwind.json` | QA-008 | 21 | 2807888682 | 2703 |
| `capture-capacity.json` | QA-009 | 31 | 1860322713 | 15393 (save validation) |

The portable, focused reproductions are in `tests/move-native.test.js`: the actual native Mirror Move, Earthquake, Whirlwind, Stone Edge and Air Slash effects execute against controlled regression fixtures. The production patch includes those tests. `tests/capture-capacity.test.js` independently exercises the last available storage slot and rejects the next ordinary/Safari capture without mutating the profile.

An exact historical playthrough also requires the matching source/policy fingerprint. Current policy changes may produce a different sequence when starting from these archived saves; a different outcome alone is not a regression proof. The original reports record the observed failures; the focused regressions isolate their causes.

The Whirlwind checkpoint was additionally replayed with the fixed game through the ordinary CLI. It passed the original crashing frame and ended in an ordinary loss at frame 12842. That result proves no victory or additional completion coverage.

See [the main-build guide](../../game-fixes/README.md) for causes, corrections, behavior decisions and test commands. Keep this archive when pushing documentation; files under `artifacts/` are intentionally ignored and are not sufficient as portable evidence.
