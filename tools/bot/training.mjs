import { xpRequired, levelCost } from '../../src/model.js';
import { recordOwned } from '../../src/profile-features.js';
import { createBattlePokemonCheck } from '../../src/original-battle-ui.js';

function attackScore(data, profile, moveId) {
  const move = data.moves[moveId];
  // Sending a target back out before downstream support defeats it earns no XP.
  if (!move || move.onSelf || [ 'Teleport', 'Roar', 'Whirlwind', 'Dragon Tail', 'Circle Throw', 'Selfdestruct', 'Self-Destruct', 'Explosion', 'Curse', 'Dream Eater', 'DreamEater', 'Nightmare', 'Double-Edge', 'Take Down', 'Brave Bird', 'Flare Blitz', 'Wild Charge', 'Submission'].includes(move.name)) return -1;
  const power = Number(move.power) || 0;
  const stats = data.species[profile.speciesId].stats;
  return (power || 20) * (move.accuracy ?? 100) / Math.max(1, move.cooldownFrames ?? 18)
    * (move.physical ? stats.attack : stats.specialAttack) * (power ? 1 : 0.2);
}

/** Path order is used only to choose legal spots, never to move an enemy. */
export function trainingSpots(battle, trainee, carry) {
  const path = battle.level.paths.p ?? Object.values(battle.level.paths)[0];
  const samples = [];
  let travelled = 0;
  for (let index = 1; index < (path?.length ?? 0); index++) {
    const a = path[index - 1], b = path[index], distance = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(distance / 15));
    for (let step = 0; step <= steps; step++) samples.push({ x: a.x + (b.x - a.x) * step / steps, y: a.y + (b.y - a.y) * step / steps, distance: travelled + distance * step / steps });
    travelled += distance;
  }
  const coverage = battle.level.spots.map(spot => {
    const covered = samples.filter(point => Math.abs(point.x - spot.x) <= 140 && Math.abs(point.y - spot.y) <= 130);
    return { spot, first: covered[0]?.distance ?? Infinity, last: covered.at(-1)?.distance ?? -Infinity };
  }).filter(row => Number.isFinite(row.first));
  const forward = coverage.filter(row => battle.isSpotEligible(trainee, row.spot.index)).sort((a, b) => a.first - b.first || a.spot.index - b.spot.index)[0];
  if (!forward) return null;
  const downstream = coverage.filter(row => row.spot.index !== forward.spot.index && battle.isSpotEligible(carry, row.spot.index))
    .sort((a, b) => {
      const score = row => row.first >= forward.last + 100 ? row.first : travelled + (forward.last - row.first);
      return score(a) - score(b) || a.spot.index - b.spot.index;
    })[0];
  return downstream ? { trainee: forward.spot.index, carry: downstream.spot.index, traineeFirst: forward.first, traineeLast: forward.last, carryFirst: downstream.first } : null;
}

/** Contributor training uses the original battle and Pokémon-menu controls.
 * High-level support waits downstream, after the trainee's first attack area.
 * One trainee is prioritized per visit; party membership alone earns no XP.
 */
export function createTrainingPolicy(battle, { trainingUids = [], onAction = () => {}, targetLevel = 100 } = {}) {
  const data = battle.data;
  const trainee = trainingUids.map(uid => battle.partyMembers.find(profile => profile.uid === uid)).find(Boolean);
  if (!trainee) throw new Error('Training policy needs a trainee in the current party.');
  const bestMove = profile => [...profile.moves].sort((a, b) => attackScore(data, profile, b) - attackScore(data, profile, a) || a - b)[0];
  const supportScore = profile => profile.level * attackScore(data, profile, bestMove(profile)) * ([65, 6, 94, 26, 131].includes(profile.speciesId) ? 4 : 1);
  const carry = battle.partyMembers.filter(profile => profile.uid !== trainee.uid).sort((a, b) => supportScore(b) - supportScore(a) || a.uid.localeCompare(b.uid))[0];
  if (!carry) throw new Error('Training policy needs a support Pokémon in the current party.');
  if (battle.level.mode !== 'defense' || !battle.moveRuntime) throw new Error('Contributor training requires a native defense battle.');
  const spots = trainingSpots(battle, trainee, carry);
  if (!spots) throw new Error('This map has no suitable legal training/support spots.');
  const summary = { traineeUid: trainee.uid, initialSpecies: trainee.speciesId, initialLevel: trainee.level, initialXP: trainee.experience,
    carryUid: carry.uid, spots, actions: 0, trained: 0, evolved: 0, cost: 0, xpEarned: 0, finalLevel: trainee.level, finalSpecies: trainee.speciesId };
  let prepared = false, lastXP = trainee.experience;
  const log = (action, detail = {}) => { summary.actions++; onAction({ frame: battle.frame, action, ...detail }); };
  const actorFor = profile => battle.towers.find(tower => tower.uid === profile.uid);
  function chooseMove(profile) {
    const id = bestMove(profile), actor = actorFor(profile);
    if (attackScore(data, profile, id) < 0 || id === profile.selectedMove) return;
    if (battle.state === 'running' && actor?.alive && !actor.recalled) {
      const menu = createBattlePokemonCheck(data, battle, actor);
      if (!menu.ok) return;
      menu.chooseMove(profile.moves.indexOf(id) + 1); menu.close();
    } else { profile.selectedMove = id; battle.syncPokemon(profile); }
    if (profile.selectedMove === id) log('select-move', { uid: profile.uid, moveId: id, move: data.moves[id].name });
  }
  function train() {
    const actor = actorFor(trainee);
    if (!actor?.alive || !actor.placed || actor.recalled || trainee.level >= targetLevel || trainee.level >= 100
      || trainee.experience < xpRequired(trainee.level) || battle.save.money < levelCost(trainee.level)) return;
    const before = { level: trainee.level, speciesId: trainee.speciesId, money: battle.save.money };
    const menu = createBattlePokemonCheck(data, battle, actor, { campaignSave: battle.campaignSave ?? battle.save });
    if (!menu.ok) return;
    if (!menu.train()) { menu.close(); return; }
    let replaced = false;
    for (let frame = 0; frame < 1200 && !menu.closed; frame++) {
      menu.tick();
      const label = menu.clip.actual?.currentLabel ?? menu.clip.currentLabel;
      if (menu.phase === 'trying' && label === 'end_trying_learn_move') menu.click('learn_butt');
      else if (menu.phase === 'replace' && label === 'end_replace_move') {
        if (!replaced) {
          const slot = trainee.moves.map((id, index) => ({ index, score: attackScore(data, trainee, id) })).sort((a, b) => a.score - b.score || a.index - b.index)[0].index;
          menu.click(`actual.change_Move_screen.attack_${slot + 1}`); replaced = true;
        }
        menu.click('actual.done_butt');
      } else if (['end_learn_move', 'done_evolving'].includes(label)) menu.click();
    }
    if (!menu.closed) { menu.close(); throw new Error('Training Pokémon menu exceeded its animation budget.'); }
    if (trainee.level !== before.level) {
      summary.trained++; summary.cost += before.money - battle.save.money;
      log('train', { uid: trainee.uid, from: before.level, to: trainee.level, cost: before.money - battle.save.money });
    }
    if (trainee.speciesId !== before.speciesId) {
      summary.evolved++; recordOwned(battle.campaignSave ?? battle.save, trainee);
      log('evolve', { uid: trainee.uid, from: before.speciesId, to: trainee.speciesId });
    }
    summary.finalLevel = trainee.level; summary.finalSpecies = trainee.speciesId;
    lastXP = trainee.experience;
    chooseMove(trainee);
  }
  function place(profile, index) {
    const actor = actorFor(profile);
    if (actor?.placed && actor.spotIndex === index || actor && !actor.alive) return;
    const success = battle.state === 'ready' ? battle.place(profile.uid, index)
      : battle.state === 'running' && battle.beginTowerDrag(profile.uid) && battle.endTowerDrag(profile.uid, index)?.placed;
    if (success) log('place', { uid: profile.uid, spotIndex: index, role: profile === trainee ? 'trainee' : 'support' });
  }
  function prepare() {
    if (prepared) return summary;
    prepared = true;
    chooseMove(trainee); chooseMove(carry);
    place(trainee, spots.trainee); place(carry, spots.carry);
    log('training-route', { traineeUid: trainee.uid, carryUid: carry.uid, ...spots });
    return summary;
  }
  function step() {
    if (!prepared) prepare();
    if (battle.state !== 'running') return;
    if (trainee.experience > lastXP) {
      const amount = trainee.experience - lastXP;
      summary.xpEarned += amount;
      log('contributor-xp', { uid: trainee.uid, amount, level: trainee.level, experience: trainee.experience });
    }
    lastXP = trainee.experience;
    train();
    for (const profile of [trainee, carry]) {
      const actor = actorFor(profile);
      if (actor?.alive && actor.placed && actor.hp / actor.maxHp < 0.6 && battle.usePotion(profile.uid)) log('potion', { uid: profile.uid, remaining: battle.potions });
    }
    for (const tower of battle.towers.filter(tower => tower.placed && !tower.npc && ![trainee.uid, carry.uid].includes(tower.uid))) {
      if (battle.recall(tower.uid)) log('recall', { uid: tower.uid, reason: 'Keep trainee ahead of downstream support.' });
    }
  }
  return { prepare, step, summary };
}
