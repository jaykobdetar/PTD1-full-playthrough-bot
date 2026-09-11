# Earned Aerodactyl strategy evidence

This is a recorded continuation of genuinely earned primary-profile progress, deliberately skipping auxiliary profiles to isolate the remaining collection strategy. It is not a fresh all-game completion or video proof.

The first visit won stage 32 with all eight candies at frame 7800, seed 814657751. The native win scene awarded species 142 (`dexGained`); no candy or reward flag was assigned by the bot. The team consisted of earned Mewtwo, Alakazam, Mew, Lapras, Golem and Raichu. Moves and levels are preserved in `result.json` and the pre-battle `checkpoint.json`.

Earlier attempts with weaker teams lost candy. The bot now defers this optional reward until Mewtwo and Mew are caught, uses those earned defenders, prioritizes candy carriers and retries within a bounded budget. This is a bot strategy change, not a production game patch. Exact replay needs the recorded source/policy fingerprint; this archive preserves the original observation independently of ignored artifacts.
