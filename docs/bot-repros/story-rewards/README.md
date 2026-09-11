# Recorded Dojo and Cinnabar reward movies

The three JSON checkpoints are unchanged copies of actual local bot-generated player states before the visits identified in `cases.json`. The source hashes and original outcomes are recorded there. They contain isolated bot profiles, not imported user saves.

Run from the repository root:

```sh
node tools/bot/reproduce-story-rewards.mjs --out artifacts/bot/story-rewards-repro
```

The output directory must be new or empty. The script plays the native battles and actual story controls with the recorded seed and legal policy actions. It writes per-case actions, events, final saves, and aggregate evidence. No eligibility flags, HP, XP, money, or completion fields are manufactured. Exit 0 means the documented missing-choice observations reproduced; it is separate from playthrough completion reporting.

`reproduced-evidence.json` records the validation run: all three native victories match their historical frame counts, and each win movie exposes only `butt_end`. This alone does not establish the original reward eligibility rule. Source analysis in [QA-005](../../BOT_BUG_FINDINGS.md#qa-005--dojo-and-fossil-reward-choices-have-no-eligibility-producer-in-the-native-runtime) establishes the missing `var_334` producer in the current API. The two Cinnabar runs lost candy, so they correctly fail the separate all-candy Aerodactyl condition.
