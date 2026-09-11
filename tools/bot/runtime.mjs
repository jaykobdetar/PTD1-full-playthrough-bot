import {readFileSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {Battle} from '../../src/battle.js';
import {ReverseBattle} from '../../src/reverse-battle.js';
import {SafariBattle} from '../../src/safari-battle.js';
import {ChallengeBattle, ChallengeInvasion} from '../../src/challenge-battle.js';
import {initializeStageHooks} from '../../src/stage-hooks.js';
import {recordOwned} from '../../src/profile-features.js';
import {awardRoute2Flash, recordTunnelSessionCapture, rockTunnelSession} from '../../src/rock-tunnel.js';
import {validateSave,makePokemon} from '../../src/model.js';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const BOT_VERSION = 1;
export function readJSON(path) { return JSON.parse(readFileSync(join(ROOT, path), 'utf8')); }
export function loadGame() {
  const data = readJSON('public/data/game-data.json');
  data.timelines = readJSON('public/data/story-timelines.json');
  return {data, ...readJSON('public/data/levels.json')};
}
export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(stable(value))).digest('hex');
export function fingerprint() {
  const files = [];
  for (const dir of ['src', 'tools/bot', 'public/data']) {
    for (const name of readdirSync(join(ROOT, dir)).sort()) if (/\.(?:js|mjs|json)$/.test(name)) files.push(`${dir}/${name}`);
  }
  files.push('docs/BOT_ENCOUNTER_CANDIDATES.json','docs/BOT_COMPLETION_MANIFEST.json','docs/bot-repros/xp-overflow/checkpoint.json','public/assets/story36/manifest.json','package-lock.json');
  for(const name of ['cases.json','dojo-26.json','cinnabar-32.json','cinnabar-33.json']) files.push(`docs/bot-repros/story-rewards/${name}`);
  return digest(files.map(path => [path, digest(readFileSync(join(ROOT, path), 'utf8'))]));
}
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Install only in the dedicated bot process, never in the application. Keep
// identity timestamps repeatable; the calendar does not advance to farm gifts.
export function deterministicEnvironment(seed, epoch = '2026-09-08T12:00:00.000Z') {
  const RealDate = globalThis.Date, oldRandom = Math.random, instant = RealDate.parse(epoch);
  if (!Number.isFinite(instant)) throw new Error('Invalid deterministic epoch');
  Math.random = random(seed);
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return instant; }
  };
  rockTunnelSession.pikachuCaptures = 0;
  return () => { globalThis.Date = RealDate; Math.random = oldRandom; };
}
export function reserveIdentityRange(data,saves) {
  // The game allocator is process-local. Reserve its old range when loading a
  // checkpoint; these throwaway objects are never added to any game collection.
  const suffixes=saves.filter(Boolean).flatMap(save=>save.pokemon.map(p=>Number(p.uid.split('-').at(-1)))).filter(Number.isSafeInteger);
  const maximum=Math.max(0,...suffixes);
  if(maximum>10000000) throw new Error('Checkpoint identity range exceeds safety bound');
  for(let i=0;i<maximum;i++) makePokemon(data,1);
}
export function coverage(game, save, attempts = [], navigation = []) {
  const owned = new Set(['normal','shiny','shadow'].flatMap(form => save.dex?.[form] ?? []));
  const species = Array.from({length:151}, (_, i) => i + 1);
  const campaign = game.levels.map(level => ({id:level.id, name:level.displayName, status:save.completed.includes(level.id) ? 'won' : attempts.some(a=>a.campaignId===level.id) ? 'blocked' : 'unreached'}));
  const navigationOnly=new Set(['class_959','class_964','class_967']);
  const variants = game.variants.filter(level=>!level.challengeId && !level.className.startsWith('multi_')).map(level => ({id:level.className, campaignId:level.progressionId, kind:navigationOnly.has(level.className)?'navigation':'battle', status:attempts.some(a=>a.stage===level.className && a.outcome==='won') ? 'won' : navigationOnly.has(level.className)&&navigation.includes(level.className)?'visited': attempts.some(a=>a.stage===level.className) ? 'blocked' : 'unreached'}));
  const challenges = game.variants.filter(level=>level.challengeId).map(level=>({id:level.challengeId, status:save.challengeCompleted>=level.challengeId ? 'won' : attempts.some(a=>a.challengeId===level.challengeId) ? 'blocked' : 'unreached'}));
  const dex = {owned:species.filter(id=>owned.has(id)).length, total:151, missing:species.filter(id=>!owned.has(id)), forms:Object.fromEntries(['normal','shiny','shadow'].map(form=>[form,{owned:species.filter(id=>save.dex?.[form]?.includes(id)).length,missing:species.filter(id=>!save.dex?.[form]?.includes(id))}]))};
  return {complete:campaign.every(x=>x.status==='won') && variants.every(x=>['won','visited'].includes(x.status)) && challenges.every(x=>x.status==='won') && dex.missing.length===0, campaign, variants, challenges, dex, achievements:Object.keys(save.achievements ?? {}).filter(key=>save.achievements[key]).map(Number).sort((a,b)=>a-b)};
}
export function assertBattle(battle) {
  if (!Number.isSafeInteger(battle.save.money) || battle.save.money < 0) throw new Error(`Invalid money: ${battle.save.money}`);
  if (new Set(battle.save.pokemon.map(p=>p.uid)).size !== battle.save.pokemon.length) throw new Error('Duplicate Pokémon identities');
  for(const profile of battle.save.pokemon) if(!Number.isSafeInteger(profile.experience)||profile.experience<0||profile.experience>2147483647) throw new Error(`Invalid experience on ${profile.uid}: ${profile.experience}`);
  for (const fighter of [...battle.towers, ...battle.enemies]) {
    for (const key of ['hp','maxHp','x','y','level']) if (!Number.isFinite(fighter[key])) throw new Error(`Nonfinite ${key} on ${fighter.uid}: ${fighter[key]}`);
    if (fighter.maxHp <= 0) throw new Error(`Nonpositive HP capacity on ${fighter.uid}`);
  }
}
export function snapshot(battle) {
  const actor = p=>({uid:p.uid,speciesId:p.speciesId,level:p.level,hp:p.hp,maxHp:p.maxHp,x:p.x,y:p.y,alive:p.alive,placed:p.placed,spot:p.spotIndex,move:p.selectedMove});
  return {state:battle.state,frame:battle.frame,wave:battle.currentWave,totalWaves:battle.totalWaves,candy:battle.remainingCandy,energy:battle.energy,potions:battle.potions,stats:{...battle.stats},towers:battle.towers.map(actor),enemies:battle.enemies.map(actor)};
}
export function makeBattle(game, level, save, {seed, campaignId, emit=()=>{}, tunnel}={}) {
  const Engine = level.challengeId ? (level.mode==='invasion' ? ChallengeInvasion : ChallengeBattle) : level.mode==='safari' ? SafariBattle : level.mode==='invasion' ? ReverseBattle : Battle;
  let battle;
  const pending = [];
  const listener = (type,event) => {
    if (type==='capture' && !level.temporaryParty) { recordOwned(save,event.profile); recordTunnelSessionCapture(event.profile); }
    if (type==='finish' && battle) awardRoute2Flash(battle,event.won);
    if (battle) emit(type,event,battle); else pending.push([type,event]);
  };
  battle = new Engine(game.data, level, save, listener, {campaignId:campaignId ?? level.progressionId ?? level.id, seed, rng:random(seed ^ 0xa511e9b3)});
  if (tunnel) tunnel.bindBattle(battle);
  initializeStageHooks(battle);
  for (const [type,event] of pending) emit(type,event,battle);
  return battle;
}
export function checkSave(save,data) { return validateSave(save,data); }
