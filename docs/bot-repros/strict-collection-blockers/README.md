# Fresh strict collection blockers and recovery

These are **bot strategy defects**, separate from the nine production game fixes. The fresh `strict-final` run completed 42 campaign entries, all 23 extra phases, and six challenges, but stopped at 149 species after 3,753 visits. It recorded no runtime/save errors. The two remaining species were Mr. Mime and Aerodactyl.

## Abra evolved before the Mr. Mime trade

In stage 3 attempts 901 and 903, `bestNextVisit` selected a real owned Abra for the native trade. `prepareParty` then evolved the eligible Abra into Kadabra before its deployment. The stage won, but the required species was no longer present and no Mr. Mime was awarded. The planner consumed both story attempts.

Trade visits now disable paid party preparation, which includes the general automatic evolution pass. The original Pokémon is deployed and the native trade scene executes normally. A regression starts with an evolution-eligible level-17 Abra, prepares the actual planned party, and verifies it remains Abra with its Cut partner present. Ordinary in-battle training/relearning are already disabled for these visits.

## Aerodactyl chose an untrained evolved entry

The perfect-defense plan used fixed species preferences. This run's Alakazam was level 20 and Lapras level 40, while Kadabra was level 89 and Dewgong level 100. The chosen team's ordinary wins lost candy and did not earn Aerodactyl. An earlier resumed diagnostic had high-level Alakazam and Lapras, which concealed this weakness.

The plan now selects the strongest owned Psychic defender from Kadabra/Alakazam and Ice defender from Dewgong/Lapras before party preparation. It continues to require earned Mewtwo/Mew and an actual all-candy win. A regression verifies the strong owned alternatives are selected. Strict mode no longer uses the older generic Aerodactyl fallback before the dedicated defense is ready.

## Recorded recovery

`strict-recovery-1` resumed the actual valid final save and bank. Its first visit won stage 32 and earned Aerodactyl. Its second visit completed the stage-3 trade and earned Mr. Mime, reaching 151/151 with no errors. Both attempts and their exact seeds, party, native outcomes and acquired species are retained in `cases.json`.

This recovery proves the corrections against the failed run's earned state. It is not a replacement for the independent fresh run or exact video replay verification. Original checkpoints are retained with SHA-256 hashes; exact replay requires their recorded source and policy fingerprint.
