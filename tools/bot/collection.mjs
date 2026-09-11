/** Legal account collection planner. Call only between battles: Center
 * transactions replace profile snapshots, just as the application does. */
import { readFileSync } from 'node:fs';
import { LocalProfiles, PROFILE_BANK_KEY } from '../../src/local-services.js';
import { CenterService, syncCenterDex } from '../../src/center-model.js';
import { trainPokemon, evolvePokemon, xpRequired, levelCost } from '../../src/model.js';
import { recordOwned, tradePokemon, buyItem, useEvolutionItem, teachMove, releasePokemon } from '../../src/profile-features.js';
import { ADOPTION_CATALOG, CORNER_REWARDS } from '../../src/center-catalog.js';
import {achievementStatus,claimAchievement} from '../../src/achievements.js';
import {nextStrictReward,strictRewardEligibility} from './strict-story.mjs';

const FORMS = ['normal', 'shiny', 'shadow'];
const ALL = Array.from({length:151}, (_,i)=>i+1);
const PRIORITY = [65, 94, 6, 26, 34, 131, 3, 76, 18, 123];
const COLLECTION_STRATEGY_VERSION = 9;
const TRADE_ROUTES = [{speciesId:122,from:63,stage:3},{speciesId:124,from:61,stage:10},{speciesId:83,from:21,stage:14},{speciesId:108,from:80,stage:36}];
const candidates = JSON.parse(readFileSync(new URL('../../docs/BOT_ENCOUNTER_CANDIDATES.json', import.meta.url), 'utf8')).species;
const clone = value => structuredClone(value);
const entity = p => p ? {uid:p.uid,speciesId:p.speciesId,level:p.level,shiny:p.shiny} : null;

function knownSpecies(save){return new Set(FORMS.flatMap(form=>save.dex?.[form]??[]));}
function planningKnown(save){
  const known=knownSpecies(save);
  for(const trade of TRADE_ROUTES)if(!known.has(trade.speciesId)&&!save.pokemon.some(p=>p.speciesId===trade.from))known.delete(trade.from);
  return known;
}
function hasOwnedPredecessor(data,save,id,seen=new Set()){
  if(seen.has(id))return false;seen.add(id);
  return Object.values(data.species).filter(species=>species.evolutions.some(e=>e.to===id))
    .some(species=>save.pokemon.some(p=>p.speciesId===species.id)||hasOwnedPredecessor(data,save,species.id,seen));
}
function neededEvolution(data,profile,known){
  function hasMissing(id,seen=new Set()){
    if(!known.has(id))return true;
    if(seen.has(id))return false;seen.add(id);
    return (data.species[id]?.evolutions??[]).some(e=>hasMissing(e.to,seen));
  }
  return data.species[profile.speciesId].evolutions.find(e=>hasMissing(e.to));
}

/** Select an actually unlocked opposite-version capture route. */
export function auxiliaryCapturePlan(game,save,targetSpecies,attempts=[]){
  const missing=targetSpecies.filter(id=>!knownSpecies(save).has(id));
  const plans=game.levels.filter(level=>save.completed.includes(level.id)&&['defense','safari'].includes(level.mode)&&!level.nextStageClass)
    .map(level=>({level,targets:missing.filter(id=>(candidates[id]??[]).some(row=>row.version===save.gameVersion&&row.stage===level.id)),visits:attempts.filter(a=>a.campaignId===level.id&&a.purpose==='collection-version').length}))
    .filter(plan=>plan.targets.length).sort((a,b)=>b.targets.length/(1+b.visits)-a.targets.length/(1+a.visits)||a.level.id-b.level.id);
  const next=plans[0];if(!next)return null;
  const catcher=save.pokemon.filter(p=>p.moves.includes(273)).sort((a,b)=>Number(b.speciesId===123&&b.level>=60)-Number(a.speciesId===123&&a.level>=60)||b.level-a.level||a.uid.localeCompare(b.uid))[0];
  return {level:next.level,partyOptions:catcher&&next.level.mode!=='safari'?{requiredUids:[catcher.uid]}:{},
    policyOptions:{capture:'all',training:false,relearn:false,targetSpecies:next.targets,
      ...(catcher&&next.level.mode!=='safari'?{collection:true,captureUid:catcher.uid}: {})}};
}

/** Read-only next-objective selection; never forces spawn RNG or unlocks.
 * The returned policyOptions require the runner's targeted capture policy. */
export function bestNextVisit(game,save,attempts=[],{preferTraining=false,commerce=true,porygon=false}={}){
  const data=game.data??game,known=knownSpecies(save),missing=ALL.filter(id=>!known.has(id));
  if(!missing.length)return null;
  const strictRewards=!commerce?strictRewardEligibility(game,save):null;
  const reward=!commerce?nextStrictReward(game,save,attempts):null;
  if(reward)return reward;
  const version=save.gameVersion??1;
  // A recorded base species can still be needed again for a branching or
  // consumed evolution (three Eevee, for example). Dex flags are not inventory.
  const captureNeeded=new Set(missing),targetCounts={};
  // The bird quests require six real level100 partners of their type. Catch
  // additional wild partners when needed, even if their dex entry is known.
  for(const bird of strictRewards?.birds??[])if(bird.missing&&bird.unlocked&&bird.compatibleOwned<6){
    for(const species of Object.values(data.species))if(species.id<=151&&species.typeIds.includes(bird.typeId)
      &&(candidates[species.id]??[]).some(route=>route.version===version&&save.completed.includes(route.stage))){captureNeeded.add(species.id);targetCounts[species.id]=6-bird.compatibleOwned;}
  }
  function liveAncestor(id,seen=new Set()){
    if(seen.has(id))return false;seen.add(id);
    const parents=Object.values(data.species).filter(s=>s.evolutions.some(e=>e.to===id));
    return parents.some(s=>save.pokemon.some(p=>p.speciesId===s.id)||liveAncestor(s.id,seen));
  }
  function findCaptureAncestor(id,seen=new Set()){
    if(seen.has(id))return;seen.add(id);
    for(const parent of Object.values(data.species).filter(s=>s.evolutions.some(e=>e.to===id))){
      if((candidates[parent.id]??[]).some(c=>c.version===version))captureNeeded.add(parent.id);
      else findCaptureAncestor(parent.id,seen);
    }
  }
  for(const id of missing)if(!liveAncestor(id))findCaptureAncestor(id);

  for(const trade of TRADE_ROUTES)if(!known.has(trade.speciesId)&&!save.pokemon.some(p=>p.speciesId===trade.from)){
    captureNeeded.add(trade.from);if(!liveAncestor(trade.from))findCaptureAncestor(trade.from);
  }

  // These are replayable original popup trades, with actual party/deployment
  // requirements; the collection flag is deliberately omitted on these visits.
  for(const route of [...TRADE_ROUTES,...(commerce?[{speciesId:142,stage:32}]:[])]){
    if(known.has(route.speciesId)||!save.completed.includes(route.stage))continue;
    const level=game.levels.find(l=>l.id===route.stage);
    const predecessor=route.from&&save.pokemon.filter(p=>p.speciesId===route.from).sort((a,b)=>b.level-a.level||a.uid.localeCompare(b.uid))[0];
    if(route.from&&!predecessor)continue;
    const cut=route.stage===3&&save.pokemon.find(p=>p.moves.includes(224));
    if(route.stage===3&&!cut)continue;
    if(attempts.filter(a=>a.campaignId===route.stage&&a.purpose==='collection-story').length>=2)continue;
    return {kind:'story',stageId:level.id,level,campaignId:level.id,purpose:'collection-story',targetSpecies:[route.speciesId],
      partyOptions:{requiredUids:[predecessor?.uid,cut?.uid].filter(Boolean),paidMoves:false},requiredDeployUids:route.stage===36?[]:[predecessor?.uid].filter(Boolean),policyOptions:{capture:'new',training:false,relearn:false,paidHealing:false},
      reason:route.from?`Offer an actually owned ${data.species[route.from].name} through the original story trade`:'Replay Cinnabar Island with every candy retained for the original Aerodactyl reward'};
  }

  const playable=game.levels.filter(l=>l.id<=save.unlocked&&save.completed.includes(l.id)&&['defense','safari'].includes(l.mode)&&!l.nextStageClass);
  const catcher=save.pokemon.filter(p=>p.moves.includes(273)).sort((a,b)=>Number(b.speciesId===123&&b.level>=60)-Number(a.speciesId===123&&a.level>=60)||b.level-a.level||a.uid.localeCompare(b.uid))[0];
  const trainees=save.pokemon.map(p=>({p,e:neededEvolution(data,p,planningKnown(save))})).filter(({p,e})=>e?.level&&p.level<e.level&&p.moves.some(id=>data.moves[id]?.power>0)
      &&!(known.has(e.to)&&save.pokemon.some(other=>other.speciesId===e.to)))
    .sort((a,b)=>(a.e.level-a.p.level)-(b.e.level-b.p.level)||a.p.speciesId-b.p.speciesId||a.p.uid.localeCompare(b.p.uid));
  for(const bird of strictRewards?.birds??[])if(bird.missing&&bird.unlocked){
    for(const candidate of bird.trainingCandidates){
      const p=save.pokemon.find(p=>p.uid===candidate.uid);
      if(p&&!trainees.some(t=>t.p.uid===p.uid))trainees.push({p,e:{level:100,to:bird.speciesId}});
    }
  }
  const captureTrainee=!commerce&&[150,151].some(id=>missing.includes(id))&&save.completed.includes(42)
    ?save.pokemon.filter(p=>p.speciesId===123).sort((a,b)=>b.level-a.level||a.uid.localeCompare(b.uid))[0]:null;
  if(captureTrainee&&captureTrainee.level<90)trainees.unshift({p:captureTrainee,e:{level:90,to:123},purpose:'Prepare an earned X-Scissor/False Swipe catcher for the legendary encounters'});
  const visits=l=>attempts.filter(a=>(a.stage===l.className||a.campaignId===l.id)&&String(a.purpose??'').includes('collection'));
  const identifier=save.pokemon.filter(p=>p.moves.includes(227)||p.moves.includes(102)).sort((a,b)=>b.level-a.level||a.uid.localeCompare(b.uid))[0];
  const paralyzer=save.pokemon.filter(p=>p.moves.includes(23)).sort((a,b)=>b.level-a.level||a.uid.localeCompare(b.uid))[0];
  const growth=a=>{const value=a.collectionGained??a.dexGained;return Array.isArray(value)?value.length:typeof value==='number'?value:null;};
  const moneyVisit=reason=>{
    const ranked=playable.filter(l=>l.mode==='defense').map(level=>{
      const history=attempts.filter(a=>a.stage===level.className&&a.outcome==='won'&&a.stats?.earned>0);
      const ids=Object.entries(candidates).filter(([,rows])=>rows.some(r=>r.stage===level.id&&r.version===version)).map(([id])=>Number(id));
      const estimated=level.id===35?7.2:ids.length?ids.reduce((n,id)=>n+Math.min(200,data.species[id].reward),0)/ids.length/30:0;
      const rate=history.length?history.reduce((n,a)=>n+a.stats.earned/Math.max(1,a.frames),0)/history.length:estimated;
      return {level,rate};
    }).sort((a,b)=>b.rate-a.rate||a.level.id-b.level.id);
    const level=ranked[0]?.level;
    return level?{kind:'money',stageId:level.id,level,campaignId:level.id,purpose:'collection-money',targetSpecies:missing,partyOptions:{},policyOptions:{capture:'new',training:false,relearn:false},reason}:null;
  };
  const stoneNeeded=save.pokemon.some(p=>neededEvolution(data,p,known)?.itemId);
  const minimumCash=(save.completed.includes(17)?0:20000)+Math.max(stoneNeeded?10000:trainees.length?2500:1000,porygon&&missing.includes(137)?5500:0);
  if(save.money<minimumCash){const plan=moneyVisit(stoneNeeded?'Earn the actual money required for a missing stone evolution':'Fund training and collection actions without spending the field-move reserve');if(plan)return plan;}
  const captures=playable.map(level=>{
    const ids=[...captureNeeded].filter(id=>(candidates[id]??[]).some(c=>c.stage===level.id&&c.version===version));
    const previous=visits(level),recent=previous.slice(-3);
    // Native Ghost encounters need an identifying support action before
    // False Swipe. Two losses block a route until a different strategy exists.
    const unsupportedGhost=level.id===22&&!identifier;
    const repeatedLosses=previous.slice(-2).length===2&&previous.slice(-2).every(a=>a.outcome==='lost'||a.outcome==='error');
    const stalled=recent.length===3&&recent.every(a=>growth(a)!==null?growth(a)===0:!a.stats?.captured);
    const stagnantLimit=ids.some(id=>id===150||id===151||(!commerce&&id===143))?150:level.mode==='safari'?20:3;
    const stagnant=previous.slice(-stagnantLimit).length===stagnantLimit&&previous.slice(-stagnantLimit).every(a=>growth(a)===0);
    // A failed capture strategy should lose priority, while rare visit tables
    // can still be revisited after other species have been covered.
    const score=ids.length*100/(1+previous.length*.3)/(stalled?4:1)/Math.max(1,Math.sqrt((level.totalWaves??1)/20));
    return {level,ids,score,previous,blocked:unsupportedGhost||repeatedLosses||stagnant||(commerce&&level.id===23)};
  }).filter(p=>p.ids.length&&!p.blocked).sort((a,b)=>b.score-a.score||a.level.id-b.level.id);
  const trainingSince=attempts.slice(-3).some(a=>a.purpose==='collection-training');
  const rareEncountersOnly=captures.length&&captures.every(plan=>plan.ids.every(id=>[113,115,128,150,151].includes(id)));
  if(trainees.length&&(preferTraining||!captures.length||rareEncountersOnly||(!trainingSince&&attempts.filter(a=>String(a.purpose??'').includes('collection')).length%3===2))){
    const selected=trainees.slice(0,1),targetLevel=Math.max(...selected.map(t=>t.p.level));
    const levels=playable.filter(l=>l.mode==='defense'&&!l.requiresPartySurvival&&![11,14].includes(l.id));
    const ranked=levels.map(level=>{
      const observed=Object.values(candidates).flatMap(c=>c.filter(c=>c.stage===level.id&&c.version===version));
      const enemyLevel=observed.length?observed.reduce((n,c)=>n+c.level,0)/observed.length:level.bonusLevel;
      const successful=attempts.some(a=>a.stage===level.className&&a.outcome==='won');
      // A moderate level gap lets trainees land attacks while support handles
      // the wave. Experience must still be earned by actual contributions.
      return {level,score:(level.id===19?-1000:0)+Math.abs(enemyLevel-(targetLevel+12))+(successful?0:30)+(level.totalWaves>40?5:0)};
    }).sort((a,b)=>a.score-b.score||a.level.id-b.level.id);
    if(ranked[0])return {kind:'training',stageId:ranked[0].level.id,level:ranked[0].level,campaignId:ranked[0].level.id,purpose:'collection-training',
      targetSpecies:selected.map(t=>t.e.to),trainUids:selected.map(t=>t.p.uid),partyOptions:{requiredUids:selected.map(t=>t.p.uid)},
      policyOptions:{capture:'new',training:true,relearn:false,trainingUids:selected.map(t=>t.p.uid),targetLevel:Math.max(...selected.map(t=>t.e.level))},reason:selected[0].purpose??'Earn actual contributor XP for missing evolutions or legendary quest prerequisites'};
  }
  if(captures[0]){
    const {level,ids}=captures[0];
    const support=level.id===22?identifier:level.id===42?paralyzer:null;
    const supportMove=level.id===42?23:identifier?.moves.includes(227)?227:102;
    return {kind:'capture',stageId:level.id,level,campaignId:level.id,purpose:'collection-capture',targetSpecies:ids,
      partyOptions:catcher&&level.mode!=='safari'?{requiredUids:[catcher.uid,...(support?[support.uid]:[])]}:{},
      policyOptions:level.mode==='safari'?{capture:'all',training:false,relearn:false,targetSpecies:ids,targetCounts}:{collection:true,capture:'all',training:false,relearn:false,targetSpecies:ids,targetCounts,maxCollectionCaptures:level.id===42?1000:250,...(catcher?{captureUid:catcher.uid,captureMove:273}:{}),...(support?{identifyUid:support.uid,identifyMove:supportMove}:{})},
      reason:`Missing encounters in ${version===2?'Blue':'Red'}: ${ids.map(id=>data.species[id].name).join(', ')}`};
  }
  // Currency can fund missing species through real Game Corner/egg actions.
  return (commerce&&moneyVisit('Earn currency for missing species without advancing daily timers'))||{kind:'blocked',targetSpecies:missing,reason:'No remaining supported encounter, story reward, evolution or training route is available under these run rules'};
}

export function createCollectionPlanner(data, save, {onAction=()=>{}, rng=Math.random, bank=null, clock=()=>Date.now(), reserveMoney=20000,commerce=true,starter,corner='off'}={}) {
  // The caller's existing profile is the only primary profile. Auxiliary
  // profiles are created later through the real createProfile action.
  const initial=bank ? clone(bank) : {version:1,active:0,slots:[clone(save),null,null],updatedAt:new Date(clock()).toISOString()};
  const primarySlot=0;
  const originalStarter=starter??bank?.botCollection?.starter??[1,4,7].find(id=>save.pokemon.some(p=>p.speciesId>=id&&p.speciesId<=id+2))??1;
  if(!initial.slots?.[primarySlot]) throw new Error('Collection checkpoint must contain primary profile slot 0');
  initial.slots[primarySlot]=clone(save);
  const values=new Map([[PROFILE_BANK_KEY,JSON.stringify(initial)]]);
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const profiles=new LocalProfiles(data,storage,null,{eventTarget:null,locks:null,indexedDB:null});
  const service=new CenterService(data,profiles,{clock,rng});
  let ready=null, busy=false,pendingPlan=null;
  // Earlier visits lacked targeted legendary control and Safari bait/rock
  // handling. Their historical failures remain in reports but do not
  // permanently block a substantially different capture strategy.
  const visitHistory=clone(bank?.botCollection?.version===COLLECTION_STRATEGY_VERSION?bank.botCollection.visits??[]:[]);
  const report=(action,detail={})=>onAction({action,...detail});
  const mirror=()=>Object.assign(save,clone(profiles.bank.slots[primarySlot]));
  async function initialize(){
    if(!ready) ready=(async()=>{await profiles.initialize();await service.initialize();mirror();})();
    await ready;
  }
  async function savePrimary(){
    profiles.bank.slots[primarySlot]=clone(save);
    await profiles.write();
  }
  async function perform(action,payload={}){
    const porygon=CORNER_REWARDS.find(row=>row.speciesId===137&&row.variant==='regular');
    const earnedPrize=!commerce&&corner==='porygon'&&service.active===primarySlot&&!owned().has(137)
      &&((action==='buyReward'&&payload.id===porygon.id)||(action==='exchangeCoins'&&payload.amount===Math.max(0,porygon.cost-service.wallet.casino)));
    if(!commerce&&!earnedPrize&&!['selectProfile','createProfile','createListing','recallListing','claim'].includes(action)) throw new Error(`Starter-and-captures rules forbid Center action ${action}`);
    const before={slot:service.active,credits:service.wallet.credits,casino:service.wallet.casino,money:service.profile?.money};
    const result=await service.perform(action,payload);
    mirror();
    report(`center-${action}`,{payload,before,after:{slot:service.active,credits:service.wallet.credits,casino:service.wallet.casino,money:service.profile?.money},pokemon:entity(result.pokemon),listing:result.listing?{id:result.listing.id,owner:result.listing.owner,pokemon:entity(result.listing.pokemon)}:undefined,reward:result.reward});
    return result;
  }
  async function select(slot){if(service.active!==slot)await perform('selectProfile',{slot});}
  async function collect(slot=primarySlot){
    const ids=service.state.inbox.filter(row=>row.owner===service.active).map(row=>row.id);
    if(ids.length)await perform('claim',{ids,slot});
  }
  async function daily(slot){
    await select(slot);
    const day=new Date(clock()).toISOString().slice(0,10);
    if(service.wallet.freeDay<day)await perform('dailyCredits');
  }
  async function adopt(row){await perform('adopt',{id:row.id});await collect();}
  async function transaction(action,mutator,details={}){
    const {result}=await profiles.transact(mutator);mirror();report(action,{...details,result});return result;
  }
  async function exclusive(fn){
    if(busy)throw new Error('Collection planner operation already in progress');
    busy=true;
    try{await initialize();await savePrimary();const result=await fn();await select(primarySlot);return result;}
    finally{busy=false;}
  }
  function owned(){return new Set(FORMS.flatMap(form=>save.dex?.[form]??[]));}
  function targets(){
    const acquired=owned();
    const active=save.pokemon;
    return ALL.filter(id=>!acquired.has(id)).map(speciesId=>{
      const evolutions=Object.values(data.species).flatMap(s=>(s.evolutions??[]).filter(e=>e.to===speciesId).map(e=>({from:s.id,...e})));
      const evolution=evolutions.find(e=>active.some(p=>p.speciesId===e.from));
      const routes=[...new Map((candidates[speciesId]??[]).map(c=>[`${c.stage}:${c.version}`,{stage:c.stage,version:c.version,waveClass:c.waveClass}])).values()];
      return {speciesId,name:data.species[speciesId].name,evolution,trainable:!!evolution?.level,
        routes,shop:CORNER_REWARDS.find(r=>r.speciesId===speciesId&&r.variant==='regular')?.id,
        adoption:ADOPTION_CATALOG.find(r=>r.speciesId===speciesId&&r.category==='battle')?.id};
    });
  }
  function auxiliaryPlan({excludeSlots=[]}={}){
    const bank=profiles.bank??initial,day=new Date(clock()).toISOString().slice(0,10);
    for(const slot of [1,2]){
      if(excludeSlots.includes(slot))continue;
      const profile=bank.slots[slot];if(!profile)continue;
      const targetSpecies=targets().filter(t=>t.routes.some(r=>r.version===profile.gameVersion&&typeof r.stage==='number'&&(commerce?r.stage<=9:true))&&!t.routes.some(r=>r.version===(save.gameVersion??1))&&(commerce||!hasOwnedPredecessor(data,save,t.speciesId))).map(t=>t.speciesId);
      if(!commerce){
        if(profile.gameVersion===(save.gameVersion??1))continue;
        const starters=profile.pokemon.filter(p=>p.speciesId>=1&&p.speciesId<=9&&neededEvolution(data,p,owned()));
        const hitmon=profile.gameVersion===2?107:106;
        if(!owned().has(hitmon))targetSpecies.push(hitmon);
        const through=Math.max(targetSpecies.includes(hitmon)?26:11,...targets().filter(t=>targetSpecies.includes(t.speciesId)&&t.routes.some(r=>r.version===profile.gameVersion&&typeof r.stage==='number')).map(t=>Math.min(...t.routes.filter(r=>r.version===profile.gameVersion&&typeof r.stage==='number').map(r=>r.stage))));
        if(targetSpecies.length||starters.length)return {slot,version:profile.gameVersion,through,targetSpecies:[...new Set([...targetSpecies,...starters.map(p=>p.speciesId)])],reason:'Progress this version from its own starter for wild exclusives and earned starter evolutions'};
        continue;
      }
      const unclaimed=(bank.center?.wallets?.[slot]?.freeDay??'')<day;
      if(targetSpecies.length||unclaimed&&(profile.badges??0)<2)return {slot,version:profile.gameVersion,through:11,targetSpecies,
        reason:targetSpecies.length?'Play the existing Blue profile for early version-exclusive captures and genuinely earned badge credits.':'Earn the second auxiliary profile’s first two badges before claiming its available daily credits.'};
    }
    return null;
  }
  async function moveOwned(uid,from,to){
    await select(from);
    const listed=await perform('createListing',{uid,price:0});
    await perform('recallListing',{id:listed.listing.id});
    const pickup=service.state.inbox.find(row=>row.owner===from&&row.pokemon.uid===uid);
    if(!pickup)throw new Error(`Recalled Pokémon ${uid} did not reach its owner's inbox`);
    await perform('claim',{ids:[pickup.id],slot:to});
  }
  /** Execute ordinary gameplay on an existing auxiliary profile. Every loan
   * and return uses a real listing, recall, and cross-profile inbox pickup.
   * The callback owns the auxiliary save object until it resolves; do not run
   * a second collection planner against that same bank during the callback.
   */
  async function withAuxiliary(slot,callback,{neededSpecies=auxiliaryPlan()?.targetSpecies??[]}={}){return exclusive(async()=>{
    if(slot===primarySlot||!profiles.bank.slots[slot])throw new Error('Choose an existing auxiliary profile');
    if(typeof callback!=='function')throw new Error('Auxiliary gameplay callback is required');
    const beforeUids=new Set(profiles.bank.slots[slot].pokemon.map(p=>p.uid));
    const catcher=save.pokemon.filter(p=>p.moves.includes(273)).sort((a,b)=>Number(b.speciesId===123&&b.level>=60)-Number(a.speciesId===123&&a.level>=60)||b.level-a.level||a.uid.localeCompare(b.uid))[0];
    const fighters=[...save.pokemon].sort((a,b)=>{
      const score=p=>p.level+(PRIORITY.slice(0,6).includes(p.speciesId)?1000:0);
      return score(b)-score(a)||a.uid.localeCompare(b.uid);
    });
    const loanUids=commerce?[...new Set([catcher?.uid,...fighters.map(p=>p.uid)].filter(Boolean))].slice(0,6):[];
    const originalParty=[...save.party];
    for(const uid of loanUids)await moveOwned(uid,primarySlot,slot);
    await select(slot);
    const auxiliarySave=clone(service.profile);
    let result,failure;
    report('auxiliary-trip-start',{slot,version:auxiliarySave.gameVersion,neededSpecies,loanUids});
    try{result=await callback(auxiliarySave,{slot,neededSpecies,through:commerce?11:auxiliaryPlan({excludeSlots:[1,2].filter(other=>other!==slot)})?.through??11,loanUids,captureUid:commerce?catcher?.uid:undefined,checkpoint:()=>{
      const checkpoint=clone(profiles.bank);checkpoint.slots[slot]=clone(auxiliarySave);syncCenterDex(checkpoint);return checkpoint;
    }});}catch(error){failure=error;}
    await transaction('auxiliary-gameplay-save',draft=>{draft.slots[slot]=clone(auxiliarySave);syncCenterDex(draft);return {ok:true,slot,completed:[...auxiliarySave.completed],owned:auxiliarySave.pokemon.length};},{slot});
    const returned=[];
    const auxiliaryRoster=profiles.bank.slots[slot].pokemon;
    const candidatesToReturn=auxiliaryRoster.filter(p=>!loanUids.includes(p.uid)&&(commerce?!beforeUids.has(p.uid)&&neededSpecies.includes(p.speciesId):neededSpecies.includes(p.speciesId)||neededEvolution(data,p,owned())));
    const acquired=commerce?candidatesToReturn:candidatesToReturn.slice(0,Math.max(0,auxiliaryRoster.length-1));
    for(const uid of [...loanUids,...acquired.map(p=>p.uid)])if(profiles.bank.slots[slot].pokemon.some(p=>p.uid===uid)){await moveOwned(uid,slot,primarySlot);returned.push(uid);}
    await transaction('restore-primary-party',draft=>{const primary=draft.slots[primarySlot];primary.party=originalParty.map(uid=>primary.pokemon.some(p=>p.uid===uid)?uid:null);return {ok:true,party:[...primary.party]};});
    await select(primarySlot);
    report('auxiliary-trip-finish',{slot,neededSpecies,loanUids,returned,acquired:acquired.map(entity),completed:[...profiles.bank.slots[slot].completed],error:failure?.message});
    if(failure)throw failure;
    return {slot,neededSpecies,loanUids,returned,acquired:acquired.map(entity),result};
  });}
  async function prepare(){return exclusive(async()=>{
    if(!commerce)return {roster:save.pokemon.map(entity),preferredSpecies:[],targets:targets(),rules:'starter-and-captures'};
    await daily(primarySlot);
    for(const speciesId of PRIORITY){
      if(save.pokemon.some(p=>p.speciesId===speciesId&&p.level>=80))continue;
      const row=ADOPTION_CATALOG.find(r=>r.category==='battle'&&r.speciesId===speciesId);
      if(row&&service.wallet.credits>=row.cost)await adopt(row);
    }
    const starter=save.pokemon.find(p=>[1,4,7].includes(p.speciesId))?.speciesId??1;
    const others=[1,4,7].filter(id=>id!==starter);
    for(let i=1;i<=2;i++)if(!profiles.bank.slots[i]){
      await perform('createProfile',{slot:i,starter:others[i-1],trainer:`Bot Partner ${i}`,gameVersion:i===1?2:1});
    }
    // Local trades exchange ownership; donor starters are not copied or
    // directly transferred. The recipient always gives an owned Pokémon.
    for(let slot=1;slot<=2;slot++){
      const partner=profiles.bank.slots[slot];
      const starterPokemon=partner.pokemon.find(p=>[1,4,7].includes(p.speciesId)&&!save.pokemon.some(q=>q.speciesId===p.speciesId));
      const offer=[...save.pokemon].reverse().find(p=>p.level>=80&&!save.party.includes(p.uid)&&![...PRIORITY.slice(0,6),123].includes(p.speciesId));
      if(starterPokemon&&offer)await transaction('local-trade',draft=>tradePokemon(data,draft.slots[primarySlot],offer.uid,draft.slots[slot],starterPokemon.uid),{partner:slot,offered:entity(offer),requested:entity(starterPokemon)});
    }
    return {roster:save.pokemon.map(entity),preferredSpecies:PRIORITY.slice(0,6),targets:targets()};
  });}
  async function step({buyCollection=true,evolve=true,train=true,gifts=true,maxEggs=1}={}){return exclusive(async()=>{
    if(!commerce){
      buyCollection=false;gifts=false;
      const others=[1,4,7].filter(id=>id!==originalStarter);
      for(let slot=1;slot<=2;slot++)if(!profiles.bank.slots[slot])await perform('createProfile',{slot,starter:others[slot-1],trainer:`Bot Partner ${slot}`,gameVersion:slot===1?2:1});
      await select(primarySlot);
      for(let slot=1;slot<=2;slot++){
        const partner=profiles.bank.slots[slot];
        if(partner.gameVersion!==(save.gameVersion??1))continue;
        const partnerStarter=partner.pokemon.find(p=>[1,4,7].includes(p.speciesId)&&neededEvolution(data,p,owned()));
        const offer=save.pokemon.filter(p=>!save.party.includes(p.uid)&&save.pokemon.filter(q=>q.speciesId===p.speciesId).length>1)
          .sort((a,b)=>a.level-b.level||a.uid.localeCompare(b.uid))[0];
        if(partnerStarter&&offer)await transaction('local-trade',draft=>tradePokemon(data,draft.slots[primarySlot],offer.uid,draft.slots[slot],partnerStarter.uid),{partner:slot,offered:entity(offer),requested:entity(partnerStarter)});
      }
      if(corner==='porygon'&&!owned().has(137)&&save.completed.includes(19)){
        const row=CORNER_REWARDS.find(row=>row.speciesId===137&&row.variant==='regular');
        const needed=Math.max(0,row.cost-service.wallet.casino),reserve=save.completed.includes(17)?0:20000;
        if(save.money-reserve>=needed){
          if(needed)await perform('exchangeCoins',{amount:needed});
          await perform('buyReward',{id:row.id});await collect();
        }
      }
      for(const id of [1,2,3,6]){
        const speciesId={1:95,2:120,3:72,6:save.originalExtraInfo?.includes(30)?106:107}[id];
        const status=achievementStatus(save,id);
        if(!owned().has(speciesId)&&save.challengeCompleted>=3&&status.earned&&!status.claimed)
          await transaction('collection-earned-achievement',draft=>claimAchievement(data,draft.slots[primarySlot],id),{id,speciesId});
      }
    }
    if(save.pokemon.length>250)await transaction('release-collection-duplicates',draft=>{
      const primary=draft.slots[0],keep=new Set(primary.party.filter(Boolean)),groups=new Map();
      for(const p of primary.pokemon){const key=`${p.speciesId}:${p.shiny}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}
      for(const group of groups.values()){
        group.sort((a,b)=>b.level-a.level||b.experience-a.experience||a.uid.localeCompare(b.uid));
        for(const p of group.slice(0,group[0].speciesId===133?3:2))keep.add(p.uid);
      }
      if(!commerce)for(const bird of strictRewardEligibility({data},primary).birds)if(bird.missing){
        const partners=primary.pokemon.filter(p=>data.species[p.speciesId].typeIds.includes(bird.typeId)).sort((a,b)=>b.level-a.level||b.experience-a.experience||a.uid.localeCompare(b.uid));
        for(const partner of partners.slice(0,6))keep.add(partner.uid);
      }
      for(const move of [224,225,273,227,102]){const p=primary.pokemon.filter(p=>p.moves.includes(move)).sort((a,b)=>b.level-a.level||a.uid.localeCompare(b.uid))[0];if(p)keep.add(p.uid);}
      const released=[];for(const p of [...primary.pokemon])if(!keep.has(p.uid)){const result=releasePokemon(primary,p.uid);if(result.ok)released.push(p.uid);}
      return {ok:true,released,count:released.length,retained:primary.pokemon.length};
    });
    // An early claim consumes the whole day's opportunity, including later
    // badges. Two ordinary early-campaign badges make each auxiliary's first
    // claim worth twenty credits and fund the otherwise inaccessible rewards.
    if(commerce)for(let slot=0;slot<3;slot++)if(profiles.bank.slots[slot]&&(slot===0||(profiles.bank.slots[slot].badges??0)>=2))await daily(slot);
    const reserve=save.completed.includes(17)?0:Math.max(reserveMoney,20000);
    if(gifts){
      for(let slot=0;slot<3;slot++)if(profiles.bank.slots[slot]){
        await select(slot);
        if(!owned().has(25)&&!service.wallet.giftCodes.includes('ptd-local')){await perform('giftCode',{code:'ptd-local'});await collect();}
        const time=clock(),day=new Date(time).toISOString().slice(0,10),offset=(new Date(time).getUTCDay()+6)%7,week=new Date(time-offset*86400000).toISOString().slice(0,10);
        for(const [kind,key,stamp]of [['daily','mysteryDaily',day],['weekly','mysteryWeekly',week]])if(service.wallet[key]<stamp&&owned().size<151){await perform('mysteryGift',{kind});await collect();}
      }
    }
    // Guaranteed coin purchases come first so an affordable Pinsir/Abra does
    // not consume credits reserved for birds and inaccessible story rewards.
    await select(primarySlot);
    if(buyCollection){
      for(const id of [63,127,137,147]){
        const needsTradeAbra=id===63&&!owned().has(122)&&!save.pokemon.some(p=>p.speciesId===63);
        if(owned().has(id)&&!needsTradeAbra)continue;
        const row=CORNER_REWARDS.find(r=>r.speciesId===id&&r.variant==='regular');
        const needed=Math.max(0,row.cost-service.wallet.casino);
        if(save.money-reserve<needed)continue;
        if(needed)await perform('exchangeCoins',{amount:needed});
        await perform('buyReward',{id:row.id});await collect();
      }
    }
    // Preserve scarce credits for a capture specialist and species without
    // ordinary same-version encounter routes, before buying common evolutions.
    if(buyCollection){
      const priorities=[123,92,143,144,145,146,37,126,127,106,107,138,140,142,122,124,108,83];
      for(const speciesId of priorities){
        if(speciesId===123?save.pokemon.some(p=>p.speciesId===123):owned().has(speciesId))continue;
        const row=ADOPTION_CATALOG.filter(r=>r.speciesId===speciesId).sort((a,b)=>a.cost-b.cost||(a.variant==='regular'?-1:1))[0];
        if(!row)continue;
        const slot=profiles.bank.slots.findIndex((p,i)=>p&&service.state.wallets[i].credits>=row.cost);
        if(slot<0)continue;await select(slot);await adopt(row);
      }
    }
    await select(primarySlot);
    {
      const catcher=save.pokemon.find(p=>p.speciesId===123&&p.level>=13)??save.pokemon.find(p=>data.species[p.speciesId].learnset.some(e=>e.moveId===273&&e.level<=p.level));
      if(catcher&&!catcher.moves.includes(273)&&save.money-reserve>=1000){
        await transaction('learn-capture-move',draft=>teachMove(data,draft.slots[0],draft.slots[0].pokemon.find(p=>p.uid===catcher.uid),273,3,'relearn'),{uid:catcher.uid,moveId:273});
      }
      if(catcher?.speciesId===123&&catcher.level>=41&&!catcher.moves.includes(268)&&save.money-reserve>=1000){
        const slot=catcher.moves.findIndex(id=>id!==273);
        await transaction('learn-capture-damage',draft=>teachMove(data,draft.slots[0],draft.slots[0].pokemon.find(p=>p.uid===catcher.uid),268,Math.max(0,slot),'relearn'),{uid:catcher.uid,moveId:268});
      }
      // Paid eggs are bounded actual purchases, never RNG probes or rerolls.
      // Use them only for gaps unavailable through the current version's wild
      // tables and presently owned evolution chains.
      // Route 12's giant Snorlax is not capturable; the separate level-40
      // encounter has a 1/1000 side-spawn chance and is not a reliable route.
      const unresolved=targets().filter(t=>!hasOwnedPredecessor(data,save,t.speciesId)&&!t.routes.some(r=>r.version===(save.gameVersion??1)&&r.stage!==23));
      const egg=CORNER_REWARDS.find(r=>r.id==='corner-13');
      const today=new Date(clock()).toISOString().slice(0,10);
      const pendingBadgeCredits=profiles.bank.slots.some((p,slot)=>slot!==primarySlot&&p&&service.state.wallets[slot].freeDay<today&&(p.badges??0)<2);
      if(buyCollection&&unresolved.length&&!pendingBadgeCredits)for(let n=0;n<maxEggs;n++){
        const needed=Math.max(0,egg.cost-service.wallet.casino);
        if(save.money-reserve<needed)break;
        if(needed)await perform('exchangeCoins',{amount:needed});
        await perform('buyReward',{id:egg.id});await collect();
      }
    }
    if(!owned().has(92)||!owned().has(93)){
      const identifier=save.pokemon.find(p=>p.moves.includes(227)||p.moves.includes(102));
      const learner=!identifier&&save.pokemon.filter(p=>data.species[p.speciesId].learnset.some(e=>[227,102].includes(e.moveId)&&e.level<=p.level)).sort((a,b)=>b.level-a.level)[0];
      if(learner&&save.money-reserve>=1000){
        const moveId=data.species[learner.speciesId].learnset.find(e=>[227,102].includes(e.moveId)&&e.level<=learner.level).moveId;
        await transaction('learn-ghost-identification',draft=>teachMove(data,draft.slots[0],draft.slots[0].pokemon.find(p=>p.uid===learner.uid),moveId,3,'relearn'),{uid:learner.uid,moveId});
      }
    }
    if((!owned().has(150)||!owned().has(151))&&!save.pokemon.some(p=>p.moves.includes(23))&&save.money-reserve>=1000){
      const paralyzer=save.pokemon.filter(p=>data.species[p.speciesId].learnset.some(e=>e.moveId===23&&e.level<=p.level)).sort((a,b)=>b.level-a.level||a.uid.localeCompare(b.uid))[0];
      if(paralyzer)await transaction('learn-capture-paralysis',draft=>teachMove(data,draft.slots[0],draft.slots[0].pokemon.find(p=>p.uid===paralyzer.uid),23,3,'relearn'),{uid:paralyzer.uid,moveId:23});
    }
    if(!owned().has(122)&&save.completed.includes(16)&&!save.pokemon.some(p=>p.moves.includes(224))&&save.money-reserve>=10000){
      const cut=save.pokemon.filter(p=>data.species[p.speciesId].tmMoveIds.includes(224)).sort((a,b)=>Number(save.party.includes(a.uid))-Number(save.party.includes(b.uid))||b.level-a.level||a.uid.localeCompare(b.uid))[0];
      if(cut)await transaction('learn-story-cut',draft=>teachMove(data,draft.slots[0],draft.slots[0].pokemon.find(p=>p.uid===cut.uid),224,3,'tm'),{uid:cut.uid,moveId:224});
    }
    // Dragon Tail pushes targets away before a downstream support attacker
    // defeats them. A real relearn of Slam/Twister gives this evolution chain
    // reliable contributor damage instead of repeating an unchanged visit.
    if(train){
      const dragon=save.pokemon.filter(p=>[147,148].includes(p.speciesId)&&neededEvolution(data,p,owned())?.level>p.level).sort((a,b)=>b.level-a.level||a.uid.localeCompare(b.uid))[0];
      const moveId=dragon&&(dragon.level>=21?125:77);
      if(dragon&&!dragon.moves.includes(moveId)&&data.species[dragon.speciesId].learnset.some(e=>e.moveId===moveId&&e.level<=dragon.level)&&save.money-reserve>=1000){
        await transaction('learn-contributor-move',draft=>teachMove(data,draft.slots[0],draft.slots[0].pokemon.find(p=>p.uid===dragon.uid),moveId,3,'relearn'),{uid:dragon.uid,moveId});
      }
    }
    if(train||evolve){
      await transaction('collection-evolution-pass',draft=>{
        const primary=draft.slots[primarySlot],changes=[];
        const known=()=>planningKnown(primary);
        for(const p of primary.pokemon){
          recordOwned(primary,p);
          let desired=neededEvolution(data,p,known());
          if(!desired)continue;
          if(train&&desired.level){
            while(p.level<desired.level&&p.experience>=xpRequired(p.level)&&primary.money-reserve>=levelCost(p.level)){
              const from=p.level;if(!trainPokemon(primary,p,data))break;changes.push({action:'train',uid:p.uid,from,to:p.level});
            }
          }
          while(evolve&&desired?.level&&p.level>=desired.level){
            const from=p.speciesId;if(!evolvePokemon(p,data))break;recordOwned(primary,p);changes.push({action:'evolve',uid:p.uid,from,to:p.speciesId});
            desired=neededEvolution(data,p,known());
          }
          if(evolve&&desired?.itemId){
            if(!primary.inventory?.[desired.itemId]&&primary.money-reserve>=10000){
              const purchase=buyItem(primary,desired.itemId);if(purchase.ok)changes.push({action:'buy-stone',itemId:desired.itemId,cost:10000});
            }
            if(primary.inventory?.[desired.itemId]){const from=p.speciesId,result=useEvolutionItem(data,primary,p,desired.itemId);if(result.ok)changes.push({action:'evolve-item',uid:p.uid,from,to:p.speciesId,itemId:desired.itemId});}
          }
        }
        syncCenterDex(draft);return {ok:true,changes};
      });
      // Trade evolutions are explicit game actions, outside the species table.
      for(const from of [64,67,75,93]){
        if(owned().has(from+1))continue;
        const pokemon=save.pokemon.find(p=>p.speciesId===from),partner=profiles.bank.slots[1];
        if(!pokemon||!partner?.pokemon.length)continue;
        const other=partner.pokemon[0];
        await transaction('local-trade-evolution',draft=>tradePokemon(data,draft.slots[0],pokemon.uid,draft.slots[1],other.uid),{partner:1,offered:entity(pokemon),requested:entity(other)});
        await transaction('local-trade-return',draft=>tradePokemon(data,draft.slots[0],other.uid,draft.slots[1],pokemon.uid),{partner:1,returnUid:pokemon.uid});
      }
    }
    return {remaining:targets(),owned:owned().size,roster:save.pokemon.map(entity)};
  });}
  return {prepare,step,targets,auxiliaryPlan,withAuxiliary,bestNextVisit(game,attempts=[],options={}){
    if(pendingPlan&&attempts.length>pendingPlan.attempts){
      const actual=attempts.at(-1);
      visitHistory.push({stage:actual.stage,campaignId:actual.campaignId,purpose:actual.purpose,outcome:actual.outcome,frames:actual.frames,stats:clone(actual.stats??{}),dexGained:Math.max(0,owned().size-pendingPlan.owned),collectionGained:Math.max(0,owned().size-pendingPlan.owned)+save.pokemon.filter(p=>!pendingPlan.uids.includes(p.uid)&&pendingPlan.targets.includes(p.speciesId)).length,targetSpecies:pendingPlan.targets});
      if(visitHistory.length>2000)visitHistory.shift();
    }
    const plan=bestNextVisit(game,save,[...attempts.filter(a=>!String(a.purpose??'').includes('collection')),...visitHistory],{...options,commerce,porygon:corner==='porygon'});
    pendingPlan=plan?{attempts:attempts.length,owned:owned().size,uids:save.pokemon.map(p=>p.uid),targets:plan.targetSpecies}:null;
    return plan;
  },get bank(){const checkpoint=clone(profiles.bank??initial);checkpoint.slots[primarySlot]=clone(save);syncCenterDex(checkpoint);checkpoint.botCollection={version:COLLECTION_STRATEGY_VERSION,commerce,corner,starter:originalStarter,visits:clone(visitHistory)};return checkpoint;},get preferredSpecies(){return commerce?PRIORITY.slice(0,6):[];},get service(){return service;},dispose(){profiles.dispose();}};
}
