# Game fixes before the starter-and-captures recordings

The user approved fixing the discovered game bugs on 2026-09-09 before recording. Earlier diagnostics and assisted videos remain historical evidence; they are not results for this patched game.

- **QA-004, XP corruption:** deduplicate combat contributors by saved Pokémon identity and compute the level bonus independently for each share. Forty redeployments now earn one share; six low-level participants receive equal boss bonuses. This also removes the unintended XP inflation below the overflow threshold. A fresh run must earn its levels under the corrected calculation.
- **QA-006, copied Earthquake:** enemy Mirror Move can invoke Earthquake with the enemy faction as its caster, targeting player towers at full damage and other enemy allies at half damage. The original tower cast path remains intact.
- **QA-007, projectile disposal:** damage can synchronously dispose the active projectile effect. The adapter now unwinds that disposed effect before it reads its cleared projectile list. Real Stone Edge and Air Slash regression cases reproduce the old failure and now pass; unrelated exceptions still propagate.
- **QA-005, first-clear rewards:** restore `var_334` before advancing the campaign unlock. The recovered first-clear rule now exposes the original Dojo, Fuchsia and Cinnabar reward movies. Replays do not repeat those rewards. The bot chooses opposite Dojo rewards in Red/Blue profiles and the two different fossils at stages 32/33, using visible movie controls and normal trades.
- **QA-001, Tunnel reward Pokédex:** record the shiny Voltorb immediately when the model grants it, without requiring a save reload.
- **QA-002, story RNG:** the three recovered random encounter selectors now call the runtime's injected RNG. A test keeps global randomness at 99% and verifies that the supplied 10% draw selects Zubat.
- **QA-003, achievement description:** clarify that the all-candy/level-30 Cerulean achievement takes priority. The original exclusive award behavior is preserved.

## Original reward-rule evidence

The missing source was found in the user's other local project, at:

`/home/jaykob/Documents/Codex/2026-09-06/home-jaykob-downloads-local-pokemon-tower-2/work/game-source/scripts/code/`

`level_26.as:349` sets `var_334` inside `unlock_Next_Level` only when `playerProfile.levelUnlocked < get_Level_Num()`. `level_27.as:26`, `level_32.as:28`, and `level_33.as:30` compute the same first-clear predicate in their constructors. The port represents the source unlock counter as `save.unlocked - 1`, hence the equivalent condition `save.unlocked <= campaignId` before progression advances. The source files were read without modification.

The earlier report correctly identified the missing assignment in this repository; its statement that the original condition was unknown is superseded by this recovered evidence.

## Verification

Focused combat tests exercise all 433 native moves, the three crash reproductions, independent and duplicate-contributor XP awards. Story tests exercise first-clear wins, repeat wins, losses, both fossil choices, and the original Fuchsia item movie. Full-suite and fresh-run results will be recorded after the bot strategy is stable. Unit fixtures that force a victory are reward-gate tests, not playthrough evidence.

## Additional failure found during post-fix collection

**QA-008, copied Whirlwind:** the Blue auxiliary's real stage-21 visit (seed 2807888682, frame 2703, `patched-collection-4/auxiliary-1-1/checkpoints/00243.json`) reproduced a route reversal on a stationary tower. `Battle.turnAround` assumed a path and indexed `undefined`. It now leaves entities without a walking route in place; ordinary enemy route reversal remains unchanged. A native enemy Mirror Move → delayed Whirlwind test executes the exact reversal effect against the real battle method, and verifies the tower's position and deployment remain intact.

The full suite passed 332 tests before QA-008. The expanded native move suite then passed all 28 tests, including QA-008. The production build passed. The diagnostic `patched-progress-3` completed 42/42 campaign stages without recorded runtime errors under corrected XP; it is a resumed strategy diagnostic, not the final fresh replay or video evidence.

Actual patched reward visits in `patched-progress-3` earned Hitmonlee at stage 26 (attempt 177, seed 3882592300, 690 frames), Omanyte at stage 32 (attempt 307, seed 3664875161, 7872 frames), and Kabuto at stage 33 (attempt 508, seed 2308116359, 8722 frames). Their `dexGained` fields record 106, 138 and 140 respectively. The QA-008 recorded checkpoint also replayed beyond the original crashing frame to an ordinary loss at frame 12842 without an exception (`whirlwind-regression/report.json`). A loss remains a loss.

## Capture capacity failure (QA-009)

A fresh strict candidate reached 5,001 Pokémon in its Blue auxiliary profile, then failed save validation after winning stage 31 (seed 1860322713, frame 15393). Ordinary and Safari capture now enforce the existing 5,000 limit before creating a Pokémon or changing the enemy, candy, party, or statistics. Two boundary regressions verify the final available slot succeeds and the next capture is rejected without mutation. The bot separately releases surplus duplicates through the normal release API; the game fix never deletes owned Pokémon. Other story/achievement acquisition boundaries remain an explicit follow-up.

For the portable patch, file hashes, exact reproduction cases, save limitations and application instructions, use [the main-build guide](game-fixes/README.md). That guide is the current fix register; earlier counts and diagnostics above are dated evidence.

Current verification: **336/336 tests passed**, and the production build passed. [Saved verification output](game-fixes/verification/results.json) includes the non-fatal build chunk-size warning. The previous failed bot money-accounting assertion omitted a normal 1,000-cost preparation move; the regression now accounts for preparation spending separately from in-battle training costs. This was a test expectation issue, not evidence of unearned money.
