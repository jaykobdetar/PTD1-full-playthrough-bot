> Historical pre-fix audit. On 2026-09-09 the original ActionScript was located locally: `var_334` marks the first clear of Dojo/Fuchsia/Cinnabar stages. The port now restores that gate. The five previously blocked species have earned routes again, subject to actually playing the relevant profiles and selecting both reward branches. This does not establish a completed bot run.

# Collection audit for starter-and-capture progression

This audit applies to the requested run that starts with one level-5 starter and earns its team through captures, training, evolution, story rewards and legitimate trades. It excludes Center adoptions, high-level loans, mystery gifts, free daily currency and, for the closure calculation below, all Game Corner rewards. Evolution stones bought with earned money remain ordinary progression. It supersedes the earlier broad [content audit](BOT_COMPLETION_AUDIT.md) where that audit treated Center purchases as available routes.

**The inspected source identifies routes to 145 of the 151 species under this policy.** Porygon has an ordinary paid Game Corner route; Hitmonlee and both fossil families depend on story reward branches that are inaccessible in the current runtime. This is a source-route closure, not a claim that a fresh strict run has obtained 145 species. The calculation includes capture candidates and demanding earned rewards whose complete strict strategies still need to succeed. It concerns the union of normal, shiny and shadow dex entries, not all 453 form entries.

## Evidence and the Safari correction

The updated [encounter candidates](BOT_ENCOUNTER_CANDIDATES.json) contain 99 potentially capturable species. The initial metadata sweep covered `getProfile(0, roll)` and missed the Safari's separate `getProfile(1, ...)` schedule. All four special tables were inspected in both versions and added to the manifest:

| Safari visit table | Species | Level | Example wave seed | Native capture permission |
| --- | --- | --- | --- | --- |
| 1 | Dratini, 147 | 25 | 7 | `true` |
| 2 | Slowpoke, 79 | 25 | 12 | `true` |
| 3 | Psyduck, 54 | 25 | 1 | `true` |
| 4 | Krabby, 98 | 25 | 4 | `true` |

These are naturally scheduled encounters, not rod rewards or injected profiles. `class_39.do_Wave` calls `create_Poke_Profile(1)` every seventh spawn; its visit table is chosen by the wave's seeded random stream. Neither version is excluded. The profile defaults to capturable and these branches never disable it. See [wave defaults](../src/waves-runtime.js#L12), [special table selection](../src/waves-runtime.js#L4687), [actual spawn schedule](../src/waves-runtime.js#L4720) and [Dratini profile](../src/waves-runtime.js#L4867).

A real replay of an already unlocked archival Safari checkpoint with seed 7 produced 59 level-25 Dratini. Temporary Joey actually captured one at frame 562 with 5/55 HP, and the visit won at frame 16,403. This used the native capture gate and did not add levels, resources, party members or completion flags. The result proves this capture route; it does not prove the preceding strict campaign. [Dratini gameplay evidence](../artifacts/bot/strict-collection-audit/dratini-safari-proof.json) records the capture, spawn examples, action hash and final save hash. The [eight special-table metadata probes](../artifacts/bot/strict-collection-audit/safari-special-tables.json) are separately labeled.

Dratini therefore needs no Game Corner exception. Its normal level-30 and level-55 evolutions provide Dragonair and Dragonite through earned training. The earlier apparent nine-species gap reduces to six.

## Remaining ingress gaps

| Species | Current source route | Why it is unavailable under the strict policy | Classification |
| --- | --- | --- | --- |
| 106 Hitmonlee | Level-1 Dojo choice, stage 26 | Choice is behind `var_334`; no production setter exists. Fresh Dojo achievement claims give Hitmonchan instead. | Unreachable earned reward branch |
| 137 Porygon | Level-1 Game Corner reward `corner-5`, 5,500 coins | Paid Pokémon rewards were excluded from this audit's policy. Its Rocket Hideout actor explicitly cannot be caught. | Ordinary earned-commerce route, not a game defect |
| 138 Omanyte | Level-1 fossil choice, stage 32 or 33 | Both choices are behind the same unset `var_334`. No wild base-species factory exists. | Unreachable earned reward branch |
| 139 Omastar | Train Omanyte to 40 | No available predecessor; its Cinnabar enemy is a noncapturable trainer actor. | Consequence of the fossil reward blocker |
| 140 Kabuto | Level-1 fossil choice, stage 32 or 33 | Both choices are behind the same unset `var_334`. No wild base-species factory exists. | Unreachable earned reward branch |
| 141 Kabutops | Train Kabuto to 40 | No available predecessor; its Cinnabar enemy is a noncapturable trainer actor. | Consequence of the fossil reward blocker |

The missing-reward issue is already recorded as [QA-005](BOT_BUG_FINDINGS.md#qa-005--dojo-and-fossil-reward-choices-have-no-eligibility-producer-in-the-native-runtime), including successful native battle replays and the actual visible win controls. The source contains four reads of `var_334` and no assignment; the story timeline data also contains no producer. The [stage proxy](../src/story-runtime.js#L75) returns `false` for an absent `var_*` value. The [Dojo initializer](../src/story-data-controllers.js#L5719) consequently skips its choice, as do the fossil initializers at [Cinnabar Island](../src/story-data-controllers.js#L2904) and [Cinnabar Gym](../src/story-data-controllers.js#L11076). The intended original eligibility rule remains unknown. A bot must not fabricate this flag or infer that every victory should grant a choice.

The Dojo achievement is not a route around Hitmonlee's blocker. [Claiming achievement 6](../src/achievements.js#L24) selects Hitmonlee only when `originalExtraInfo` already contains 30. The sole source producer of 30 is the inaccessible [Hitmonlee choice handler](../src/story-data-controllers.js#L5770). Otherwise the claim gives Hitmonchan and only increments the achievement counter; it never sets 30. Repeating a claim or creating another fresh profile therefore does not produce Hitmonlee.

The encounter check included every literal profile assignment for these six species in wave scripts and level factories, both versions' Safari branches, stage and challenge reward sources, evolution edges, Center catalogs, and multiplayer's temporary teams. The [negative encounter probes](../artifacts/bot/strict-collection-audit/noncapturable-gap-encounters.json) confirm `canCapture:false` for Rocket Hideout Porygon (level 53), Cinnabar Omastar/Kabutops (level 91), and Elite 4 Hitmonlee (level 102). The respective source gates are [Rocket Hideout](../src/waves-runtime.js#L2935), [Cinnabar](../src/waves-runtime.js#L6892), and [Elite 4](../src/waves-runtime.js#L11907). Dojo NPCs belong to invasion mode, whose [capture API is disabled](../src/reverse-battle.js#L121). Multiplayer Hitmons belong to [temporary teams](../src/local-multiplayer.js#L5), not the saved collection, and multiplayer capture is disabled. These actors must not become false capture candidates.

## Smallest ordinary earned-commerce exception

If the policy permits the game's regular Game Corner rewards bought with battle earnings, only **one guaranteed purchase is necessary for a species with no identified earned story/capture route: Porygon `corner-5`, 5,500 Casino Coins, level 1**. It knows Tackle and Conversion. [The catalog](../src/center-catalog.js#L247) specifies its cost and level; the regular reward has a 1% shiny chance, which still supplies the species for union dex coverage.

The native [`exchangeCoins`](../src/center-model.js#L124) action charges actual profile money and gives Casino Coins 1:1. [`buyReward`](../src/center-model.js#L153) charges the wallet and places the created reward in the inbox; the ordinary claim action then takes ownership. These actions require an existing profile and sufficient funds, with no badge, level or campaign gate. No daily claim, adoption, mystery gift or high-level donor is needed. An allowlist limited to `corner-5`, exchange of earned money, and the resulting inbox claim would cover this exception precisely. It would raise the source closure to 146, leaving five entries affected by the Hitmon/fossil reward defect.

Game Corner also offers a level-1 shiny egg for 200,000 coins (`corner-13`) and a shadow egg for 400,000 (`corner-14`). The [implemented pool](../src/center-model.js#L142) contains unevolved species through 151, including Hitmonlee, Omanyte and Kabuto. Paid eggs could bypass those missing base rewards if separately allowed, but their outcomes are random and duplicates consume the full price. Obtaining three different required bases requires at least three shiny eggs (600,000 coins) and has no finite guaranteed purchase count. This is an optional paid fallback, not proof that the broken story choices work and not part of the strict closure above.

## Actual partner progression required

Version is selected at profile creation. No supported existing-profile version switch was found. Trades must move actually owned Pokémon; creating a profile does not earn its starter's evolved forms. A default Red primary therefore needs a Blue partner to reach **stage 32**, not merely stage 11:

| Partner version | Required bases for the other version | Earliest candidate stage | Earned family completion |
| --- | --- | --- | --- |
| Blue | Sandshrew | 8 | Train to Sandslash at 22 |
| Blue | Vulpix | 9 | Use a bought Fire Stone for Ninetales |
| Blue | Bellsprout | 9 | Train to Weepinbell at 21, then Leaf Stone for Victreebel |
| Blue | Pinsir | 29, Safari | Capture with temporary Joey |
| Blue | Magmar | 32, Cinnabar Island | Capture |
| Red | Ekans | 8 | Train to Arbok at 22 |
| Red | Oddish | 9 | Train to Gloom at 21, then Leaf Stone for Vileplume |
| Red | Growlithe | 9 | Use a bought Fire Stone for Arcanine |
| Red | Scyther | 29, Safari | Capture with temporary Joey |
| Red | Electabuzz | 37, Power Plant | Capture |

A Blue primary instead needs a Red partner through stage 37. Candidate levels and version metadata are in the encounter manifest; the required campaigns must still be played and the desired Pokémon actually caught. The version-exclusive direct encounters for Kingler and Seadra add no extra trade requirement: both versions can catch and evolve their respective Krabby and Horsea predecessors.

The other two starter families require two genuine new profiles choosing the other level-5 starters, legitimate transfers, and earned training: Bulbasaur 16/32, Charmander 16/36, and Squirtle 16/36. One of those partners can also handle the opposite-version campaign. When free currency is prohibited, the third profile needs no badge grind merely to transfer its own starter. Each auxiliary campaign must begin from its own starter under the strict run's provenance rules; an earlier assisted save or primary high-level loan cannot supply its team.

Kadabra, Machoke, Graveler and Haunter evolve through actual local trades into Alakazam, Machamp, Golem and Gengar. Story trades require the real prerequisites and visible acceptance: deployed Abra plus the opened Cut bush at Route 2 (3) for Mr. Mime; deployed Poliwhirl at stage 10 for Jynx; deployed Spearow at stage 14 for Farfetch'd; saved-party Slowbro in the story-only stage 36 for Lickitung. Retain enough Eevee to perform all three stone branches. Recorded dex history legitimately survives transfers, evolution and ordinary releases.

## Earned routes that remain demanding

Hitmonchan is obtainable without commerce by actually earning the Dojo achievement: every launched attacker must be level 70 or below and candy four must be stolen first. [Native launch eligibility](../src/reverse-battle.js#L216), [candy order](../src/reverse-battle.js#L256), and [victory award](../src/reverse-battle.js#L348) produce the achievement; Challenge 3 must be completed before the level-1 shiny reward can be claimed.

Aerodactyl has a separate working source route: finish stage 32 with every candy retained and unclaimed extra-info 29, or stage 33 with every candy retained and unclaimed 34. The [native victory hook](../src/stage-hooks.js#L31) supplies `var_556`; the win controller grants the level-1 reward through that branch even while `var_334` remains false. Merely winning after losing candy does not qualify.

The birds require six actual level-100 party entries, each with the required type and no hacked tag. Duplicate species are permitted; duplicate ownership identifiers are not. Stage 37 requires Electric (type 11) for Zapdos; stage 38 requires Ice (type 12) for Articuno; stage 39 requires Fire (type 4) for Moltres. [Electric eligibility](../src/waves-runtime.js#L10216), [Ice eligibility](../src/waves-runtime.js#L3499) and [Fire eligibility](../src/waves-runtime.js#L8991) select the summons. All-six shiny or all-six shadow determines that form; other valid combinations produce the normal form. The actual native summoned bird must be defeated, its [defeat fact](../src/battle.js#L617) recorded, and the win story completed. Per-form flags 20–22, 23–25 and 26–28 prevent repeated grants. These are expensive earned training goals, not content impossibilities or justification for a fabricated level-100 party.

Mew and Mewtwo have wild capture candidates at stage 42. Earlier native collection replays demonstrated weakening and captures; a fresh strict run must earn its own catcher and repeat those actions. They are not the noncapturable bird/trainer actors described above.

## Verification boundary

The [machine-readable closure](../artifacts/bot/strict-collection-audit/route-closure.json) lists all 151 species, one identified route or the precise missing ingress, and the hashes of source files used. Starting from 99 capture candidates, adding three actual starter bases, four story trades, Hitmonchan, Aerodactyl and the three birds, then iterating the original evolution and four trade-evolution edges yields 145 species. The unresolved IDs are exactly `[106,137,138,139,140,141]`.

A subsequent strict report must state what actually succeeded, separately from this feasibility model. Preserve failed visits, earned resources, original partner progress, actual capture/trade/evolution actions and final missing dex IDs. If available content has been fully recorded while source blockers remain, use a recording status such as `recorded-with-blockers` with `gameComplete:false`; successful video coverage must never be presented as 151-species game completion.
