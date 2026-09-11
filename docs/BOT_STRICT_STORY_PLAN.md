# Starter-and-captures story and challenge plan

This audit addresses a fresh starter followed by actual captures, training, evolutions, trades, and earned story/challenge rewards. It does not use Center adoptions, daily credits, mystery gifts, or Game Corner purchases. It makes no game-source changes. Earlier assisted-run results are not evidence that the same stages have been cleared with this roster.

## Campaign gates

| When | Real requirement | Preparation and validation |
| --- | --- | --- |
| Before stage 5, Pewter Gym | Brock dismisses the currently deployed player Pokémon for the last round. Those UIDs cannot be deployed again during that visit. | Have a captured or earned reserve. Recall the intended final-round counter before the wave-10 dismissal. A sole deployed starter is insufficient preparation. Check the actual `pewter-party-dismissed` event. |
| After stage 16, before Rock Tunnel 17 | Cut becomes teachable only after Diglett's Cave. Flash must first be earned on Route 2. Each teaching costs 10,000. | Reserve 20,000 earned Pokédollars. Teach Cut (224) to a compatible owned Pokémon, replay stage 3, deploy it at spot 3, and win without deploying Abra. Then teach Flash (225) and retain a Flash user in the active tunnel party. |
| Rock Tunnel 17 | Native room navigation, switches, encounters, and quest flags must progress through actual actions. | Keep the Flash carrier available. Record every returned room/stage transition and continue the actual quest; a single battle victory is not tunnel completion. |
| Stages 12 and 40 | These stages contain further native battle phases. | Follow the story runtime's returned `nextStage`. Count the main stage only when its whole phase chain finishes. |
| Stages 30, 33, and 41 | The stage additionally requires the player's party to survive. | An apparent candy-defense success can become a real loss when all party members faint. Judge the native finish event and keep sufficient living members. |
| Stage 36 | This is a story-only ending-runtime visit. | Execute its real dialogue/transition. The optional Slowbro trade is a separate collection objective. |
| Typed deployment slots | Suffixes such as `_grass`, `_rock`, `_water`, and `_flying` restrict placements by actual type. | Do not count rejected placements. Stage 20 and Challenge 6 have Grass slots alongside ordinary slots; this does not require the entire party to be Grass type. Challenge 4 includes one Rock slot. |

The underlying rules are in [stage-hooks.js](../src/stage-hooks.js), [rock-tunnel.js](../src/rock-tunnel.js), [battle.js](../src/battle.js), and the native stage/story data. `dismissPewterParty` removes only deployed player members from active slots and retains owned Pokémon in storage. `awardRoute2Flash` explicitly refuses the Flash reward if Abra was deployed, even if Cut opened the bush. No other mandatory field-move gate was found in the audited campaign code.

Bulbasaur and its evolutions can learn both Cut and Flash. Charmander's family can learn Cut but not Flash; Squirtle's family learns neither in this data. Other obtainable dual-purpose carriers include Beedrill, Oddish/Gloom, Paras, and Meowth. Pikachu is a Flash carrier, while common Rattata can carry Cut. Compatibility must be checked against the owned species' `tmMoveIds`; the bot must never substitute a fabricated move or eligibility flag.

## Challenges and a fresh-save proof

The UI unlocks challenges sequentially through `challengeCompleted`; it has no separate campaign-progress gate. [challenge-battle.js](../src/challenge-battle.js) constructs each temporary team and awards permanent rewards only on an actual win. Its temporary save intentionally shares the real money and achievement counters. Temporary captures and temporary training must not become permanent owned Pokémon.

| Challenge | Team source | Consequence for an earned-team run |
| --- | --- | --- |
| 1 | Five supplied level-6 Pokémon | Can be attempted immediately. First victory awards a permanent shiny level-1 Geodude. |
| 2 | Six supplied level-9 Pokémon; invasion controls; zero potions | Own roster strength is irrelevant. First victory awards the Old Rod. |
| 3 | Starts with an empty temporary team | Must catch the native initial shiny Geodude and build/train the temporary defense team through actual actions. Money earned and training costs persist. Completing it unlocks achievement reward claims. |
| 4 | The actual owned party | Needs a demonstrated earned-party victory. No level/type completion cap was found in the challenge data or party UI. |
| 5 | The actual owned party | Also needs a demonstrated earned-party victory. Avoiding move 36 and retaining multiple candies are achievement conditions, not prerequisites for ordinary challenge completion. |
| 6 | Six supplied level-47 Pokémon plus native NPCs | Own roster levels do not replace this team. First victory awards a permanent shiny level-1 Magnemite. The previous challenges must still be completed legitimately. |

A bounded fresh run performed Challenges 1–3 in order, starting with Bulbasaur level 5, 50 Pokédollars, no completed campaign stages, and no Center operations. It used the real intro/win runtime, battle controls, and policy. A second fresh process reproduced both the final-save hash and full action-stream hash exactly.

| Challenge | Battle seed | Native victory frame | Money before → after | Native earnings |
| --- | --- | --- | --- | --- |
| 1 | 2693262067 | 1005 | 50 → 50 | 0 |
| 2 | 11749833 | 670 | 50 → 50 | 0 |
| 3 | 2265367787 | 3717 | 50 → 160 | 1200 |

Challenge 3 made 46 actual temporary captures and spent 1,090 through native training/menu actions. The permanent roster remained Bulbasaur level 5 plus the earned shiny Geodude level 1. The final `challengeCompleted` value was 3. This validates only Challenges 1–3 for the fresh-save experiment; it does not stand in for all six or the full strict campaign.

Local diagnostic files are under `artifacts/bot/strict-story-audit/`: `verify-challenges.mjs`, `initial-save.json`, `final-save.json`, `challenge-report.json`, `challenge-actions.jsonl`, and `challenge-events.jsonl`. Run the saved diagnostic from the repository root with `node artifacts/bot/strict-story-audit/verify-challenges.mjs`.

```text
finalHash:  d29e26083df664232316b9c795e450a29e6cad9202fa317090eb61c05a0fa197
actionHash: ace8582ac087ae47cd6d6e8cfa1ceea8af4446445e6a9f94088d54fac126e0fb
```

## Training and capture priorities

These are source-based preparation choices, not promises that a particular low-level team wins every stage. Captures must come from actual spawned, catchable encounters; encounter-candidate metadata alone does not prove acquisition.

| Owned line | Useful native learnset milestones | Reason to retain it |
| --- | --- | --- |
| Bulbasaur | Leech Seed 7, Vine Whip 9, Sleep Powder **14**, Razor Leaf 19 | Early damage/control and a compatible Cut/Flash carrier. |
| Caterpie → Butterfree | Evolutions at 7 and 10; Butterfree Confusion at level 0, Sleep Powder 14, Psybeam 24 | Early control and Psychic damage. A move missing after evolution must be obtained through actual learning/relearning. |
| Pikachu | Thunder Wave 8, Thunderbolt 29 | Speed control, Electric damage, and Flash compatibility. |
| Geodude | Rock Throw 11, Magnitude 15, Graveler evolution 25 | An earned Challenge-1 option, useful type coverage, and a Rock-slot user. Avoid selecting Selfdestruct for routine survival/training work. |
| Drowzee | Confusion 9, Psybeam 25, Hypno evolution 26 | A naturally attacking Psychic option. |
| Abra | Only Teleport in Abra's native learnset | Do not expect a Teleport-only Abra to earn contributor XP by sitting in the party. It needs a real damaging move, or an actually reached evolution and appropriate move learning. Preserve a separate Abra for the Route-2 trade. |

Training in [model.js](../src/model.js) requires current contributor XP of at least `level³` and costs `5 × (level + 1)` Pokédollars for the next level. It resets that XP balance after training. Merely belonging to the party is not an XP contribution. Relearning costs 1,000 and TM teaching costs 10,000 in [profile-features.js](../src/profile-features.js); preserve the field-move reserve before spending.

Kadabra, Haunter, Graveler, and Machoke do not have ordinary next-level evolutions in the species data. Their final forms require the actual trade operation. This is separate from creating or adopting a new Pokémon.

## Optional story trades and earned reward routes

These conditions affect collection, not whether the campaign can normally continue.

| Result | Actual prerequisite |
| --- | --- |
| Mr. Mime 122 | Stage 3: deploy owned Abra 63 and a Cut user at spot 3, then complete the native trade. Keep this separate from the Flash-reward visit. |
| Jynx 124 | Stage 10: deploy owned Poliwhirl 61 and accept the native trade if its trade flag is unclaimed. |
| Farfetch'd 83 | Stage 14: deploy owned Spearow 21 and accept the unclaimed trade. |
| Lickitung 108 | Stage 36: keep owned Slowbro 80 in the saved party for the story-only trade. |
| Hitmonchan 107 | Earn Dojo achievement 6 by launching only level-70-or-lower attackers and stealing candy four first. After Challenge 3, call the real achievement claim operation. |
| Aerodactyl 142 | Stage 32 or 33: retain every candy, win, and process the native reward movie. The independent once-only flags are 29 and 34. |

Trade prerequisites refer to exact species, not their whole evolution lines. Required deployment UIDs and story choices must survive checkpoints. Disable automatic training/evolution during trade visits so the offered species cannot change before its dialogue condition is evaluated.

The Dojo achievement's `firstStolenCandy` uses `candy.id + 1`; candy four is native zero-based ID 3. Launching even one above-level-70 member invalidates that achievement for the visit. Three available claims do not alternate Hitmon species: [achievements.js](../src/achievements.js) awards Hitmonlee only if extra-info flag 30 already exists. Claims never create that flag. The only located producer is the inaccessible Dojo Hitmonlee-choice branch.

### Legendary birds

| Reward | Stage | Required full party at the native quest check | Once-only flags, normal/shiny/shadow |
| --- | --- | --- | --- |
| Zapdos 145 | 37 | Six Electric-type Pokémon, each exactly level 100 | 20 / 21 / 22 |
| Articuno 144 | 38 | Six Ice-type Pokémon, each exactly level 100 | 23 / 24 / 25 |
| Moltres 146 | 39 | Six Fire-type Pokémon, each exactly level 100 | 26 / 27 / 28 |

The native checks are `method_415`, `method_335`, and `method_390` in [waves-runtime.js](../src/waves-runtime.js). Repeated species are allowed, but they must be separately owned Pokémon. The ordinary runtime excludes `myTag === 'h'`. All six shiny members select the shiny reward; all six shadow members select shadow; every other mixture selects normal. Preserve the qualifying party through the battle and win story, since the reward movie evaluates its form again.

This spawns a native level-102 quest boss with tenfold base HP and `canCapture = false`. The player must **defeat** that boss and win. `Battle.defeat` propagates the real `var_695`, `var_676`, or `var_651` result into the win movie, whose controllers `class_1063`, `class_1008`, and `class_1053` create and record the level-1 reward. A displayed boss or a regular stage victory alone is insufficient evidence.

The new [strict-story.mjs](../tools/bot/strict-story.mjs) exports:

- `strictRewardEligibility(game, save)`: read-only Dojo and bird prerequisite status, selected existing UIDs, available forms, and existing candidates needing training to level 100.
- `nextStrictReward(game, save, attempts)`: a standard visit plan for eligible Dojo, Aerodactyl, or bird work, otherwise `null`. It uses `purpose: 'collection-strict-reward'`, retains actual team requirements, disables training/relearning/paid move preparation, and never claims or manufactures a reward.

Dojo plans use `partyOptions.maxLevel: 70` and `policyOptions.preferredCandyId: 3`. The latter requests a legal path toward that candy; only observed theft/achievement state can establish success. Bird plans require all six existing qualifying UIDs. The helper allows four attempts per unchanged Dojo/bird team, or four per Aerodactyl stage; these are bot retry limits, not game rules. Actual roster or move changes permit a new Dojo/bird attempt group. The caller must claim earned achievements through `claimAchievement`, and the final Pokédex must prove the species was obtained.

The five tests in [bot-strict-story.test.js](../tests/bot-strict-story.test.js) verify read-only behavior, exact-level/type/form prerequisites, the Dojo cap, and exhausted reward routes. Their explicit boundary fixtures are **unit-test data**, not evidence of earning six level-100 Pokémon. Run them with `node --test tests/bot-strict-story.test.js`.

## Current collection limits

The missing `var_334` producer still blocks the Dojo Hitmonlee choice and Omanyte/Kabuto choices in the production story runtime. See QA-005 in [BOT_BUG_FINDINGS.md](BOT_BUG_FINDINGS.md) for actual recorded-victory reproductions. Do not set that flag, directly call a hidden reward method, or silently switch to an excluded catalog service to fill those entries. Aerodactyl and the restricted Dojo achievement use separate implemented conditions.

Dratini is **not** Game Corner exclusive. A separate Safari table is selected for every seventh spawn; a native replay with seed 7 captured a level-25 Dratini through Joey's controls and won. The old candidate probe omitted this table. Its corrected evidence is `artifacts/bot/strict-collection-audit/dratini-safari-proof.json`. Porygon has no identified catchable/story ingress under the excluded-commerce rules; the peer collection audit records the remaining closure and catalog distinction.

Final strict verification still needs the actual complete earned-team campaign, Challenges 4–6 after real unlocks, and observed reward acquisitions. No earlier assisted completion count, metadata closure, or planner fixture should be promoted into that result.
