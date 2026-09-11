import {createBattlePokemonCheck} from '../../src/original-battle-ui.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const inRange = (spot, enemy) => Math.abs(spot.x - enemy.x) <= 145 && Math.abs(spot.y - enemy.y) <= 145;
const targetModes = ['first', 'fastest', 'slowest', 'weakest', 'strongest'];

/** A Safari-specific player: Joey remains the only combatant. Requested rare
 * encounters get a stable chase, native targeting, and Bait before Rock. */
export function createSafariPolicy(battle, {targetSpecies = [], capture = 'new', onAction = () => {}} = {}) {
  if (battle.level.mode !== 'safari' || !battle.joey || !battle.moveRuntime) throw new Error('Safari policy requires native Safari Joey.');
  const desired = new Set(Array.isArray(targetSpecies) ? targetSpecies : [targetSpecies]);
  const owned = new Set(['normal', 'shiny', 'shadow'].flatMap(form => battle.save.dex?.[form] ?? []));
  const acquired = new Set(), observed = new Set(), summary = {actions: 0, captured: 0, placements: 0, bait: 0, rock: 0, observedTargets: [], capturedTargets: []};
  let prepared = false, focusUid = null, lastMoveChange = -1000, lastPlacement = -1000;
  const log = (action, fields = {}) => {summary.actions++; onAction({frame: battle.frame, action, ...fields});};
  const actor = () => battle.towers.find(tower => tower.uid === battle.joey.uid);
  function controls(moveId, targetMode) {
    const tower = actor();
    if (!tower?.alive || !tower.placed || tower.recalled) return;
    const changeMove = moveId !== battle.joey.selectedMove;
    const changeTarget = targetMode !== battle.joey.target;
    if (!changeMove && !changeTarget) return;
    const menu = createBattlePokemonCheck(battle.data, battle, tower);
    if (!menu.ok) return;
    if (changeTarget && menu.chooseTarget(targetModes.indexOf(targetMode) + 1)) log('safari-target', {target: targetMode, focusUid});
    if (changeMove && menu.chooseMove(battle.joey.moves.indexOf(moveId) + 1)) {
      const name = moveId === 398 ? 'bait' : 'rock'; summary[name]++; lastMoveChange = battle.frame;
      log('safari-action', {actionName: name, moveId, focusUid});
    }
    menu.close();
  }
  function place(index) {
    const tower = actor();
    if (tower?.spotIndex === index && tower.placed) return false;
    const result = battle.state === 'ready' ? battle.place(battle.joey.uid, index)
      : battle.beginTowerDrag(battle.joey.uid) && battle.endTowerDrag(battle.joey.uid, index)?.placed;
    if (result) {summary.placements++; log('safari-place', {uid: battle.joey.uid, spotIndex: index, focusUid});}
    return Boolean(result);
  }
  function prepare() {
    if (prepared) return summary;
    prepared = true; place(12); controls(397, 'first');
    return summary;
  }
  function step() {
    if (!prepared) prepare();
    if (battle.state !== 'running') return;
    const alive = battle.enemies.filter(enemy => enemy.alive);
    for (const enemy of alive) {
      if (desired.has(enemy.speciesId) && !observed.has(enemy.uid)) {
        observed.add(enemy.uid); summary.observedTargets.push({uid: enemy.uid, speciesId: enemy.speciesId, frame: battle.frame});
        log('safari-observed', {enemyUid: enemy.uid, speciesId: enemy.speciesId, hp: enemy.hp, maxHp: enemy.maxHp});
      }
      if (capture === 'none' || !battle.canCapture(enemy) || battle.save.pokemon.length >= 4900) continue;
      if (capture !== 'all' && owned.has(enemy.speciesId) && !desired.has(enemy.speciesId) && !enemy.shiny) continue;
      const result = battle.capture(enemy.uid);
      if (result.ok) {
        summary.captured++; acquired.add(enemy.speciesId); owned.add(enemy.speciesId);
        if (desired.has(enemy.speciesId)) summary.capturedTargets.push({speciesId: enemy.speciesId, uid: result.profile.uid, enemyUid: enemy.uid, frame: battle.frame});
        log('capture', {enemyUid: enemy.uid, uid: result.profile.uid, speciesId: result.profile.speciesId, level: result.profile.level, shiny: result.profile.shiny});
      }
    }
    const targets = alive.filter(enemy => enemy.alive && desired.has(enemy.speciesId) && !acquired.has(enemy.speciesId));
    let focus = targets.find(enemy => enemy.uid === focusUid) ?? targets[0];
    if (!focus) focus = alive.find(enemy => enemy.alive && !owned.has(enemy.speciesId)) ?? alive.find(enemy => enemy.alive);
    if (!focus) return;
    if (focusUid !== focus.uid) {focusUid = focus.uid; log('safari-focus', {enemyUid: focus.uid, speciesId: focus.speciesId});}
    const rare = desired.has(focus.speciesId) && !acquired.has(focus.speciesId);
    const tower = actor();
    const current = battle.level.spots.find(spot => spot.index === tower?.spotIndex);
    let mode = battle.joey.target;
    if (battle.frame - lastPlacement >= 6 && (rare || !current || !inRange(current, focus))) {
      lastPlacement = battle.frame;
      // SafariBattle itself uses this exported, read-only target sorter.
      // Evaluate legal menu preferences and spots, then issue the real controls.
      const choices = battle.level.spots.flatMap(spot => targetModes.map(target => {
        const ordered = battle.selectTargets({...tower, x: spot.x, y: spot.y, target}, alive);
        const index = ordered.findIndex(enemy => enemy.uid === focus.uid);
        const score = (index === 0 ? 10000 : index > 0 ? 5000 - index * 100 : 0)
          - distance(spot, focus) + (spot.index === current?.index ? 150 : 0);
        return {spot, target, score};
      })).sort((a, b) => b.score - a.score || a.spot.index - b.spot.index || targetModes.indexOf(a.target) - targetModes.indexOf(b.target));
      place(choices[0].spot.index); mode = choices[0].target;
    }
    const slowed = Boolean(focus.effects['speed-down']);
    const flinching = Boolean(focus.effects.flinch);
    const bait = rare && !slowed && !flinching;
    // Leave enough time for the native projectile and resulting status to land.
    if (battle.frame - lastMoveChange >= 36 || battle.joey.selectedMove === 397 && bait) controls(bait ? 398 : 397, mode);
    if (tower?.hp / tower?.maxHp < 0.4 && battle.usePotion(battle.joey.uid)) log('potion', {uid: battle.joey.uid, remaining: battle.potions});
  }
  return {prepare, step, summary};
}
