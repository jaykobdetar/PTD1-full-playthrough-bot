#!/usr/bin/env node
/** Replays a recorded player checkpoint with legal native controls. The six
 * recorded party members are intentionally retained to reproduce QA-004;
 * prepareParty's later three-member workaround is not called. No HP, XP,
 * currency, ownership, or completion fields are fabricated by this script. */
import {appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadGame, deterministicEnvironment, reserveIdentityRange, random, makeBattle, checkSave, digest} from './runtime.mjs';
import {createPolicy} from './policy.mjs';
import {resolveIntro, resolveWin} from './story.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--out')) throw new Error('Usage: node tools/bot/reproduce-xp-overflow.mjs [--out NEW_DIRECTORY]');
const out = resolve(args[1] ?? join(root, 'artifacts/bot/xp-overflow-repro'));
if (existsSync(out) && readdirSync(out).length) throw new Error(`Output directory must be new or empty: ${out}`);
mkdirSync(out, {recursive: true});
const checkpoint = JSON.parse(readFileSync(join(root, 'docs/bot-repros/xp-overflow/checkpoint.json'), 'utf8'));
const game = loadGame(), save = structuredClone(checkpoint.save);
const restore = deterministicEnvironment(1);
let battle;
try {
  reserveIdentityRange(game.data, [save]);
  checkSave(save, game.data);
  const initialSaveHash = digest(save);
  const level = game.variants.find(candidate => candidate.className === checkpoint.stage);
  if (!level) throw new Error(`Missing stage ${checkpoint.stage}`);
  let finish, firstOverflow, activeDefeat, sequence = 0;
  const actionPath = join(out, 'actions.jsonl'), eventPath = join(out, 'events.jsonl');
  writeFileSync(actionPath, ''); writeFileSync(eventPath, '');
  const action = row => appendFileSync(actionPath, JSON.stringify({sequence: ++sequence, frame: battle?.frame ?? 0, ...row}) + '\n');
  battle = makeBattle(game, level, save, {seed: checkpoint.seed, campaignId: checkpoint.campaignId, emit(type, event, engine) {
    if (type === 'finish') finish = event;
    if (['wave', 'spawn', 'faint', 'defeat', 'finish', 'warning', 'error'].includes(type)) {
      appendFileSync(eventPath, JSON.stringify({frame: engine.frame, type, wave: engine.currentWave,
        enemy: event.enemy ? {uid: event.enemy.uid, speciesId: event.enemy.speciesId, level: event.enemy.level} : undefined,
        won: event.won, message: event.message, error: event.error?.message}) + '\n');
    }
  }});
  // Read-only instrumentation delegates to both original operations unchanged.
  // Capture snapshots immediately: profiles remain mutable after this frame.
  const receiveExperience = battle.moveRuntime.receiveExperience;
  battle.moveRuntime.receiveExperience = (fighter, amount) => {
    const before = fighter.profile.experience;
    const result = receiveExperience(fighter, amount);
    const row = {uid: fighter.uid, level: fighter.level, amount, before, after: fighter.profile.experience};
    activeDefeat?.awards.push(row);
    if (!firstOverflow && row.after < 0) firstOverflow = structuredClone({...activeDefeat, firstInvalidAward: row});
    return result;
  };
  const defeat = battle.defeat.bind(battle);
  battle.defeat = enemy => {
    const contributors = battle.moveRuntime.experienceContributors(enemy) ?? [];
    activeDefeat = {frame: battle.frame, enemy: {uid: enemy.uid, speciesId: enemy.speciesId, level: enemy.level,
      baseExperience: enemy.original.base_Experience ?? game.data.species[enemy.speciesId].baseExperience},
    bonusLevel: level.bonusLevel, contributorActors: contributors.length,
    uniqueContributorUids: [...new Set(contributors.map(fighter => fighter.uid))],
    contributors: contributors.map(fighter => ({uid: fighter.uid, level: fighter.level})), awards: []};
    try { return defeat(enemy); } finally { activeDefeat = null; }
  };
  const intro = resolveIntro(game.data, level, save, battle, {rng: random(checkpoint.seed ^ 0x71337)});
  for (const row of intro.actions ?? []) action({type: 'story', phase: 'intro', ...row});
  for (const row of intro.inputs ?? []) action({type: 'story-input', phase: 'intro', ...row});
  const policy = createPolicy(battle, {...checkpoint.policyOptions, onAction: action});
  policy.prepare();
  if (!battle.start()) throw new Error('Recorded party could not start the native battle');
  for (let tick = 0; ['running', 'paused'].includes(battle.state) && tick < 100000; tick++) {
    policy.step();
    if (battle.state === 'paused') battle.togglePause();
    battle.tick();
  }
  if (battle.state === 'won') {
    const win = resolveWin(game.data, level, save, battle, finish, {rng: random(checkpoint.seed ^ 0x21942)});
    for (const row of win.actions ?? []) action({type: 'story', phase: 'win', ...row});
    for (const row of win.inputs ?? []) action({type: 'story-input', phase: 'win', ...row});
  }
  let validationError = null;
  try { checkSave(save, game.data); } catch (error) { validationError = error.message; }
  const invalidProfiles = save.pokemon.filter(profile => profile.experience < 0)
    .map(({uid, speciesId, level, experience}) => ({uid, speciesId, level, experience}));
  const result = {reproduced: Boolean(firstOverflow && validationError), fixtureOnly: false,
    sourceCheckpoint: 'docs/bot-repros/xp-overflow/checkpoint.json', stage: checkpoint.stage, seed: checkpoint.seed,
    initialSaveHash, initialParty: checkpoint.save.party, firstOverflow,
    finalState: battle.state, finalFrame: battle.frame, invalidProfiles, validationError, actions: sequence,
    actionHash: digest(readFileSync(actionPath, 'utf8'))};
  writeFileSync(join(out, 'evidence.json'), JSON.stringify(result, null, 2) + '\n');
  writeFileSync(join(out, 'final-save.json'), JSON.stringify(save, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.reproduced ? 0 : 2;
} finally {
  battle?.dispose();
  restore();
}
