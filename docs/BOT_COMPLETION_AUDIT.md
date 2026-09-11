# Deterministic completion content audit

Audited commit: `2f73d0c8588e52a8c0c53ee1485a289c34e2962b`.

This is a source and content feasibility audit. It does **not** assert that the bot has won these battles. No game rules or saves were changed by this audit. The companion [completion manifest](BOT_COMPLETION_MANIFEST.json) describes coverage; [encounter candidates](BOT_ENCOUNTER_CANDIDATES.json) records profile-factory metadata probes, not gameplay results.

## Completion boundaries

There are 42 campaign selections, six challenges, and 32 variant definitions: 23 campaign variants, six challenge variants, and three multiplayer variants. A successful run must report campaign selections and their phases separately. Multiplayer is a separate optional coverage bucket; it is not a campaign level or challenge.

The collection UI has 151 species and independent normal, shiny, and shadow flags. Report both the union of owned species and each form count. “151 species caught” and “453 species/form entries caught” must not be conflated. The source collection UI does not expose a single win flag for Pokédex completion. Native collection access requires Challenge 3 (`src/original-profile-ui.js:204`), and Center dex history is shared across local profiles (`src/center-model.js:28–41`). Capturing, evolving, trading, and later releasing a Pokémon retains its recorded dex entry.

No species-level impossibility was found in this static audit. Campaign encounters plus evolutions, story trades/rewards, and the Game Corner provide candidate routes to all 151 species. This does not establish that every required battle or capture strategy works. Full form completion adds a large currency/replay requirement; Center conversions and purchases provide routes without requiring real calendar advancement.

## Campaign inventory

Waves below are authored entry-stage counts, not the total across chained phases.

| ID | Display name in level metadata | Mode | Waves |
| --- | --- | --- | --- |
| 1 | Oak's Lab | defense | 5 |
| 2 | Route 1 | defense | 6 |
| 3 | Route 2 | defense | 4 |
| 4 | Viridian Forest 1 | defense | 10 |
| 5 | Pewter Gym | defense | 10 |
| 6 | Route 3 | defense | 30 |
| 7 | Viridian Forest 2 | defense | 30 |
| 8 | Mt. Moon 1 | defense | 9 |
| 9 | Mt. Moon 2 | defense | 30 |
| 10 | Cerulean Gym 1 | defense | 20 |
| 11 | Cerulean Gym 2 | defense | 1 |
| 12 | Route 24 | defense | 1 |
| 13 | Route 5 | defense | 45 |
| 14 | Vermillion City | defense | 15 |
| 15 | Vermillion Gym | defense | 40 |
| 16 | Diglett's Cave | defense | 25 |
| 17 | Rock Tunnel | branch | 0 |
| 18 | Lavender Town | defense | 8 |
| 19 | Route 8 | defense | 45 |
| 20 | Celadon Gym | defense | 16 |
| 21 | Rocket Hideout | defense | 47 |
| 22 | Poke Tower 1 | defense | 30 |
| 23 | Poke Tower 2 | defense | 10 |
| 24 | Route 12 | defense | 45 |
| 25 | Saffron City | defense | 7 |
| 26 | Saffron Dojo | invasion | 1 |
| 27 | Route 15 | defense | 60 |
| 28 | Fuchsia Gym | defense | 9 |
| 29 | Safari Zone | safari | 60 |
| 30 | Route 17 | defense | 10 |
| 31 | Route 19 | defense | 60 |
| 32 | Cinnabar Island | defense | 30 |
| 33 | Cinnabar Gym | defense | 10 |
| 34 | Pallet Town | defense | 60 |
| 35 | Viridian City | defense | 8 |
| 36 | Viridian Ending | story | 0 |
| 37 | Power Plant | defense | 30 |
| 38 | Seafoam Island | defense | 30 |
| 39 | Victory Road | defense | 30 |
| 40 | Elite 4 | defense | 4 |
| 41 | Champion | defense | 6 |
| 42 | Unknown Dungeon | defense | 40 |

### Chained and special stages

- Route 24 has ten alternating phases: `12 → class_1115 → class_957 → class_1116 → class_960 → class_1117 → class_962 → class_1119 → class_965 → class_1120`. Keep campaign ID 12 throughout; finish only after the last phase.
- Elite 4 has four phases: `40 → class_953 → class_955 → class_958`. Preserve campaign ID 40 explicitly: some source metadata has `progressionId:39` and the name “Victory Road.” The app retains its entry campaign ID across variants (`src/main.js:390–402`). Completing `class_958` without that context can record the wrong stage in a standalone harness.
- Rock Tunnel (17) uses `RockTunnel`, not a generic battle completion. Entry requires Flash in the active party. Its ten rooms include three wild rooms, trainers, two invasions, and a secret trainer. Only leaving the exit completes campaign stage 17 (`src/rock-tunnel.js:313`). See the manifest for all room definitions. A short successful route is room `1 → 2 → 3 → 4 → 6 → exit`. That route does **not** cover every room or secret.
- For all Tunnel encounters, fight the room 1 wild encounter first; then visit `2 → 3 → 5 → 7 → 8 → 9 → 10 → 6 → 4 → 3 → 5 → 7 → 8 → 9 → 10 → 6 → exit`. Each `encounter` state requires choosing `battle` and resolving an actual win; room 9 fights only after flags 0–6 are all set. Wild room 5/7 encounters can repeat. The secret encounter enables extra-info flag 32.
- Flash route: after winning Diglett’s Cave (16), spend 10,000 to teach Cut (224), replay Route 2 (3), place its user in spot 3, never deploy Abra in that visit, and win. Run the app-equivalent `awardRoute2Flash` finish hook. Spend another 10,000 to teach Flash (225); retain its user in the active party (`src/rock-tunnel.js:418–474`, `src/stage-hooks.js:73`).
- Saffron Dojo (26) is an invasion: launch attackers and steal four candies. The Dojo achievement requires level ≤70 attackers and stealing candy 4 first.
- Safari Zone (29) substitutes Joey, a temporary actor with Bait (398) and Rock (397). Its 60-wave encounter schedule is normal runtime content, but its temporary party is not a collectible Pokémon (`src/safari-battle.js`). Capture via the actual weakened-enemy gate; never add Joey to the saved collection.
- Viridian Ending (36) is story only. Use `EndingStory` or the actual recovered popup runtime: acknowledge intro to unlock 37, resolve the optional Slowbro→Lickitung trade, and close the ending to receive badge 8 (`src/ending-story.js`). A generic empty-wave loop cannot complete it.
- Pewter Gym removes deployed members from party slots late in its script. Retain ownership in storage and reselect the party after the stage (`src/stage-hooks.js:318`).
- Full battle behavior requires `data.timelines` / `options.timelines`. `Battle` otherwise takes its alternate move implementation. That mode must be disclosed in results and cannot stand in for native gameplay fidelity (`src/battle.js:49–55`).

## Challenges

| Challenge | Definition | Mode/waves | Party | First completion |
| --- | --- | --- | --- | --- |
| 1 | `class_951` | Defense, 1 | Forced level 6 Rattata, Metapod, Pidgey, Kakuna, Charmander | Shiny Geodude |
| 2 | `class_949` | Invasion, 1 | Forced level 9 Jigglypuff, Clefairy, Geodude, Pidgey, Pikachu, Charmander; no potions | Old Rod, inventory item 6 |
| 3 | `class_950` | Defense, 20 | Starts empty; capture the first shiny Geodude and deploy it | Achievement reward and collection access |
| 4 | `class_928` | Defense, 9 | Player collection | Progress to Challenge 5 |
| 5 | `class_910` | Defense, 40 | Player collection | Two optional achievements |
| 6 | `class_952` | Defense, 16 | Forced level 47 Charizard, Mr. Mime, Venusaur, Fearow, Tangela, Vileplume | Shiny Magnemite |

Challenge IDs unlock in order. `challengeCompleted` reaches six, and first-time rewards have claim keys preventing duplication (`src/challenge-battle.js:19–27`). Temporary challenge captures and training are temporary; money and achievement counters remain shared with the campaign profile. The manifest contains each forced moveset. Preserve and validate the campaign collection when leaving a temporary party.

## Acquisition and evolution routes

The candidate encounter probe called the game's existing profile factories with parameter rolls 1–1000, seeds 1–12, both Red/Blue versions, and Tunnel wild tables. It found 98 capturable species. A factory result is only a route candidate: the seed/roll shown is from a sequence of probe calls and is **not** a promised natural battle spawn seed. The real bot must encounter, weaken, and capture the creature and record its action evidence.

- Create three local profiles using Bulbasaur, Charmander, and Squirtle to cover starters legitimately. Use at least one Red and one Blue profile for version-specific wild tables. Account dex synchronization and local trading can consolidate progress.
- Wild capture uses `Battle.canCapture`: normal enemies must reach ≤20% HP; shiny/shadow enemies can be captured immediately if `canCapture` permits it. Trainer and legendary encounter actors can be explicitly uncatchable. Captures call `recordOwned` and `recordTunnelSessionCapture` through the app event handler (`src/battle.js:534`, `src/main.js:482–485`). A headless adapter must preserve these event side effects.
- Train with actual XP and money using `trainPokemon`, then call normal evolution actions. Each level consumes `(level + 1) × 5` money and requires `level³` XP, resetting XP after training. Most evolutions are level-based. Every evolution edge is in the manifest, copied from `game-data.json`.
- Moon Stone: Nidorina, Nidorino, Clefairy, Jigglypuff. Leaf Stone: Gloom, Weepinbell, Exeggcute. Thunder Stone: Pikachu, Eevee. Water Stone: Poliwhirl, Shellder, Staryu, Eevee. Fire Stone: Vulpix, Growlithe, Eevee. Each stone costs 10,000. Keep three Eevee for its branches; record pre-evolution entries first.
- Kadabra→Alakazam, Machoke→Machamp, Graveler→Golem, and Haunter→Gengar use local two-profile trading. These are explicit trade rules, not entries in the species evolution arrays (`src/profile-features.js:102–117`).
- Story trades cover Abra→Mr. Mime, Poliwhirl→Jynx, Spearow→Farfetch’d, and Slowbro→Lickitung. Use the original popup action and its saved-party/deployed-party prerequisite, not direct species mutation. The original trade can preserve a Pokémon’s shiny/shadow form.
- Story rewards include Hitmonlee or Hitmonchan, fossils, Aerodactyl, and the legendary birds. Cinnabar Island (32) has regular fossil/reward logic; Cinnabar Gym (33) has shiny equivalents. Preserve and execute win popups: winning the combat alone does not grant these creatures (`src/story-data-controllers.js:2900–3034`, `11081–11205`).
- For legendary-bird encounter/reward branches, Power Plant (37) requires six level-100 Electric party members; Seafoam Island (38) six level-100 Ice members; Victory Road (39) six level-100 Fire members. Shiny/shadow party composition selects reward form, and extra-info flags prevent repeated reward forms. Defeat the legendary and process the win popup (`src/waves-runtime.js`, `src/battle.js:617`, original popup controllers `class_1063`, `class_1008`, `class_1053`). The ordinary level can finish without triggering this branch.
- Unknown Dungeon (42 / `class_51`) has three randomly selected visit tables. Table 3 includes Mewtwo for rolls 991–995 and Mew for 996–1000; Mew is explicitly normal. There is no need to invent a Mew acquisition restriction from the adoption catalog, which lists only shiny/shadow Mew (`src/waves-runtime.js:7548–7859`).
- Game Corner supplies normal Porygon (`corner-5`, 5,500 coins) and Dratini (`corner-6`, 6,500 coins). Dratini evolves at 30 and Dragonair at 55. The metadata probe plus evolution/story sources leaves just these four species unaccounted for; these purchases close that candidate-route gap. Game Corner's “regular” Pokémon has a 1% shiny chance, so verify the returned form before asserting normal-only collection completion.

### Center commerce is gameplay

A new profile can claim 10 free credits and 500 Casino Coins, once per day, with another five credits per badge on its first applicable claim. Its `battle-*` adoption catalog sells level-90 normal Pokémon for one credit each, including many strong attackers. This permits a deterministic legal startup team without editing XP or money. Call the transaction service and collect inbox entries; there is no need to simulate a purchase by inserting profiles.

Earned money exchanges 1:1 into Casino Coins. Regular→shiny conversion costs 750,000 coins or 10 credits; regular→shadow costs 1,500,000 coins or 10 credits. Game Corner eggs contain random unevolved shiny/shadow species. Daily/weekly mystery gifts contain random shiny/shadow species from #1–151. These routes have different costs/cooldowns and must be reported accurately (`src/center-model.js:123–185`, `src/center-catalog.js`). A fixed clock is useful to make a test reproducible; advancing it to collect more daily rewards is a test fixture, not ordinary same-day play.

## Achievements and audit findings

There are 14 achievement records. Achievement 1 is four independent encounter flags 100–103 for shiny Rattata, Pidgey, Geodude, Zubat. Rewards unlock after Challenge 3; most records support three claims, while achievements 4/5 support one. Earned, claimed, and claim count should be reported separately (`src/achievements.js`).

Two source-level issues were reproduced by calling `stageWinAchievements` with minimal battle fixtures; they are not claims of a completed gameplay reproduction:

1. **AUDIT-001 — Cerulean's overlapping achievements suppress a valid reward.** A victory at stage 10 with all candies, level ≤30, and no Grass/Electric deployment awards achievement 8 but fails to award achievement 3 because its check is an `else if` (`src/stage-hooks.js:22–23`). Reproduction returned `[8]`. Workaround: replay with no Grass/Electric and a deployed Pokémon above level 30, or with a lost candy. Expected from descriptions: both achievements qualify on the initial victory. This is not a total-completion blocker because the replay route exists.
2. **AUDIT-002 — Saffron/Fuchsia names disagree across content.** `stageWinAchievements` awards “Fuchsia Gym” achievement 11 at stage 25, whose level metadata calls it “Saffron City.” It awards “Saffron Gym” achievement 12 at stage 28, whose metadata calls it “Fuchsia Gym” (`src/stage-hooks.js:6–24`, `src/achievements.js:14–15`, `public/data/levels.json`). Fixture outputs confirmed the mapping. The correct remediation requires comparing original UI labels; do not silently remap the game during bot development.

Other completion risks above are content requirements or adapter obligations, not confirmed game bugs. In particular, metadata phase IDs, rare encounter tables, daily cooldowns, and separate dex forms should not be logged as failures merely because a generic loop omitted their required action.

## Evidence requirements for the run

Record root campaign ID, exact stage class, challenge ID, seed, selected game version, native/fallback engine, party species/levels/moves, attempted action, return result, logical frame, emitted warnings/errors, result, and save digest at each stage boundary. Save a replayable action log and a reproduction summary for every failure. Failed strategies and timeouts must remain distinct from runtime exceptions and confirmed rule/content defects.

Do not call `finish(true)`, `defeat(enemy)`, overwrite HP, grant money/XP, inject capture profiles, or prefill completed/dex flags to turn a coverage probe into a purported playthrough. Such operations can support separately labeled fixtures, while the completion claim must depend on actual game actions and verified save progression.

## Implemented planner interface

`tools/bot/collection.mjs` exports `createCollectionPlanner(data, save, options)` and the read-only `bestNextVisit(game, save, attempts, options)`. The planner exposes async `prepare()` / `step()`, `targets()`, `bestNextVisit(game, attempts)`, and a `bank` checkpoint getter. Preserve `bank` across resume: it includes actual daily claim timestamps, wallets, all three profiles, and the latest live primary battle save.

The next-visit result supplies `level`, `campaignId`, `purpose`, `targetSpecies`, `partyOptions`, and `policyOptions`. A capture visit sets `{collection: true, captureUid, targetSpecies}` and uses the policy's False Swipe capture behavior. An XP visit selects the actual owned Pokémon whose evolution is missing and requests contributor XP; it does not grant XP itself. The route score considers current version, unlocked/completed stages, missing encounters, repeated fruitless visits, and evolution inventory. It requests replacement Eevee or other predecessors when a branching evolution consumed the last owned copy, even if the base dex flag already exists.

There is no existing-profile Red/Blue setting action in the inspected UI or Center service. Version is selected during profile creation / `popups_Tutorial_party` (`src/story-data-controllers.js:11923`). The planner therefore never changes `gameVersion` to bypass an encounter restriction. It can obtain opposite-version species through real purchases/gifts or a separately progressed auxiliary profile.

Fresh preparation retains a level-90 Scyther; collection setup purchases one if resuming an older prepared bank without it, and relearns False Swipe (273) through the game's paid move action. That Normal-type move cannot hit Ghosts. A missing Gastly receives early priority for the one-credit shiny adoption route, after which ordinary training can produce Haunter. Gengar is already a strong starter adoption. Native False Swipe source (`class_553`, `src/move-source-generated.js:31255`) clamps damage only when it is greater than current HP; exact-lethal damage and overlapping delayed strikes merit gameplay observation rather than a blanket assertion that it can never faint a target.

Collection commerce prioritizes the capture specialist, Gastly, the three legendary birds, and difficult story-reward gaps before common evolved species. It claims at most the currently available daily/weekly Mystery Gifts per profile and never rerolls a claim. Missing species unavailable through the current version or current evolution inventory can receive bounded paid Shiny Egg purchases (default one per `step`, 200,000 coins each). The full purchase is applied, including duplicate outcomes. A 20,000 money reserve is protected until Rock Tunnel is completed, allowing Cut and Flash costs; after that, earned money can fund dex purchases and evolution stones.

`auxiliaryPlan({excludeSlots})` returns `{slot, version, through, targetSpecies, reason}` when an existing auxiliary can cover early version exclusives or earn its first two badges before claiming daily credits. `await withAuxiliary(slot, callback, {neededSpecies})` loans six actually owned Pokémon using `createListing → recallListing → claim({slot})`. Its callback receives the genuine auxiliary save plus `{slot, neededSpecies, through:11, loanUids, captureUid, checkpoint}`. The runner plays that save normally; `checkpoint()` includes its current live progress. On completion the planner saves auxiliary progress, returns the borrowed team and new target captures through the same Center actions, and restores the primary party. The result includes `acquired`, returned UIDs, and the callback's result for report provenance. It returns loans even if the callback throws. No primary version, level flags, XP, money, or captured profiles are synthesized, and the auxiliary profile retains its own earned campaign progress.

Both auxiliary daily claims are deferred until they have actually earned two badges, producing twenty credits each on that day's first claim. The second badge is assigned by `class_1034.remove_Me` after stage **11**, not stage 10 (`src/story-data-controllers.js:2685`); a completed stage-10 save still has one badge. The original primary's ten-credit starting-team claim remains unchanged. Normal Pinsir costs 2,500 Game Corner coins and Aerodactyl has a one-credit battle adoption, so forty auxiliary credits suffice for the birds and the four five-credit Hitmon/fossil base species, with the normal coin purchase performed before scarce-credit spending. Existing checkpoints that already claimed a daily reward keep that history and cannot claim later badge bonuses on the same day.

The duplicate-release pass keeps two best individuals per species/form, three Eevee per form, the selected party, and field/capture/identification specialists. Each removal calls the ordinary `releasePokemon` action and preserves recorded Pokédex history. Contributor training requests one actual predecessor per visit and uses the native battle menu. Route 11 (19) places that trainee before its downstream support, allowing it to earn XP from its attacks. Dragonair can legally relearn Slam/Twister because Dragon Tail can keep targets away from the defeating support actor.

Route 12 (23) needs care: its giant Snorlax is explicitly uncatchable. A separate level-40 Snorlax has only a 1/1000 side-spawn chance, with about 18 opportunities per visit (`class_42`). The planner prefers the one-credit Snorlax adoption and includes the species in paid-egg fallback when that credit was spent in an older checkpoint. It does not repeatedly attack the giant and report those visits as evidence that capture is impossible.
