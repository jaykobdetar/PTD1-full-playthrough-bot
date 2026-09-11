# Bot reporting findings

## REPORT-001 — Earlier attempt summaries retained a mutable moves array

During independent video auditing, an archived assisted report's early party summary disagreed with its observed replay descriptor. A later paid move lesson had appeared retroactively in an earlier attempt's `party[].moves`. The runner had stored `moves:p.moves`, preserving a reference to the live Pokémon's array; a later lesson could mutate that array after the attempt completed.

This affected historical report metadata, not the saved battle checkpoint or native gameplay. The observed replay descriptors preserved the moves seen at the corresponding visit. Their final save hashes, native statistics and all per-visit replay checks still matched. An independent audit must report this difference, compare the remaining immutable attempt fields, and use the recorded checkpoint and replay verification as the evidence for the actual party state; it must not silently rewrite the old artifact.

The current [runner snapshot](../tools/bot/run.mjs#L127) copies the move array with `moves:[...p.moves]`, so later learning cannot alter a new attempt's saved summary. Future strict reports must use that snapshot behavior. The archived assisted run remains distinct from the requested starter-and-capture run, and its successful video smoke test is not a strict-playthrough deliverable.
