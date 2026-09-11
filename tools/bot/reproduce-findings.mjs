#!/usr/bin/env node
/** Isolated diagnostic fixtures, NOT a playthrough or a completion runner.
 * Fixtures deliberately set boundary HP / quest prerequisites to test native
 * rule callbacks. They never alter a user save, engine source, or run report.
 */
import { readFileSync, existsSync } from 'node:fs';
import { loadGame, ROOT } from './runtime.mjs';
import { newSave, makePokemon, validateSave } from '../../src/model.js';
import { createMoveRuntime } from '../../src/move-native.js';
import { stageWinAchievements } from '../../src/stage-hooks.js';
import { StoryRuntime } from '../../src/story-runtime.js';
import { RockTunnel } from '../../src/rock-tunnel.js';

const game = loadGame(), { data } = game;
const findStage = id => [...game.levels, ...game.variants].find(level => level.id === id);

function falseSwipe(initialLife) {
  const fighter = (speciesId, team, x, uid, move) => ({
    speciesId, team, x, y: 100, level: 30, hp: 2000, maxHp: 2000,
    moves: [move], selectedMove: move, uid, cooldown: 0, alive: true, placed: true,
    modifiers: {}, effects: {}, attackers: new Set(), direction: 'front', point: 1,
    spotIndex: team === 'tower' ? 0 : null, path: [],
  });
  const source = fighter(83, 'tower', 100, 'source', 273), target = fighter(19, 'enemy', 180, 'target', 1);
  const battle = { data, rng: () => 0.5, towers: [source], enemies: [target],
    level: { spots: [{ index: 0, x: 100, y: 100 }], paths: {} }, candies: [],
    save: { party: ['source'], pokemon: [source], money: 0 },
    emit() {}, defeat(fighter) { fighter.alive = false; },
  };
  const runtime = createMoveRuntime(battle, { timelines: data.timelines });
  const attack = runtime.actor(source).myAttack, victim = runtime.actor(target);
  const calculatedDamage = attack.method_3(victim, attack.get_Move_Power());
  target.hp = initialLife === 'equal' ? calculatedDamage : initialLife === 'overkill' ? calculatedDamage - 1 : 1;
  const before = target.hp;
  runtime.attack(source, [target]);
  for (let frame = 0; frame < 200; frame++) { runtime.tickFighter(target); runtime.tickWorld(); }
  const result = { case: initialLife, calculatedDamage, lifeBefore: before, lifeAfter: target.hp, alive: target.alive };
  runtime.dispose();
  return result;
}

function cerulean(eligible, allCandy = true) {
  const awarded = [];
  stageWinAchievements({ level: { className: 'level_10' },
    stageHooks: { achievementEligible: eligible, usedGrassOrElectric: false },
    candies: [{ state: allCandy ? 'ground' : 'lost' }],
    awardAchievement(id) { awarded.push(id); },
  });
  return { levelAtMost30: eligible, allCandy, usedGrassOrElectric: false, awarded };
}

function storyRng() {
  const original = Math.random, save = newSave(data, 1), level = findStage('class_954');
  let completion;
  try {
    Math.random = () => 0.99;
    const runtime = new StoryRuntime(data, { timelines: data.timelines, save, level, rng: () => 0.1,
      onComplete: result => { completion = result; },
    }).open(level.introPopup);
    for (let frame = 0; frame < 10000 && !runtime.closed; frame++) {
      runtime.tick();
      if (frame % 5) continue;
      const controls = runtime.controls;
      const button = controls.find(control => /^butt_(next|end|start|close)$/.test(control.name))
        ?? controls.find(control => control.name === 'btn_left');
      if (button) runtime.click(button.clip);
    }
    return { suppliedRoll: 0.1, globalRoll: 0.99, expectedWaveClass: 'class_23',
      actualWaveClass: completion?.args?.[2]?.sourceClass, closed: runtime.closed };
  } finally { Math.random = original; }
}

function tunnelDex() {
  const save = newSave(data, 25);
  save.pokemon[0].level = 42;
  save.pokemon[0].moves = [225];
  save.pokemon[0].selectedMove = 225;
  const electrode = makePokemon(data, 101, 42);
  save.pokemon.push(electrode); save.party[1] = electrode.uid;
  save.originalExtraInfo = [32];
  const tunnel = new RockTunnel(data, save, { seed: 1, session: { pikachuCaptures: 10 } });
  tunnel.enter();
  const result = tunnel.choose('check-quest');
  return { received: result.reward.received, rewardSpecies: result.reward.profile?.speciesId,
    rewardShiny: result.reward.profile?.shiny, inCollection: save.pokemon.some(p => p.speciesId === 100 && p.shiny === 1),
    inDexBeforeReload: save.dex.shiny.includes(100), inDexAfterReload: validateSave(save, data).dex.shiny.includes(100) };
}

function differences(a, b, path = '', found = []) {
  if (JSON.stringify(a) === JSON.stringify(b)) return found;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) differences(a[key], b[key], `${path}/${key}`, found);
  } else found.push({ path, before: a, after: b });
  return found;
}

const calibration = ['full-calibration-1', 'full-calibration-2'].map(name => {
  const folder = `${ROOT}/artifacts/bot/${name}`;
  if (!existsSync(`${folder}/report.json`)) return { name, unavailable: true };
  const read = file => JSON.parse(readFileSync(`${folder}/${file}`, 'utf8'));
  const report = read('report.json'), save = read('final-save.json'), bank = read('final-bank.json');
  const events = readFileSync(`${folder}/events.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const normalize = validateSave(save, data);
  const changes = differences(save, normalize);
  return { name, attempts: report.attempts.length, eventCount: events.length,
    runtimeWarnings: events.filter(event => event.type === 'warning').length,
    runtimeErrors: events.filter(event => event.type === 'error').length,
    issueKinds: report.issues.map(issue => issue.kind),
    normalizationChanges: changes.length,
    onlyBenignNormalization: changes.every(change => /^\/pokemon\/\d+\/(nickname|myTag)$/.test(change.path)
      || change.path === '/haveFlash' && Boolean(change.before) === change.after),
    identicalDexSpeciesSets: ['normal', 'shiny', 'shadow'].every(form => JSON.stringify([...save.dex[form]].sort((a, b) => a - b)) === JSON.stringify([...bank.slots[0].dex[form]].sort((a, b) => a - b))),
  };
});

console.log(JSON.stringify({ fixtureOnly: true, falseSwipe: ['equal', 'overkill', 'one-hp'].map(falseSwipe),
  cerulean: [cerulean(true), cerulean(false), cerulean(true, false)], storyRng: storyRng(), tunnelDex: tunnelDex(), calibration }, null, 2));
