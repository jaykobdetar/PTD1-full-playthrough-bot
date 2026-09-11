# Recorded gameplay XP overflow

This directory archives local bot-generated player data from `artifacts/bot/policy-late-4`, campaign 40, phase `class_953`, visit 11, seed `2633394879`. It contains no imported user profiles. No game source was changed to produce the failure.

- `checkpoint.json`: byte-for-byte copy of the valid pre-visit `checkpoints/00011.json`, including its isolated Center bank and six-member party.
- `final-save.json`: byte-for-byte copy of the invalid save after the native victory at frame 2274.
- `original-report-excerpt.json`: relevant report metadata, original file hashes, visit, and issue. Stack paths are made repository-relative.
- `original-actions.jsonl` and `original-events.jsonl`: all rows for original visit 11, retaining their recorded sequence numbers.
- `reproduced-evidence.json`: read-only XP instrumentation from replaying this checkpoint, including the first invalid award at frame 2088.

Reproduce from the repository root:

```sh
node tools/bot/reproduce-xp-overflow.mjs --out artifacts/bot/xp-overflow-repro
```

The output directory must be new or empty. The script calls the actual game story/runtime and policy, preserving the recorded party instead of the later three-member bot workaround. It writes fresh action/event logs, evidence, and final save. Exit 0 means the XP defect reproduced; exit 2 means it did not reproduce with the current source/policy. This diagnostic is separate from completion coverage.

See [QA-004](../../BOT_BUG_FINDINGS.md#qa-004--recalled-contributors-compound-bonus-xp-until-signed-integer-overflow-corrupts-the-save) for the mechanism, impact, and distinction from isolated model fixtures.
