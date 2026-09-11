/** Deterministic, observable-state player. Every mutation goes through a game
 * control/model action; this module never awards wins or fabricates resources. */
import { effectiveness, xpRequired, levelCost, trainPokemon, evolvePokemon } from '../../src/model.js';
import { recordOwned, teachMove, buyItem, useEvolutionItem, releasePokemon } from '../../src/profile-features.js';
import { moveStorageParty } from '../../src/original-profile-ui.js';
import { createTrainingPolicy } from './training.mjs';
import { createSafariPolicy } from './safari-policy.mjs';
import { createBattlePokemonCheck } from '../../src/original-battle-ui.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const key = b => b.level.className ?? `level_${b.level.id}`;
const stable = p => `${String(p.speciesId).padStart(4, '0')}:${p.uid}`;
const statusValue = { 'String Shot': 20, 'Sleep Powder': 30, 'Stun Spore': 22, 'Thunder Wave': 23, Sing: 20, 'Poison Powder': 15, Toxic: 20, 'Leech Seed': 20, Whirlwind: 24, Roar: 24, 'Sand Attack': 9, Growl: 7, 'Tail Whip': 9, Leer: 9, 'Toxic Spikes': 14 };
const selfHealing = new Set(['Synthesis', 'Roost', 'Moonlight', 'Recover', 'Rest', 'Soft-Boiled', 'Milk Drink']);
const utilityMoves = new Set([23, 26, 36, 83, 101, 224, 225, 227, 273]);
const stageControlMoves = { class_960: [26], class_956: [36], class_966: [36, 36], class_968: [36, 36] };
const badDamage = new Set([ 'Self-Destruct', 'Selfdestruct', 'Explosion', 'Fissure', 'Guillotine', 'Horn Drill', 'Sheer Cold']);

export function moveScore(data, profile, moveId, targets = []) {
  const move = data.moves[moveId];
  if (!move) return -1000;
  if (badDamage.has(move.name)) return -5;
  if (['Nightmare', 'Dream Eater', 'DreamEater'].includes(move.name) && !targets.some(t => t.effects?.sleep)) return 0;
  if (['Snore', 'Sleep Talk'].includes(move.name)) return 0;
  if (selfHealing.has(move.name)) return 0;
  const species = data.species[profile.speciesId];
  const power = Number(move.power) || 0;
  if (!power) return statusValue[move.name] ?? (move.name === 'Rock' ? 50 : 0);
  const stat = species.stats[move.physical ? 'attack' : 'specialAttack'] || 40;
  let score = power * (0.5 + stat / 100) * (species.typeIds.includes(move.typeId) ? 1.5 : 1)
    * ((move.accuracy ?? 100) / 100) / Math.max(18, move.cooldownFrames ?? 36) * 18;
  if (!move.singleTarget) score *= Math.min(3, 1.6 + targets.length * 0.15);
  if (targets.length) score *= targets.reduce((n, target) => n + effectiveness(data, move.typeId,
    target.typeIds ?? data.species[target.speciesId].typeIds), 0) / targets.length;
  if (['Future Sight', 'Doom Desire'].includes(move.name)) score *= 0.4;
  // The native Earthquake damages allied towers across the map as well.
  // Its raw area damage overvalues a move that repeatedly defeats the team.
  if (move.name === 'Earthquake') score *= 0.15;
  // These source moves apply one lasting effect; their metadata power is not
  // dealt again on every attack cooldown. Prefer direct attacks once learned.
  if (['Poison Powder', 'Toxic', 'Leech Seed'].includes(move.name)) score *= 0.3;
  if (['Double-Edge', 'Flare Blitz', 'Take Down', 'Wild Charge', 'Brave Bird', 'Submission'].includes(move.name)) score *= 0.6;
  if (['Petal Dance', 'Thrash', 'Outrage'].includes(move.name)) score *= 0.2;
  if (['Hyper Beam', 'Solar Beam', 'SolarBeam', 'Sky Attack', 'Skull Bash', 'Razor Wind', 'Focus Punch'].includes(move.name)) score *= 0.45;
  return score;
}

export function pokemonScore(data, profile) {
  const moves = Math.max(1, ...profile.moves.map(id => moveScore(data, profile, id)));
  const s = data.species[profile.speciesId].stats;
  return profile.level * (2 + Math.sqrt(moves)) + (s.hp + s.defense + s.specialDefense) * 0.1;
}

/** Storage party selection uses the same exported drop action as the UI. */
export function prepareParty(data, save, level, { onAction = () => {}, preferredSpecies = [], requiredUids = [], excludeSpecies = [], maxLevel = 100, paidMoves = true, extraMoves = [] } = {}) {
  const partyLimit = level.className === 'class_953' ? 3 : 6;
  if (!preferredSpecies.length && level.className === 'class_953') preferredSpecies = [65, 34, 94];
  if (!preferredSpecies.length && level.id === 25) preferredSpecies = [59,6,38,94,93,65,64,123,26];
  if (!preferredSpecies.length && level.id === 33) preferredSpecies = [139, 141, 131, 76, 34, 94];
  if (level.temporaryParty || level.mode === 'safari') return { party: [...save.party], temporary: true };
  // Auxiliary profiles do not have a collection planner between battles.
  // Make room using the ordinary release operation before storage fills up.
  if (save.pokemon.length>1000) {
    const keep=new Set(save.party.filter(Boolean)),groups=new Map();
    for(const p of save.pokemon){const k=`${p.speciesId}:${p.shiny}`;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(p);}
    for(const group of groups.values()){
      group.sort((a,b)=>b.level-a.level||b.experience-a.experience||stable(a).localeCompare(stable(b)));
      for(const p of [...group.slice(0,6),group.at(-1)])keep.add(p.uid);
    }
    for(const move of [224,225,273,227,102]){
      const p=save.pokemon.filter(p=>p.moves.includes(move)).sort((a,b)=>b.level-a.level||stable(a).localeCompare(stable(b)))[0];
      if(p)keep.add(p.uid);
    }
    const released=[];
    for(const p of [...save.pokemon])if(!keep.has(p.uid)&&releasePokemon(save,p.uid).ok)released.push(p.uid);
    if(released.length)onAction({action:'release-collection-duplicates',released,count:released.length,retained:save.pokemon.length});
  }
  // Develop the strongest caught representative of each species before party
  // ranking. A caught Abra otherwise has only Teleport and is never selected.
  if (paidMoves) {
    const representatives=new Map();
    for (const p of save.pokemon) if (!representatives.has(p.speciesId)||representatives.get(p.speciesId).level<p.level) representatives.set(p.speciesId,p);
    for (const p of representatives.values()) {
      while (data.species[p.speciesId].evolutions.some(e=>e.level&&e.level<=p.level)) {
        const from=p.speciesId;if(!evolvePokemon(p,data))break;
        recordOwned(save,p);onAction({action:'evolve',uid:p.uid,from,to:p.speciesId});
      }
      if(level.id===25&&[64,65].includes(p.speciesId)&&!p.moves.includes(308)&&save.money>=20000){
        const slot=p.moves.map((id,i)=>({i,score:utilityMoves.has(id)?Infinity:moveScore(data,p,id)})).sort((a,b)=>a.score-b.score||a.i-b.i)[0].i;
        const result=teachMove(data,save,p,308,slot,'tm');if(result.ok)onAction({action:'learn-move',uid:p.uid,moveId:308,cost:result.cost});
      }
      const stone=data.species[p.speciesId].evolutions.find(e=>e.itemId);
      if (stone&&p.level>=35&&save.money>=30000&&!save.pokemon.some(q=>q.speciesId===stone.to)&&p.speciesId!==133) {
        if (!save.inventory?.[stone.itemId]) {const result=buyItem(save,stone.itemId);if(result.ok)onAction({action:'buy-item',itemId:stone.itemId,cost:result.item.price});}
        const from=p.speciesId,result=useEvolutionItem(data,save,p,stone.itemId);
        if(result.ok)onAction({action:'evolve-item',uid:p.uid,from,to:p.speciesId,itemId:stone.itemId});
      }
      {
        const best=data.species[p.speciesId].learnset.filter(m=>m.level<=p.level&&!p.moves.includes(m.moveId))
          .sort((a,b)=>moveScore(data,p,b.moveId)-moveScore(data,p,a.moveId)||a.moveId-b.moveId)[0];
        if (best && moveScore(data,p,best.moveId)>Math.max(1,...p.moves.map(id=>moveScore(data,p,id)))*1.25 && save.money>=5000) {
          const slot=p.moves.map((id,i)=>({i,score:utilityMoves.has(id)?Infinity:moveScore(data,p,id)})).sort((a,b)=>a.score-b.score||a.i-b.i)[0].i;
          const result=teachMove(data,save,p,best.moveId,slot,'relearn');
          if(result.ok)onAction({action:'learn-move',uid:p.uid,moveId:best.moveId,cost:result.cost});
        }
      }
    }
  }
  const candidates = save.pokemon.filter(p => p.level <= maxLevel && !excludeSpecies.includes(p.speciesId)).sort((a, b) => pokemonScore(data, b) - pokemonScore(data, a) || stable(a).localeCompare(stable(b)));
  const chosenControllers = new Set();
  for (const controlMove of stageControlMoves[level.className] ?? []) {
    const support = [...candidates].filter(p => !chosenControllers.has(p.uid) && (p.moves.includes(controlMove) || data.species[p.speciesId].learnset.some(move => move.moveId === controlMove && move.level <= p.level) || data.species[p.speciesId].tmMoveIds.includes(controlMove)))
      .sort((a, b) => ((controlMove===36||level.id===25)?0:Number(b.moves.includes(controlMove))-Number(a.moves.includes(controlMove))) || ((controlMove===36||level.id===25)?-1:1)*(pokemonScore(data, a) - pokemonScore(data, b)) || stable(a).localeCompare(stable(b)))[0];
    if (support) {
      if (paidMoves && !support.moves.includes(controlMove)) {
        const slot = support.moves.map((id, i) => ({ i, score: utilityMoves.has(id) ? Infinity : moveScore(data, support, id) })).sort((a, b) => a.score - b.score || a.i - b.i)[0].i;
        const source = data.species[support.speciesId].learnset.some(move => move.moveId === controlMove && move.level <= support.level) ? 'relearn' : 'tm';
        const result = teachMove(data, save, support, controlMove, slot, source);
        if (result.ok) onAction({ action: 'learn-move', uid: support.uid, moveId: controlMove, cost: result.cost });
      }
      if (support.moves.includes(controlMove)) {
        support.target = 'fastest';
        requiredUids = [...requiredUids, support.uid];
        chosenControllers.add(support.uid);
      }
    }
  }
  const selected = [...new Set(requiredUids)].map(uid => candidates.find(p => p.uid === uid)).filter(Boolean).slice(0, partyLimit);
  for (const id of preferredSpecies) {
    const profile = candidates.find(p => p.speciesId === id && !selected.includes(p) && (level.id!==25||p.level>=30) && (level.id!==33||p.level>=60));
    if (profile && selected.length < partyLimit) selected.push(profile);
  }
  while (selected.length < Math.min(partyLimit, candidates.length)) {
    const next = candidates.filter(p => !selected.includes(p)).sort((a, b) => {
      const adjusted = p => pokemonScore(data, p) * (selected.some(q => q.speciesId === p.speciesId) ? 0.7 : 1);
      return adjusted(b) - adjusted(a) || stable(a).localeCompare(stable(b));
    })[0];
    selected.push(next);
  }
  if (paidMoves) for (const p of selected) for (const moveId of extraMoves) {
    if (p.moves.includes(moveId)) continue;
    const source = data.species[p.speciesId].learnset.some(m=>m.moveId===moveId&&m.level<=p.level)?'relearn':'tm';
    const replacement = p.moves.map((id,i)=>({id,i,score:moveScore(data,p,id)}))
      .filter(m=>!extraMoves.includes(m.id)&&!utilityMoves.has(m.id)).sort((a,b)=>a.score-b.score||a.i-b.i)[0];
    const slot = p.moves.length<4?p.moves.length:replacement?.i;
    if(slot===undefined)continue;
    const result=teachMove(data,save,p,moveId,slot,source);
    if(result.ok)onAction({action:'learn-move',uid:p.uid,moveId,cost:result.cost});
  }
  const before = [...save.party];
  for (const uid of [...save.party].filter(Boolean)) moveStorageParty(save, uid, null);
  selected.forEach((p, i) => moveStorageParty(save, p.uid, i));
  if (paidMoves && level.mode === 'invasion') for (const p of selected) {
    if (p.moves.includes(83) || save.money < 30000 || !data.species[p.speciesId].tmMoveIds.includes(83)) continue;
    const slot = p.moves.map((id, i) => ({ i, score: utilityMoves.has(id) ? Infinity : moveScore(data, p, id) })).sort((a, b) => a.score - b.score || a.i - b.i)[0].i;
    const result = teachMove(data, save, p, 83, slot, 'tm');
    if (result.ok) onAction({ action: 'learn-move', uid: p.uid, moveId: 83, cost: result.cost });
  }
  if (JSON.stringify(before) !== JSON.stringify(save.party)) onAction({ action: 'select-party', party: selected.map(p => ({ uid: p.uid, speciesId: p.speciesId, level: p.level })) });
  return { party: [...save.party], selected: selected.map(p => ({ uid: p.uid, speciesId: p.speciesId, level: p.level })) };
}

function pathSamples(level) {
  const result = [];
  for (const path of Object.values(level.paths)) for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], n = Math.max(1, Math.ceil(dist(a, b) / 45));
    for (let j = 0; j < n; j++) result.push({ x: a.x + (b.x - a.x) * j / n, y: a.y + (b.y - a.y) * j / n });
  }
  return result;
}
const inRange = (spot, enemy) => Math.abs(spot.x - enemy.x) <= 155 && Math.abs(spot.y - enemy.y) <= 155;

export function createPolicy(battle, options = {}) {
  if (battle.level.mode === 'safari') return createSafariPolicy(battle, options);
  if (options.trainingUids?.length && battle.level.mode === 'defense' && !battle.level.temporaryParty) return createTrainingPolicy(battle, options);
  const { onAction = () => {}, capture = 'new', training = true, repositionEvery = battle.challengeId === 6 || Number(battle.level.progressionId ?? battle.level.id) >= 28 || battle.towers.some(t => t.npc && t.selectedMove === 404) ? 12 : 45, relearn = true } = options;
  const collecting = Boolean(options.collection && options.captureUid);
  const captureLimit = options.maxCollectionCaptures ?? 250;
  const data = battle.data, summaries = { actions: 0, captured: 0, trained: 0, evolved: 0, potions: 0, placements: 0, launches: 0 };
  const healingRetreats = new Set(), selfHealingRetreats = new Set();
  const hasGaryHealing = battle.towers.some(t => t.npc && t.selectedMove === 404);
  const samples = pathSamples(battle.level), placements = new Map(), learnedAttempts = new Set();
  let lastDecision = -1000, prepared = false;
  const log = (action, fields = {}) => { summaries.actions++; onAction({ frame: battle.frame, action, ...fields }); };
  const ownRecord = p => { if (!battle.level.temporaryParty) recordOwned(battle.campaignSave ?? battle.save, p); };
  const enemies = () => battle.enemies.filter(e => e.alive && !e.playerControlled);
  const actorFor = p => battle.towers.find(t => t.uid === p.uid) ?? battle.enemies.find(e => e.partyUid === p.uid);
  const collectedSpecies = new Map();
  const requestedSpecies = new Set(Array.isArray(options.targetSpecies) ? options.targetSpecies : [options.targetSpecies].filter(Boolean));
  const protectedTarget = e => e.canCapture && requestedSpecies.has(e.speciesId)
    && (collectedSpecies.get(e.speciesId) ?? 0) < Math.max(1, Number(options.targetCounts?.[e.speciesId]) || 1);
  const controlMoves = new Map(Object.entries(options.controlMoves ?? {}));
  if (options.identifyUid) controlMoves.set(options.identifyUid, options.identifyMove ?? 227);
  const collectionRole = p => p.uid === options.captureUid || controlMoves.has(p.uid);
  const stageControllers = new Map();
  for (const [index, moveId] of (stageControlMoves[key(battle)] ?? []).entries()) {
    const profile = [...battle.partyMembers].filter(p => !stageControllers.has(p.uid) && p.moves.includes(moveId))
      .sort((a, b) => (moveId===36?-1:1)*(pokemonScore(data, a) - pokemonScore(data, b)) || stable(a).localeCompare(stable(b)))[0];
    if (profile) stageControllers.set(profile.uid, { profile, moveId, index });
  }
  const preservedMove = (profile, id) => utilityMoves.has(id) || selfHealing.has(data.moves[id]?.name);
  // Attackers wait away from every path entrance. A newly spawned rare target
  // is then observable on the next tick before it can enter their attack area.
  const collectionSafeSpot = spot => Object.values(battle.level.paths).every(path => !path[0] || dist(spot, path[0]) > 280);

  function selectCollectionTarget(profile, actor) {
    let preference = 'healthy';
    if (actor?.placed) {
      const choices = ['healthy', 'first', 'fastest', 'slowest', 'strongest', 'weakest', 'effective', 'candy', 'no-candy'];
      preference = choices.find(target => protectedTarget(battle.selectTargets({ ...actor, target }, enemies())[0] ?? {})) ?? preference;
    }
    if (profile.target !== preference) {
      profile.target = preference; battle.syncPokemon(profile);
      log('select-target', { uid: profile.uid, target: preference });
    }
  }

  function chooseMove(profile, targets = []) {
    const actor = actorFor(profile);
    if (battle.level.mode === 'safari') return;
    if (collecting && controlMoves.has(profile.uid) && profile.moves.includes(controlMoves.get(profile.uid))) {
      selectCollectionTarget(profile, actor);
      const moveId = controlMoves.get(profile.uid);
      if (profile.selectedMove !== moveId) { profile.selectedMove = moveId; battle.syncPokemon(profile); log('select-move', { uid: profile.uid, moveId, move: data.moves[moveId].name }); }
      return;
    }
    if (collecting && profile.uid === options.captureUid && profile.moves.includes(273)) {
      selectCollectionTarget(profile, actor);
      // Cerulean Cave's legendary visitors have roughly 1,900 HP. A known
      // single-target X-Scissor can safely remove their first large HP reserve;
      // return to False Swipe above the capture threshold.
      const protectedEnemies = enemies().filter(protectedTarget);
      const legendVisit = requestedSpecies.size > 0 && [...requestedSpecies].every(id => [150, 151].includes(id));
      const moveId = profile.moves.includes(268) && legendVisit
        && protectedEnemies.every(target => target.hp > (target.speciesId === 150
          ? Math.max(500, target.maxHp * 0.25) : Math.max(450, target.maxHp * 0.2))) ? 268 : 273;
      if (profile.selectedMove !== moveId) { profile.selectedMove = moveId; battle.syncPokemon(profile); log('select-move', { uid: profile.uid, moveId, move: data.moves[moveId].name }); }
      return;
    }
    const earthquakeSafe = battle.partyMembers.every(p => p.uid === profile.uid || effectiveness(data, 14, data.species[p.speciesId].typeIds) === 0);
    const score = id => moveScore(data, profile, id, targets) * (data.moves[id]?.name === 'Earthquake' && earthquakeSafe ? 1 / 0.15 : 1);
    let best = [...profile.moves].sort((a, b) => score(b) - score(a) || a - b)[0];
    const controller = stageControllers.get(profile.uid);
    if (controller && ([36,101].includes(controller.moveId)||!targets.length || targets.some(target => !target.effects?.[controller.moveId === 26 ? 'sleep' : 'paralysis']))) best = controller.moveId;
    if (battle.level.mode === 'invasion' && profile.moves.includes(83)) best = 83;
    // Challenge 3's temporary Geodude has no damaging alternative; its
    // Selfdestruct opens a party slot for the next scripted capture.
    if (battle.challengeId === 3 && profile.moves.includes(144) && moveScore(data, profile, best, targets) <= 0) best = 144;
    if (battle.challengeId === 6 && profile.speciesId === 3) best = 26;
    if (battle.challengeId === 6 && profile.speciesId === 45) best = 73;
    // Challenge 2 is a support puzzle: retain the Sing/debuff team and evasion.
    if (battle.challengeId === 2) best = { 39: 47, 35: 63, 74: 64, 16: 2, 25: 5, 4: 6 }[profile.speciesId] ?? best;
    const healing = profile.moves.find(id => selfHealing.has(data.moves[id]?.name));
    if (healing && actor?.alive && (actor.hp / actor.maxHp < 0.4 || selfHealingRetreats.has(profile.uid))) best = healing;
    if (!best || best === profile.selectedMove || actor && battle.isMoveLocked(actor)) return;
    if (!stageControllers.has(profile.uid) && !(battle.level.mode === 'invasion' && best === 83) && !(battle.challengeId === 3 && best === 144) && targets.length && !selfHealing.has(data.moves[profile.selectedMove]?.name)
      && !selfHealing.has(data.moves[best]?.name) && moveScore(data, profile, best, targets) < moveScore(data, profile, profile.selectedMove, targets) * 1.35) return;
    if (actor?.alive && !actor.recalled && battle.moveRuntime && battle.state === 'running') {
      const model = createBattlePokemonCheck(data, battle, actor);
      if (model.ok) { model.chooseMove(profile.moves.indexOf(best) + 1); model.close(); }
    } else { profile.selectedMove = best; battle.syncPokemon(profile); }
    if (profile.selectedMove === best) log('select-move', { uid: profile.uid, moveId: best, move: data.moves[best].name });
  }

  function learnUsefulMove(profile) {
    if (collecting || !relearn || battle.level.mode === 'invasion' || battle.level.mode === 'safari' || battle.level.temporaryParty) return;
    const signature = `${profile.uid}:${profile.speciesId}:${profile.level}`;
    if (learnedAttempts.has(signature)) return;
    learnedAttempts.add(signature);
    const choices = data.species[profile.speciesId].learnset.filter(m => m.level <= profile.level && !profile.moves.includes(m.moveId))
      .sort((a, b) => moveScore(data, profile, b.moveId) - moveScore(data, profile, a.moveId) || a.moveId - b.moveId);
    const best = choices[0];
    if (!best) return;
    const worst = profile.moves.map((id, i) => ({ i, score: preservedMove(profile, id) ? 100000 : moveScore(data, profile, id) })).sort((a, b) => a.score - b.score || a.i - b.i)[0];
    const bestKnown = Math.max(...profile.moves.map(id => moveScore(data, profile, id)));
    // Save the early economy for levels; replacing a weak move at its learned
    // level costs nothing. Relearning later uses the real ₽1,000 action.
    if (moveScore(data, profile, best.moveId) <= Math.max(profile.moves.length < 4 ? 0 : worst.score * 1.5, bestKnown * 0.65)
      || best.level < profile.level && battle.save.money < 2000) return;
    const result = teachMove(data, battle.save, profile, best.moveId, worst.i, best.level === profile.level ? 'level' : 'relearn');
    if (result.ok) { battle.syncPokemon(profile); log('learn-move', { uid: profile.uid, moveId: best.moveId, cost: result.cost }); }
  }

  function train(profile) {
    const actor = actorFor(profile);
    if (collecting || !training || battle.level.mode === 'invasion' || profile.speciesId >= 1000 || !actor?.alive || !actor.placed || actor.recalled
      || profile.level >= 100 || profile.experience < xpRequired(profile.level) || battle.save.money < levelCost(profile.level)) return;
    const before = { level: profile.level, speciesId: profile.speciesId, money: battle.save.money };
    if (battle.moveRuntime) {
      const model = createBattlePokemonCheck(data, battle, actor, { campaignSave: battle.campaignSave ?? battle.save });
      if (!model.ok) return;
      if (!model.train()) { model.close(); return; }
      let replaced = false;
      for (let n = 0; n < 1200 && !model.closed; n++) {
        model.tick();
        const label = model.clip.actual?.currentLabel ?? model.clip.currentLabel;
        if (model.phase === 'trying' && label === 'end_trying_learn_move') model.click('learn_butt');
        else if (model.phase === 'replace' && label === 'end_replace_move') {
          if (!replaced) {
            const replacement = profile.moves.map((id, i) => ({ i, score: preservedMove(profile, id) ? 100000 : moveScore(data, profile, id) })).sort((a, b) => a.score - b.score || a.i - b.i)[0];
            model.click(`actual.change_Move_screen.attack_${replacement.i + 1}`); replaced = true;
          }
          model.click('actual.done_butt');
        } else if (['end_learn_move', 'done_evolving'].includes(label)) model.click();
      }
      if (!model.closed) { log('policy-warning', { message: 'Training popup exceeded 1,200 animation frames.', phase: model.phase }); model.close(); }
    } else {
      if (!trainPokemon(battle.save, profile, data)) return;
      evolvePokemon(profile, data); battle.syncPokemon(profile);
    }
    if (profile.level !== before.level) { summaries.trained++; log('train', { uid: profile.uid, from: before.level, to: profile.level, cost: before.money - battle.save.money }); }
    if (profile.speciesId !== before.speciesId) { summaries.evolved++; ownRecord(profile); log('evolve', { uid: profile.uid, from: before.speciesId, to: profile.speciesId }); }
    learnedAttempts.delete(`${profile.uid}:${profile.speciesId}:${profile.level}`);
    learnUsefulMove(profile); chooseMove(profile);
  }

  function captureAvailable() {
    if (battle.level.mode === 'invasion' || capture === 'none') return;
    for (const enemy of [...enemies()]) {
      if (!battle.canCapture(enemy)) continue;
      if (collecting && (summaries.captured >= captureLimit || battle.save.pokemon.length >= 4900)) continue;
      const same = battle.save.pokemon.filter(p => p.speciesId === enemy.speciesId && p.shiny === enemy.shiny);
      const useful = !same.length || enemy.shiny || enemy.level > Math.max(...same.map(p => p.level)) + 2
        || battle.partyMembers.length < 6 || enemy.candy || battle.challengeId === 3;
      if (capture !== 'all' && !useful) continue;
      const result = battle.capture(enemy.uid);
      if (result.ok) { ownRecord(result.profile); collectedSpecies.set(result.profile.speciesId, (collectedSpecies.get(result.profile.speciesId) ?? 0) + 1); summaries.captured++; log('capture', { enemyUid: enemy.uid, uid: result.profile.uid, speciesId: result.profile.speciesId, level: result.profile.level, shiny: result.profile.shiny }); }
    }
  }

  function eligibleProfiles() {
    const protect = collecting && enemies().some(protectedTarget);
    let party = battle.partyMembers.filter(p => (!protect || collectionRole(p)) && !battle.stageHooks?.dismissedParty.has(p.uid) && (actorFor(p)?.alive ?? true));
    const threats = enemies();
    const tacticalScore = p => {
      if (stageControllers.has(p.uid)) return 10000000 - stageControllers.get(p.uid).index;
      if (collecting && protect && p.uid === options.captureUid) return 10000000;
      if (collecting && protect && controlMoves.has(p.uid)) return 1000000;
      const ordinary = Math.max(1, ...p.moves.map(id => moveScore(data, p, id)));
      const effective = Math.max(0, ...p.moves.map(id => moveScore(data, p, id, threats)));
      return (healingRetreats.has(p.uid) || selfHealingRetreats.has(p.uid) ? 100000 : 0) + pokemonScore(data, p) * Math.sqrt(Math.max(0.05, effective / ordinary));
    };
    party.sort((a, b) => tacticalScore(b) - tacticalScore(a) || stable(a).localeCompare(stable(b)));
    // Brock dismisses the Pokémon still deployed when round ten begins.
    // Use the strongest counter for the early rounds, then withdraw it during
    // the visible ninth wave so it can legally return against Onix.
    if (key(battle) === 'level_5' && battle.currentWave >= 9 && !battle.stageHooks?.pewterDismissed && party.length > 1) {
      const reserve = [...party].sort((a, b) => {
        const value = p => Math.max(...p.moves.map(id => moveScore(data, p, id, [{ speciesId: 95 }]))) * p.level;
        return value(b) - value(a) || stable(a).localeCompare(stable(b));
      })[0];
      if (actorFor(reserve)?.placed && battle.recall(reserve.uid)) log('recall', { uid: reserve.uid, reason: 'Reserve for Brock final round' });
      party = party.filter(p => p !== reserve);
    }
    return party;
  }

  function spotScore(spot, profile, threats, assigned) {
    let score = 0;
    if (stageControllers.has(profile.uid)&&key(battle)!=='level_15') {
      const index=stageControllers.get(profile.uid).index;
      const desired=key(battle)==='level_15'?[6,12,16,19][index]:['class_966','class_968'].includes(key(battle))?index+1:index===0?1:3;
      return spot.index===desired?100000:-100000;
    }
    if (collecting && collectionRole(profile) && threats.some(protectedTarget)) threats = threats.filter(protectedTarget);
    if (selfHealingRetreats.has(profile.uid)) return Math.min(1000, ...threats.map(e => dist(spot, e)));
    for (const point of samples) if (inRange(spot, point)) score += 0.1;
    for (const enemy of threats) {
      const nearby = inRange(spot, enemy);
      const requested = Array.isArray(options.targetSpecies) ? options.targetSpecies.includes(enemy.speciesId) : options.targetSpecies === enemy.speciesId;
      const dangerous = ['Rollout', 'Ice Ball', 'Fury Cutter'].includes(data.moves[enemy.selectedMove]?.name);
      const weight = (options.defendAllCandy&&enemy.candy?100:key(battle)==='level_15'&&enemy.candy?30:dangerous?12:enemy.candy?4:requested?2:1) * (1 + Math.min(3, enemy.hp / Math.max(1, enemy.maxHp)));
      const covered = assigned.filter(s => inRange(s, enemy)).length;
      score += nearby ? weight * 20 / (1 + covered * 0.4) : weight * Math.max(0, 5 - dist(spot, enemy) / 80);
    }
    if (actorFor(profile)?.spotIndex === spot.index) score += 1.5;
    return score;
  }

  function deploy() {
    if (battle.level.mode === 'invasion') return;
    if (!hasGaryHealing) for (const tower of battle.towers.filter(t => t.alive && !t.npc)) {
      if (!tower.moves.some(id => selfHealing.has(data.moves[id]?.name))) continue;
      if (tower.hp / tower.maxHp < 0.7) selfHealingRetreats.add(tower.uid);
      else if (tower.hp / tower.maxHp > 0.92) selfHealingRetreats.delete(tower.uid);
    }
    if (hasGaryHealing) for (const tower of battle.towers.filter(t => t.alive && !t.npc)) {
      if (tower.hp / tower.maxHp < 0.65) healingRetreats.add(tower.uid);
      else if (tower.hp / tower.maxHp > 0.9) healingRetreats.delete(tower.uid);
    }
    if (collecting && enemies().some(protectedTarget)) for (const tower of battle.towers.filter(t => !t.npc && t.placed && !collectionRole(t))) {
      if (battle.recall(tower.uid)) log('recall', { uid: tower.uid, reason: 'Protect collection targets from lethal attacks' });
    }
    const hazards = battle.challengeId === 6 ? enemies().filter(e => e.speciesId === 251)
      : battle.level.id === 33 && !battle.wave?.finished ? enemies().filter(e => e.maxHp > 5000) : [];
    const threats = enemies().filter(e => !hazards.includes(e)), assigned = [], taken = new Set(battle.towers.filter(t => t.npc && t.placed).map(t => t.spotIndex));
    const noSafeAlternative = !battle.level.spots.some(s => !threats.some(e => Math.abs(s.x-e.x)<225 && Math.abs(s.y-e.y)<225));
    const profiles = eligibleProfiles();
    for (const p of profiles) {
      const actor = actorFor(p);
      const candidates = battle.level.spots.filter(s => !taken.has(s.index) && battle.isSpotEligible(p, s.index) && (!collecting || collectionRole(p) || collectionSafeSpot(s)) && (!selfHealingRetreats.has(p.uid) || noSafeAlternative || !threats.some(e => Math.abs(s.x-e.x)<225 && Math.abs(s.y-e.y)<225)) && (!healingRetreats.has(p.uid) || [2, 4, 5].includes(s.index)) && !hazards.some(e => Math.abs(s.x - e.x) < 235 && Math.abs(s.y - e.y) < 235))
        .sort((a, b) => spotScore(b, p, threats, assigned) - spotScore(a, p, threats, assigned) || a.index - b.index);
      let best = candidates.find(s => !battle.towers.some(t => t.placed && t.uid !== p.uid && t.spotIndex === s.index));
      // A limited map may require substituting a party member for a better
      // type matchup. The normal drag action returns the occupant to its party.
      if (!best && threats.length) best = candidates[0];
      const current = battle.level.spots.find(s => s.index === actor?.spotIndex);
      if (key(battle) === 'level_3' && p.moves.includes(224) && !battle.stageHooks?.cutOpened) best = candidates.find(s => s.index === 3) ?? best;
      // Saffron's teleporters leave very little attack time. Start the fast
      // Ghost/Bug/Electric counters together on the entrance lane.
      if (key(battle) === 'level_25' && battle.frame === 0) {
        const opening = { 94: 1, 123: 2, 26: 3, 65: 4, 6: 5, 34: 6 }[p.speciesId];
        best = candidates.find(s => s.index === opening) ?? best;
      }
      if (current && actor.placed && candidates.includes(current)) {
        // Do not cancel attacks to chase tiny spatial improvements.
        if ((!best || !threats.length || threats.some(e => inRange(current, e)) && spotScore(best, p, threats, assigned) < spotScore(current, p, threats, assigned) * 1.8) && !(key(battle) === 'level_3' && p.moves.includes(224) && !battle.stageHooks?.cutOpened)) best = current;
      }
      if (!best) { if (actor?.placed && hazards.length && battle.recall(p.uid)) log('recall', { uid: p.uid, reason: 'Avoid Celebi SolarBeam' }); continue; }
      taken.add(best.index); assigned.push(best);
      if (actor?.placed && actor.spotIndex === best.index) continue;
      let ok;
      if (battle.state === 'ready') ok = battle.place(p.uid, best.index);
      else if (battle.state === 'running') {
        const drag = battle.beginTowerDrag(p.uid);
        ok = Boolean(drag && battle.endTowerDrag(p.uid, best.index)?.placed);
      }
      if (ok) { summaries.placements++; placements.set(p.uid, battle.frame); log('place', { uid: p.uid, spotIndex: best.index }); }
    }
  }

  function invasion() {
    const paths = Object.entries(battle.level.paths).sort(([a], [b]) => a.localeCompare(b));
    const defenders = battle.towers.filter(t => t.alive);
    const launchScore = p => {
      if (!defenders.length) return pokemonScore(data, p);
      const attack = Math.max(1, ...p.moves.map(id => moveScore(data, p, id, defenders)));
      const vulnerability = defenders.reduce((n, t) => n + effectiveness(data, data.moves[t.selectedMove]?.typeId ?? 5, data.species[p.speciesId].typeIds), 0) / defenders.length;
      return p.level * Math.sqrt(attack) / Math.max(0.2, vulnerability);
    };
    const ranked = [...battle.partyMembers].sort((a, b) => launchScore(b) - launchScore(a) || stable(a).localeCompare(stable(b)));
    // Send the Sing support first so it reaches the defenders with the group.
    if (battle.challengeId === 2) ranked.sort((a, b) => [39, 74, 16, 25, 35, 4].indexOf(a.speciesId) - [39, 74, 16, 25, 35, 4].indexOf(b.speciesId));
    for (const p of ranked) {
      if (!battle.available(p.uid) || battle.energy < battle.launchCost) continue;
      const launchDelay = options.launchSchedule?.[p.speciesId] ?? 0;
      if (battle.frame < launchDelay) continue;
      const route = [...paths].sort((a, b) => {
        const score = ([, points]) => {
          const end = points.at(-1);
          const preferred = battle.candies.find(c => c.id === options.preferredCandyId && c.state !== 'lost');
          const candy = preferred ? dist(end, preferred) * 100 : Math.min(...battle.candies.filter(c => c.state !== 'lost').map(c => dist(end, c)));
          const danger = points.reduce((n, point) => n + battle.towers.filter(t => t.alive && inRange(t, point)).length, 0);
          return candy + danger * 40;
        };
        return score(a) - score(b) || a[0].localeCompare(b[0]);
      })[0]?.[0];
      if (route && battle.launch(p.uid, route)) { summaries.launches++; log('launch', { uid: p.uid, path: route, energy: battle.energy }); }
    }
  }

  function prepare() {
    if (prepared) return summaries;
    prepared = true;
    for (const p of battle.partyMembers) {
      if (!collecting && relearn && options.paidHealing !== false && !battle.level.temporaryParty && p.level >= 50 && battle.save.money > 12000 && !p.moves.some(id => selfHealing.has(data.moves[id]?.name))) {
        const natural = data.species[p.speciesId].learnset.find(e => e.level <= p.level && selfHealing.has(data.moves[e.moveId]?.name));
        const moveId = natural?.moveId ?? 143;
        const weakest = p.moves.map((id, i) => ({i, score:moveScore(data,p,id)})).sort((a,b)=>a.score-b.score || a.i-b.i)[0];
        const result = teachMove(data,battle.save,p,moveId,weakest.i,natural?'relearn':'tm');
        if(result.ok) { battle.syncPokemon(p); log('learn-healing',{uid:p.uid,moveId,cost:result.cost}); }
      }
    }
    for (const p of battle.partyMembers) {
      if (options.defendAllCandy || ['level_28', 'class_953', 'level_32', 'level_33'].includes(key(battle))) { p.target = options.defendAllCandy ? 'candy' : 'weakest'; battle.syncPokemon(p); log('select-target', { uid: p.uid, target: p.target }); }
      for (let i = 0; i < 3; i++) { learnedAttempts.delete(`${p.uid}:${p.speciesId}:${p.level}`); learnUsefulMove(p); }
      chooseMove(p, battle.level.mode === 'invasion' && battle.challengeId !== 2 ? battle.towers.filter(t => t.alive) : []);
    }
    if (battle.level.mode === 'safari') { battle.setSafariAction('rock'); log('safari-action', { actionName: 'rock' }); }
    deploy();
    return summaries;
  }
  function step() {
    if (!prepared) prepare();
    if (battle.state !== 'running') return;
    captureAvailable();
    for (const p of battle.partyMembers) train(p);
    for (const tower of battle.towers.filter(t => t.alive && t.placed && !t.npc).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)) {
      if (tower.hp / tower.maxHp < 0.35 && battle.usePotion(tower.uid)) { summaries.potions++; log('potion', { uid: tower.uid, remaining: battle.potions }); }
    }
    if (battle.level.mode === 'invasion') { invasion(); return; }
    for (const tower of battle.towers.filter(t => t.alive && t.placed && !t.npc)) {
        const ailments = ['sleep', 'poison', 'toxic', 'freeze', 'burn', 'paralysis'].filter(name => tower.effects[name]);
        if (ailments.length && Number(battle.level.progressionId ?? battle.level.id) < 40) {
          const spot = tower.spotIndex;
          if (!battle.recall(tower.uid)) continue;
          const drag = battle.beginTowerDrag(tower.uid);
          const result = drag && battle.endTowerDrag(tower.uid, spot);
          if (result?.placed) log('redeploy-status', { uid: tower.uid, spotIndex: spot, ailments });
        }
      }
    if (collecting || battle.frame - lastDecision >= repositionEvery || battle.partyMembers.some(p => !actorFor(p))) {
      lastDecision = battle.frame;
      deploy();
      for (const p of battle.partyMembers) {
        const tower = actorFor(p);
        if (tower?.alive && tower.placed) chooseMove(p, enemies().filter(e => inRange(tower, e)));
      }
    }
    for (const { profile } of stageControllers.values()) {
      const tower = actorFor(profile);
      if (tower?.alive && tower.placed) chooseMove(profile, enemies().filter(e => inRange(tower, e)));
    }
  }
  return { prepare, step, summary: summaries };
}
