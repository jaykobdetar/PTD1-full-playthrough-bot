#!/usr/bin/env node
/** Recorded native victories and their actual exposed reward controls.
 * No synthetic eligibility flags or completion/HP/XP changes are made. */
import {appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadGame, deterministicEnvironment, reserveIdentityRange, random, makeBattle, checkSave, digest} from './runtime.mjs';
import {prepareParty, createPolicy} from './policy.mjs';
import {resolveIntro, resolveWin} from './story.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url)), args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--out')) throw new Error('Usage: node tools/bot/reproduce-story-rewards.mjs [--out NEW_DIRECTORY]');
const out = resolve(args[1] ?? join(root, 'artifacts/bot/story-rewards-repro'));
if (existsSync(out) && readdirSync(out).length) throw new Error(`Output directory must be new or empty: ${out}`);
mkdirSync(out, {recursive: true});
const archive = join(root, 'docs/bot-repros/story-rewards');
const cases = JSON.parse(readFileSync(join(archive, 'cases.json'), 'utf8'));
const game = loadGame(), restore = deterministicEnvironment(1), observations = [];
try {
  for (const entry of cases) {
    const checkpoint = JSON.parse(readFileSync(join(archive, entry.checkpoint), 'utf8'));
    const save = structuredClone(checkpoint.save), level = game.levels.find(level => level.className === checkpoint.stage);
    if (!level) throw new Error(`Missing stage ${checkpoint.stage}`);
    checkSave(save, game.data); reserveIdentityRange(game.data, [save]);
    const before = new Set(save.pokemon.map(profile => profile.uid));
    const actionsPath = join(out, `${entry.id}-actions.jsonl`), eventsPath = join(out, `${entry.id}-events.jsonl`);
    writeFileSync(actionsPath, ''); writeFileSync(eventsPath, '');
    let finish, battle, sequence = 0;
    const action = row => appendFileSync(actionsPath, JSON.stringify({sequence: ++sequence, frame: battle?.frame ?? 0, ...row}) + '\n');
    prepareParty(game.data, save, level, {...checkpoint.partyOptions, onAction: action});
    try {
      battle = makeBattle(game, level, save, {seed: checkpoint.seed, campaignId: checkpoint.campaignId, emit(type, event, engine) {
        if (type === 'finish') finish = event;
        if (['wave', 'spawn', 'capture', 'faint', 'finish', 'warning', 'error'].includes(type)) {
          appendFileSync(eventsPath, JSON.stringify({frame: engine.frame, type, wave: engine.currentWave,
            enemy: event.enemy ? {uid: event.enemy.uid, speciesId: event.enemy.speciesId, level: event.enemy.level} : undefined,
            won: event.won, message: event.message, error: event.error?.message}) + '\n');
        }
      }});
      const intro = resolveIntro(game.data, level, save, battle, {rng: random(checkpoint.seed ^ 0x71337)});
      for (const row of intro.inputs ?? []) action({type: 'story-input', phase: 'intro', ...row});
      const policy = createPolicy(battle, {...checkpoint.policyOptions, onAction: action});
      policy.prepare();
      if (!battle.start()) throw new Error(`No legal deployment for ${level.className}`);
      for (let tick = 0; ['running', 'paused'].includes(battle.state) && tick < 100000; tick++) {
        policy.step(); if (battle.state === 'paused') battle.togglePause(); battle.tick();
      }
      const controls = new Set(), observedFlags = new Set();
      let win = null;
      const beforePopup = new Set(save.pokemon.map(profile => profile.uid));
      if (finish?.won) {
        win = resolveWin(game.data, level, save, battle, finish, {rng: random(checkpoint.seed ^ 0x21942), chooseControl({runtime, controls: exposed}) {
          exposed.forEach(control => controls.add(control.name));
          observedFlags.add(JSON.stringify({var334: runtime.stage.var_334, var556: runtime.stage.var_556}));
          // No override: the ordinary story policy chooses an exposed control.
        }});
        for (const row of win.actions ?? []) action({type: 'story', phase: 'win', ...row});
        for (const row of win.inputs ?? []) action({type: 'story-input', phase: 'win', ...row});
      }
      checkSave(save, game.data);
      observations.push({case: entry.id, sourceCheckpoint: entry.source, stage: checkpoint.stage, seed: checkpoint.seed,
        nativeState: battle.state, frame: battle.frame, candy: battle.remainingCandy, stageFacts: battle.stageFacts,
        exposedWinControls: [...controls], observedFlags: [...observedFlags].map(text => JSON.parse(text)),
        popupRewards: save.pokemon.filter(profile => !beforePopup.has(profile.uid)).map(({uid, speciesId, shiny}) => ({uid, speciesId, shiny})),
        totalNewPokemon: save.pokemon.filter(profile => !before.has(profile.uid)).length,
        winInputs: win?.inputs ?? [], actionHash: digest(readFileSync(actionsPath, 'utf8'))});
      writeFileSync(join(out, `${entry.id}-final-save.json`), JSON.stringify(save, null, 2) + '\n');
    } finally { battle?.dispose(); }
  }
  const choiceButtons = new Set(['butt_hitmonlee', 'butt_hitmonchan', 'butt_kabuto', 'butt_omanyte']);
  const result = {fixtureOnly: false, reproducedMissingChoice: observations.every(row => row.nativeState === 'won'
    && row.observedFlags.every(flags => flags.var334 === false) && !row.exposedWinControls.some(name => choiceButtons.has(name))),
  limitation: 'These are observed victories without offered choice rewards. Cinnabar candy loss correctly disqualifies its separate Aerodactyl reward; the original intended var_334 eligibility is not established by this replay.', observations};
  writeFileSync(join(out, 'evidence.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.reproducedMissingChoice ? 0 : 2;
} finally { restore(); }
