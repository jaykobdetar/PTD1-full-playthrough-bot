#!/usr/bin/env node
import {mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync, readdirSync} from 'node:fs';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {newSave} from '../../src/model.js';
import {RockTunnel, teachFieldMove, partyHasFlash} from '../../src/rock-tunnel.js';
import {loadGame, deterministicEnvironment, reserveIdentityRange, random, fingerprint, digest, coverage, makeBattle, snapshot, assertBattle, checkSave, BOT_VERSION} from './runtime.mjs';
import {createPolicy, prepareParty} from './policy.mjs';
import {resolveIntro, resolveWin, nextTunnelAction} from './story.mjs';
import {createCollectionPlanner,auxiliaryCapturePlan} from './collection.mjs';

const defaults = {seed:1, starter:1, through:42, mode:'all', center:'trades', corner:'earned', maxAttempts:12, grind:3, maxBattles:1500, maxTicks:100000, dexVisits:250};
const help = `Deterministic PTD player — runs the original native rules at 21 logical ticks/s.
Usage: npm run bot -- [options]
  --seed N             Random seed (default 1)
  --starter 1|4|7      Start with Bulbasaur, Charmander or Squirtle
  --through N          Campaign stopping point, 1–42 (default 42)
  --mode all|campaign|challenges|collection
  --center trades|off|on
                       trades: earned teams and local trades (default)
                       off: no Center account; on: assisted adoptions/gifts
  --corner earned|off  In trades mode, allow only the level-1 Porygon prize
                       paid with battle earnings (default earned)
  --max-attempts N     Retries per objective (default 12)
  --grind N            Earn XP in cleared stages between retries (default 3)
  --max-battles N      Total visit budget (default 1500)
  --max-ticks N        Logical tick budget per battle (default 100000)
  --dex-visits N       Collection visit budget after campaign (default 250)
  --out PATH           New output directory (default artifacts/bot/<run>)
  --replay REPORT      Re-run recorded configuration and compare outcome hash
  --resume REPORT      Continue that run's final save; records inherited coverage
  --checkpoint PATH    With --resume, restart from a recorded pre-battle save
Exit: 0 requested scope complete, 2 incomplete/blocked, 1 tool/configuration error.
Artifacts: report.json, BUGS.md, actions.jsonl, events.jsonl, checkpoints/, final-save.json.
No browser or existing user saves are read or written. Calendar gifts are not fast-forwarded.
`;
function parse(args) {
  const options = {...defaults};
  const mapping = {'max-attempts':'maxAttempts','max-battles':'maxBattles','max-ticks':'maxTicks','dex-visits':'dexVisits'};
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--help' || args[i]==='-h') { console.log(help); process.exit(0); }
    const key = args[i].slice(2), name=mapping[key] ?? key;
    if(!args[i].startsWith('--') || ![...Object.keys(defaults),'out','replay','resume','checkpoint'].includes(name)) throw new Error(`Unknown option ${args[i]}`);
    if(args[i+1]===undefined || args[i+1].startsWith('--')) throw new Error(`Missing value for ${args[i]}`);
    options[name] = typeof defaults[name]==='number' ? Number(args[++i]) : args[++i];
  }
  for(const key of Object.keys(defaults).filter(key=>typeof defaults[key]==='number')) if(!Number.isSafeInteger(options[key]) || options[key] < (['seed','grind','dexVisits'].includes(key) ? 0 : 1)) throw new Error(`Invalid ${key}`);
  if(options.seed>0xffffffff || ![1,4,7].includes(options.starter) || options.through>42 || !['all','campaign','challenges','collection'].includes(options.mode) || !['on','off','trades'].includes(options.center)||!['earned','off'].includes(options.corner)) throw new Error('Invalid seed, starter, mode, Center choice or campaign range');
  if(options.replay && options.resume) throw new Error('Choose either replay or resume');
  if(options.checkpoint && !options.resume) throw new Error('--checkpoint requires --resume so coverage provenance is retained');
  return options;
}
function errorDetails(error) { return {message:error.message ?? String(error), stack:error.stack,diagnostic:error.diagnostic}; }
function entity(p) { return p ? {uid:p.uid,speciesId:p.speciesId,level:p.level,shiny:p.shiny} : undefined; }
const ownedIds=save=>new Set(['normal','shiny','shadow'].flatMap(form=>save.dex?.[form] ?? []));

export class Runner {
  constructor(game, save, config, out, inherited=null) {
    this.game=game; this.save=save; this.config=config; this.out=out; this.rng=random(config.seed ^ 0x9e3779b9);
    this.attempts=[]; this.auxiliary=[]; this.navigation=[]; this.issues=[]; this.sequence=0; this.totalTicks=0; this.actionCount=0; this.actionHash=''; this.inherited=inherited; this.sourceFingerprint=fingerprint();
    mkdirSync(join(out,'checkpoints'),{recursive:true});
    this.eventPath=join(out,'events.jsonl'); this.actionPath=join(out,'actions.jsonl');
    writeFileSync(this.eventPath,''); writeFileSync(this.actionPath,'');
  }
  get totalVisits() {return this.attempts.length+this.auxiliary.reduce((count,run)=>count+run.attempts,0);}
  get acquisitionRoutesReady() {return Boolean(this.config.acquisitionTargets?.length)&&this.config.acquisitionTargets.every(id=>ownedIds(this.save).has(id)||auxiliaryCapturePlan(this.game,this.save,[id]));}
  get acquisitionComplete() {return Boolean(this.config.acquisitionTargets?.length)&&this.config.acquisitionTargets.every(id=>ownedIds(this.save).has(id));}
  get hasErrors() {return this.issues.some(issue=>issue.kind.includes('error'));}
  action(action) {
    const row={sequence:++this.actionCount,attempt:this.current?.number ?? null,frame:this.battle?.frame ?? 0,...action};
    const text=JSON.stringify(row);
    this.actionHash=digest(this.actionHash+text);
    appendFileSync(this.actionPath,text+'\n');
    if(action.action==='policy-warning') this.issue('policy-warning',action.message ?? 'Policy warning',{action});
  }
  issue(kind,message,details={}) {
    const at=this.current;
    const existing=this.issues.find(x=>x.kind===kind && x.message===message && x.stage===at?.stage);
    if(existing) {existing.count++; return;}
    this.issues.push({id:`BOT-${String(this.issues.length+1).padStart(3,'0')}`,kind,message,stage:at?.stage,attempt:at?.number,seed:at?.seed,frame:this.battle?.frame,count:1,checkpoint:at?.checkpoint,...details});
  }
  event(type,event,battle) {
    if(type==='finish') this.finishEvent=event;
    if(type==='warning') this.issue('runtime-warning',event.message);
    if(type==='error') this.issue('runtime-error',event.error.message,{error:errorDetails(event.error)});
    if(!['spawn','capture','faint','wave','finish','warning','error','stage-event','party-removed','story-progress','story-complete'].includes(type)) return;
    appendFileSync(this.eventPath,JSON.stringify({attempt:this.current.number,frame:battle.frame,type,enemy:entity(event.enemy),profile:entity(event.profile),tower:entity(event.tower),won:event.won,message:event.message,error:event.error?errorDetails(event.error):undefined,stats:event.stats,wave:battle.currentWave})+'\n');
  }
  play(level,{campaignId=level.progressionId ?? level.id,purpose='progression',tunnel,partyOptions={},policyOptions={},storyOptions={},requiredDeployUids=[]}={}) {
    if(this.hasErrors)return {outcome:'error',stage:level.className};
    if(this.totalVisits>=this.config.maxBattles) {this.issue('strategy-blocker','Total battle visit budget exhausted');return {outcome:'budget',stage:level.className};}
    const number=++this.sequence, seed=Math.floor(this.rng()*0x100000000);
    const beforeMoney=this.save.money,beforeDex=ownedIds(this.save),beforeRoster=this.save.pokemon.length,beforeLevels=new Map(this.save.pokemon.map(p=>[p.uid,p.level]));
    const attempt={number,stage:level.className,campaignId,challengeId:level.challengeId,name:level.displayName,purpose,seed,checkpoint:`checkpoints/${String(number).padStart(5,'0')}.json`};
    this.current=attempt; this.finishEvent=null; this.battle=null;
    writeFileSync(join(this.out,attempt.checkpoint),JSON.stringify({seed,campaignId,stage:level.className,purpose,partyOptions,policyOptions,storyOptions,requiredDeployUids,save:this.save,bank:this.planner?.bank},null,2)+'\n');
    this.attempts.push(attempt);
    try {
      prepareParty(this.game.data,this.save,level,{onAction:a=>this.action(a),...partyOptions});
      const battle=this.battle=makeBattle(this.game,level,this.save,{seed,campaignId,tunnel,emit:(...args)=>this.event(...args)});
      // The tunnel controller supplies its own navigation/cutscenes.
      const intro=tunnel ? null : resolveIntro(this.game.data,level,this.save,battle,{rng:random(seed ^ 0x71337),...storyOptions});
      for(const action of intro?.actions ?? []) this.action({type:'story',phase:'intro',...action});
      for(const input of intro?.inputs ?? []) this.action({type:'story-input',phase:'intro',...input});
      const policy=createPolicy(battle,{onAction:a=>this.action(a),...policyOptions});
      if(battle.state!=='won') {
        // Original NPC trades remember which Pokémon the player deployed.
        // Place each requested participant through the ordinary ready-state
        // control before the combat policy rearranges the defense.
        for(const uid of requiredDeployUids) {
          const member=battle.partyMembers.find(p=>p.uid===uid);
          const spot=member&&level.spots.find(s=>battle.isSpotEligible(member,s.index)&&!battle.towers.some(t=>t.placed&&t.spotIndex===s.index));
          if(!spot||!battle.place(uid,spot.index)) throw new Error(`Could not deploy story participant ${uid}`);
          this.action({type:'story-deploy',uid,spotIndex:spot.index});
        }
        policy.prepare();
        if(battle.state==='ready' && !battle.start()) throw new Error('Policy could not start the battle with a legal deployment');
        let ticks=0;
        while(['running','paused'].includes(battle.state) && ticks < this.config.maxTicks) {
          policy.step();
          if(battle.state==='paused') battle.togglePause();
          battle.tick(); ticks++; this.totalTicks++;
          if(ticks%210===0) assertBattle(battle);
        }
        if(battle.state==='running' || battle.state==='paused') this.issue('strategy-blocker','Battle reached its tick budget',{snapshot:snapshot(battle)});
      }
      attempt.outcome=battle.state==='won'?'won':battle.state==='lost'?'lost':battle.state==='error'?'error':'stalled';
      attempt.battleOutcome=attempt.outcome;
      attempt.frames=battle.frame; attempt.wave=battle.currentWave; attempt.stats={...battle.stats}; attempt.candy=battle.remainingCandy;
      attempt.finalState=snapshot(battle);
      attempt.party=battle.partyMembers.map(p=>({...entity(p),moves:[...p.moves],experience:p.experience}));
      if(attempt.outcome==='won' && !tunnel && !intro?.terminal) {
        const win=resolveWin(this.game.data,level,this.save,battle,this.finishEvent ?? {won:true},{rng:random(seed ^ 0x21942),...storyOptions});
        for(const action of win?.actions ?? []) this.action({type:'story',phase:'win',...action});
        for(const input of win?.inputs ?? []) this.action({type:'story-input',phase:'win',...input});
        attempt.nextStage=win?.nextStage ?? this.finishEvent?.nextStage ?? level.nextStageClass ?? null;
      }
      checkSave(this.save,this.game.data);
      writeFileSync(join(this.out,'last-valid-save.json'),JSON.stringify(this.save,null,2)+'\n');
      if(this.planner) writeFileSync(join(this.out,'last-valid-bank.json'),JSON.stringify(this.planner.bank,null,2)+'\n');
      attempt.dexGained=[...ownedIds(this.save)].filter(id=>!beforeDex.has(id));
      attempt.rosterDelta=this.save.pokemon.length-beforeRoster;
      attempt.moneyDelta=this.save.money-beforeMoney;
      attempt.levelGains=this.save.pokemon.filter(p=>beforeLevels.has(p.uid)&&p.level>beforeLevels.get(p.uid)).map(p=>({uid:p.uid,from:beforeLevels.get(p.uid),to:p.level}));
      attempt.saveHash=digest(this.save);
    } catch(error) {
      attempt.outcome='error'; attempt.error=errorDetails(error);
      const invalidProfiles=this.save.pokemon.filter(p=>!Number.isSafeInteger(p.experience)||p.experience<0||p.experience>2147483647).map(p=>({...entity(p),experience:p.experience}));
      this.issue(invalidProfiles.length?'save-integrity-error':'harness-or-game-error',error.message,{error:errorDetails(error),invalidProfiles,snapshot:this.battle?snapshot(this.battle):undefined});
    } finally {
      this.battle?.dispose(); this.battle=null;
      console.log(`${String(number).padStart(4)} ${purpose}: ${level.className} ${attempt.outcome} (${attempt.frames ?? 0} ticks; roster ${this.save.pokemon.length}; money ${this.save.money})`);
      this.writeReport();
    }
    return attempt;
  }
  grind({moneyOnly=false,forLevel=null}={}) {
    if(!moneyOnly&&forLevel?.id===25&&this.save.completed.includes(13)&&this.save.pokemon.some(p=>[64,65,93,94].includes(p.speciesId)&&p.level<66)){
      for(let i=0;i<this.config.grind;i++){
        const trainee=this.save.pokemon.filter(p=>[64,65,93,94].includes(p.speciesId)&&p.level<66)
          .sort((a,b)=>Number([64,65].includes(b.speciesId))-Number([64,65].includes(a.speciesId))||b.level-a.level||a.uid.localeCompare(b.uid))[0];
        if(!trainee)break;
        const level=this.game.levels.find(l=>l.id===13);
        const result=this.play(level,{campaignId:13,purpose:'training-counter',partyOptions:{requiredUids:[trainee.uid]},policyOptions:{trainingUids:[trainee.uid],targetLevel:66}});
        if(['budget','error'].includes(result.outcome))return;
      }
      return;
    }
    const eligible=this.game.levels.filter(l=>this.save.completed.includes(l.id) && l.mode==='defense' && !l.nextStageClass && l.id<37);
    // Replay a recent win for earned XP and money. Never manufacture resources.
    const level=eligible.at(-1) ?? this.game.levels[0];
    for(let i=0;i<this.config.grind;i++) if(this.play(level,{campaignId:level.id,purpose:moneyOnly?'funding':'training',policyOptions:moneyOnly?{training:false,relearn:false,paidHealing:false}:{}}).outcome==='budget') return;
  }
  objective(level,options={}) {
    for(let retry=0;retry<this.config.maxAttempts;retry++) {
      const result=this.play(level,options);
      if(result.outcome==='won') return result;
      if(this.acquisitionComplete) return {outcome:'acquired'};
      if(this.acquisitionRoutesReady) return {outcome:'routes-ready'};
      if(result.outcome==='budget' || result.outcome==='error') return result;
      if(retry+1<this.config.maxAttempts && !level.temporaryParty) this.grind({forLevel:level});
    }
    this.issue('strategy-blocker','Retry budget exhausted; no proven winning strategy for this objective');
    return {outcome:'blocked'};
  }
  async runConfigured() {
    await this.planner?.prepare();
    // Earned captures and auxiliary trades can unlock a previously blocked
    // campaign. Revisit it with the improved team, within the same visit budget.
    const progress = () => JSON.stringify({completed:this.save.completed,challenge:this.save.challengeCompleted,
      dex:this.save.dex,levels:[...this.save.pokemon.reduce((m,p)=>m.set(p.speciesId,Math.max(m.get(p.speciesId)??0,p.level)),new Map())].sort((a,b)=>a[0]-b[0])});
    for(let cycle=0;cycle<(this.config.center==='on'?1:8)&&!this.hasErrors&&this.totalVisits<this.config.maxBattles;cycle++) {
      const before=progress();
      if(['all','campaign'].includes(this.config.mode)) await this.campaign();
      if(!this.hasErrors&&['all','challenges'].includes(this.config.mode)) this.challenges();
      if(!this.hasErrors&&['all','collection'].includes(this.config.mode)) await this.collect();
      if(this.config.mode!=='all'||progress()===before||coverage(this.game,this.save,this.attempts,this.navigation).complete) break;
    }
  }
  async campaign() {
    for(const level of this.game.levels.filter(l=>l.id<=this.config.through)) {
      if(this.acquisitionRoutesReady) break;
      if(this.save.completed.includes(level.id)) continue;
      if(this.config.center==='trades'&&this.save.completed.length) await this.planner?.step({buyCollection:false,gifts:false,maxEggs:0});
      if(level.id>this.save.unlocked && !(this.save.unlocked>=37 && level.id<=39)) break;
      if(level.id===17) {
        let completed=false;
        for(let retry=0;retry<this.config.maxAttempts&&!this.hasErrors&&this.totalVisits<this.config.maxBattles;retry++){
          if(this.tunnel()){completed=true;break;}
          if(retry+1<this.config.maxAttempts)this.grind();
        }
        if(!completed)break;
        continue;
      }
      let phase=level;
      for(let transitions=0;phase && transitions<20;transitions++) {
        const result=this.objective(phase,{campaignId:level.id});
        if(result.outcome!=='won') return;
        phase=result.nextStage?this.game.variants.find(v=>v.className===result.nextStage):null;
        if(result.nextStage && !phase) {this.issue('content-error',`Missing next phase ${result.nextStage}`);return;}
      }
      if(!this.save.completed.includes(level.id)) {this.issue('progression-error',`Won stage ${level.id} but campaign completion was not recorded`);return;}
    }
  }
  tunnel() {
    const budget=(this.save.haveFlash?0:10000)+(this.save.pokemon.some(p=>p.moves.includes(225))?0:10000);
    for(let tries=0;this.save.money<budget&&tries<this.config.maxAttempts;tries++) {
      const before=this.save.money;this.grind({moneyOnly:true});
      if(this.save.money<=before) break;
    }
    let member=this.save.pokemon.find(p=>p.moves.includes(225));
    if(!this.save.haveFlash) {
      const cut=this.save.pokemon.find(p=>p.moves.includes(224)) ?? this.save.pokemon.find(p=>this.game.data.species[p.speciesId].tmMoveIds.includes(224));
      if(!cut) {this.issue('collection-blocker','Rock Tunnel requires a Pokémon that can learn Cut');return false;}
      if(!cut.moves.includes(224)) {
        const result=teachFieldMove(this.game.data,this.save,cut,224,3);
        this.action({type:'teach-field',uid:cut.uid,move:224,result});
        if(!result.ok) {this.issue('resource-blocker',`Cannot teach Cut: ${result.reason}`);return false;}
      }
      const result=this.objective(this.game.levels.find(l=>l.id===3),{campaignId:3,purpose:'flash-quest',partyOptions:{requiredUids:[cut.uid],excludeSpecies:[63]},policyOptions:{training:false,relearn:false,paidHealing:false}});
      if(result.outcome!=='won' || !this.save.haveFlash) {this.issue('strategy-blocker','Route 2 visit did not earn Flash');return false;}
    }
    if(!member) {
      member=this.save.pokemon.find(p=>this.game.data.species[p.speciesId].tmMoveIds.includes(225));
      const result=teachFieldMove(this.game.data,this.save,member,225,3);
      this.action({type:'teach-field',uid:member?.uid,move:225,result});
      if(!result.ok) {this.issue('resource-blocker',`Cannot teach Flash: ${result.reason}`);return false;}
    }
    prepareParty(this.game.data,this.save,this.game.levels.find(l=>l.id===17),{onAction:a=>this.action(a),requiredUids:[member.uid]});
    if(!partyHasFlash(this.save)) {this.issue('strategy-blocker','Party selection omitted Flash');return false;}
    const tunnel=new RockTunnel(this.game.data,this.save,{seed:Math.floor(this.rng()*0x100000000)});
    tunnel.enter();
    // Visit all eight flagged rooms, including optional wild/hidden battles.
    for(let n=0;n<80;n++) {
      const view=tunnel.view();
      if(view.stage?.className && !this.navigation.includes(view.stage.className)) this.navigation.push(view.stage.className);
      if(view.status==='completed') return true;
      if(view.status==='encounter') tunnel.choose('battle');
      else if(view.status==='battle') {
        const result=this.play(view.battle.level,{campaignId:17,purpose:'tunnel',tunnel,partyOptions:{requiredUids:[member.uid]}});
        if(result.outcome!=='won') {this.issue('strategy-blocker','Rock Tunnel trip failed');return false;}
      } else {
        const action=nextTunnelAction(tunnel,{allRooms:true,claimQuest:true});
        this.action({type:'tunnel-choice',room:view.room,status:view.status,action});
        const next=tunnel.choose(action);
        if(next.error) {this.issue('harness-error',`Tunnel route: ${next.error}`,{view,action});return false;}
      }
    }
    this.issue('strategy-blocker','Tunnel navigation budget exhausted');return false;
  }
  challenges() {
    for(const level of this.game.variants.filter(v=>v.challengeId).sort((a,b)=>a.challengeId-b.challengeId)) {
      if(this.save.challengeCompleted>=level.challengeId) continue;
      if(this.save.challengeCompleted<level.challengeId-1) break;
      if(this.objective(level,{campaignId:level.progressionId,purpose:'challenge'}).outcome!=='won') break;
    }
  }
  async collect() {
    if(!this.save.completed.length) {this.issue('collection-blocker','Collection visits require at least one completed campaign stage');return;}
    await this.planner?.step();
    let usedVisits=0;
    const visitedSlots=[];
    for(let trip=0;trip<2&&!this.hasErrors&&usedVisits<this.config.dexVisits&&this.totalVisits<this.config.maxBattles;trip++) {
      const auxiliaryPlan=this.planner?.auxiliaryPlan({excludeSlots:visitedSlots});
      if(!auxiliaryPlan)break;
      visitedSlots.push(auxiliaryPlan.slot);
      const relative=`auxiliary-${auxiliaryPlan.slot}-${this.auxiliary.length+1}`;
      let outcome,childResult;
      try {outcome=await this.planner.withAuxiliary(auxiliaryPlan.slot,async(save,context)=>{
        const config={...this.config,mode:'campaign',center:'off',through:context.through,...(this.config.center==='trades'?{acquisitionTargets:context.neededSpecies}:{}),seed:Math.floor(this.rng()*0x100000000),maxBattles:Math.min(this.config.dexVisits-usedVisits,this.config.maxBattles-this.totalVisits)};
        const child=new Runner(this.game,save,config,join(this.out,relative));
        child.parentReplay='../report.json';
        writeFileSync(join(child.out,'initial-save.json'),JSON.stringify(save,null,2)+'\n');
        writeFileSync(join(child.out,'initial-bank.json'),JSON.stringify(context.checkpoint(),null,2)+'\n');
        await child.campaign();
        for(let retry=0;retry<24&&!child.hasErrors&&context.neededSpecies.some(id=>!ownedIds(save).has(id))&&child.totalVisits<config.maxBattles;retry++) {
          const plan=auxiliaryCapturePlan(this.game,save,context.neededSpecies,child.attempts);
          if(!plan)break;
          child.play(plan.level,{campaignId:plan.level.id,purpose:'collection-version',partyOptions:plan.partyOptions,policyOptions:plan.policyOptions});
        }
        const report=child.writeReport();
        childResult={path:`${relative}/report.json`,slot:context.slot,seed:config.seed,attempts:child.attempts.length,totalTicks:child.totalTicks,resultHash:report.resultHash,completion:report.completion,issues:report.issues};
        return childResult;
      },{neededSpecies:auxiliaryPlan.targetSpecies});}
      catch(error) {
        // Preserve completed child evidence even if account persistence or
        // returning the loan fails after the gameplay callback has finished.
        if(childResult) {
          this.auxiliary.push(childResult);this.totalTicks+=childResult.totalTicks;
          this.action({type:'auxiliary-playthrough',...childResult,accountError:errorDetails(error)});
        }
        this.issue('auxiliary-error',error.message,{report:`${relative}/report.json`,error:errorDetails(error)});
        return;
      }
      this.auxiliary.push(outcome.result);usedVisits+=outcome.result.attempts;this.totalTicks+=outcome.result.totalTicks;
      this.action({type:'auxiliary-playthrough',...outcome.result,acquired:outcome.acquired});
      for(const issue of outcome.result.issues.filter(issue=>issue.kind.includes('error'))) this.issue('auxiliary-error',issue.message,{report:outcome.result.path,original:issue});
      if(this.hasErrors)return;
      await this.planner.step();
    }
    const stages=this.game.levels.filter(l=>this.save.completed.includes(l.id)&&['defense','safari'].includes(l.mode)&&!l.nextStageClass);
    for(let i=usedVisits;i<this.config.dexVisits && coverage(this.game,this.save).dex.missing.length;i++) {
      const plan=this.planner?.bestNextVisit(this.game,this.attempts);
      if(plan?.kind==='blocked') {this.issue('collection-blocker',plan.reason,{missing:plan.targetSpecies});break;}
      const level=plan?.level ?? stages[i%stages.length];
      const before=ownedIds(this.save);
      this.action({type:'collection-plan',kind:plan?.kind,stage:level.className,targets:plan?.targetSpecies,reason:plan?.reason});
      const result=this.play(level,{campaignId:level.id,purpose:plan?.purpose ?? 'collection',partyOptions:plan?.partyOptions,policyOptions:plan?.policyOptions,storyOptions:plan?.storyOptions,requiredDeployUids:plan?.requiredDeployUids});
      if(result.outcome==='budget'||result.outcome==='error'||this.hasErrors)break;
      await this.planner?.step();
      this.attempts.at(-1).collectionGained=[...ownedIds(this.save)].filter(id=>!before.has(id));
      console.log(`     Pokédex: ${coverage(this.game,this.save).dex.owned}/151`);
    }
    if(coverage(this.game,this.save).dex.missing.length) this.issue('collection-blocker','Collection visit budget exhausted or no eligible route remains',{missing:coverage(this.game,this.save).dex.missing});
  }
  writeReport() {
    const previous=this.inherited?.completion?.variants?.filter(v=>v.status==='won').map(v=>({stage:v.id,outcome:'won'})) ?? [];
    const navigated=[...this.navigation,...(this.inherited?.completion?.variants?.filter(v=>v.status==='visited').map(v=>v.id) ?? [])];
    const completion=coverage(this.game,this.save,[...previous,...this.attempts],navigated);
    const scopeComplete=this.config.acquisitionTargets?.length?this.acquisitionComplete:this.config.mode==='campaign'?completion.campaign.filter(l=>l.id<=this.config.through).every(l=>l.status==='won'):this.config.mode==='challenges'?completion.challenges.every(l=>l.status==='won'):this.config.mode==='collection'?completion.dex.missing.length===0:completion.complete;
    const requestedComplete=scopeComplete&&!this.issues.some(issue=>issue.kind.includes('error'));
    const semantic={config:this.config,completion,attempts:this.attempts,auxiliary:this.auxiliary,save:this.save,bank:this.planner?.bank,actionCount:this.actionCount,actionHash:this.actionHash};
    const report={version:BOT_VERSION,engine:'native (with recovered move timelines)',environment:{node:process.version,platform:process.platform,arch:process.arch,locale:Intl.DateTimeFormat().resolvedOptions().locale},fingerprint:this.sourceFingerprint,config:this.config,parentReplay:this.parentReplay,inherited:this.inherited,requestedComplete,completion,attempts:this.attempts,auxiliary:this.auxiliary,navigation:this.navigation,issues:this.issues,totalVisits:this.totalVisits,totalTicks:this.totalTicks,actionCount:this.actionCount,actionHash:this.actionHash,resultHash:digest(semantic)};
    writeFileSync(join(this.out,'report.json'),JSON.stringify(report,null,2)+'\n');
    writeFileSync(join(this.out,'final-save.json'),JSON.stringify(this.save,null,2)+'\n');
    if(this.planner) writeFileSync(join(this.out,'final-bank.json'),JSON.stringify(this.planner.bank,null,2)+'\n');
    const lines=['# Deterministic playthrough findings','',`Result: ${requestedComplete?'requested scope completed':'incomplete'}. Campaign ${completion.campaign.filter(l=>l.status==='won').length}/42; challenges ${completion.challenges.filter(l=>l.status==='won').length}/6; Pokédex ${completion.dex.owned}/151.`,`Seed: ${this.config.seed}. Native move timelines enabled. ${this.totalVisits} visits, ${this.totalTicks} logical ticks.`, '', 'A loss or exhausted strategy budget is not by itself evidence of a game defect. Runtime errors and warnings are preserved for investigation. Rendering, pointer controls and server persistence are outside this headless run.', ''];
    for(const issue of this.issues) lines.push(`## ${issue.id}: ${issue.message}`,'',`Classification: ${issue.kind}. Stage: ${issue.stage ?? 'planner'}; attempt: ${issue.attempt ?? 'n/a'}; seed: ${issue.seed ?? this.config.seed}; frame: ${issue.frame ?? 'n/a'}; occurrences: ${issue.count}.`,issue.checkpoint?`Pre-battle save: [${issue.checkpoint}](${issue.checkpoint}). See actions.jsonl and events.jsonl for reproduction.`:'',issue.error?'```\n'+issue.error.stack+'\n```':'','');
    if(!this.issues.length) lines.push('No runtime errors or warnings were recorded in the visited content.');
    lines.push('',`Missing species: ${completion.dex.missing.join(', ') || 'none'}.`,'',`Unreached/blocked campaign: ${completion.campaign.filter(x=>x.status!=='won').map(x=>x.id).join(', ') || 'none'}.`,'');
    writeFileSync(join(this.out,'BUGS.md'),lines.join('\n'));
    return report;
  }
}

async function main() {
  const options=parse(process.argv.slice(2));
  let config=Object.fromEntries(Object.keys(defaults).map(key=>[key,options[key]]));
  const prior=options.replay?JSON.parse(readFileSync(resolve(options.replay),'utf8')):null;
  if(prior?.parentReplay) throw new Error(`Auxiliary reports share the parent run's RNG and account transactions. Replay ${resolve(dirname(resolve(options.replay)),prior.parentReplay)} instead.`);
  if(prior) {if(prior.fingerprint!==fingerprint()) throw new Error('Replay source fingerprint differs; use the original checkout and bot files');config=prior.config;}
  const out=resolve(options.out ?? `artifacts/bot/seed-${config.seed}-${new Date().toISOString().replace(/[:.]/g,'-')}`);
  if(existsSync(out) && readdirSync(out).length) throw new Error('Output directory is not empty; use a new path');
  mkdirSync(out,{recursive:true});
  const restore=deterministicEnvironment(config.seed);
  try {
    const game=loadGame();
    const inherited=options.resume?JSON.parse(readFileSync(resolve(options.resume),'utf8')):prior?.inherited;
    if(options.resume && config.center!=='on' && inherited.config?.center==='on') throw new Error('An assisted account cannot be resumed as starter-and-captures progression. Start a fresh run or retain --center on.');
    const inputDir=options.resume?dirname(resolve(options.resume)):prior?.inherited?dirname(resolve(options.replay)):null;
    const inputPrefix=options.resume?'final':'initial';
    const checkpoint=options.checkpoint?JSON.parse(readFileSync(resolve(options.checkpoint),'utf8')):null;
    const save=checkpoint?checkSave(checkpoint.save,game.data):inputDir?checkSave(JSON.parse(readFileSync(join(inputDir,`${inputPrefix}-save.json`),'utf8')),game.data):newSave(game.data,config.starter);
    const bankPath=inputDir?join(inputDir,`${inputPrefix}-bank.json`):null;
    const bank=checkpoint?.bank ?? (bankPath&&existsSync(bankPath)?JSON.parse(readFileSync(bankPath,'utf8')):null);
    if(inherited) reserveIdentityRange(game.data,bank?.slots ?? [save]);
    let originCoverage=inherited?.completion;
    if(checkpoint) {
      const recorded=inherited.attempts.find(attempt=>resolve(dirname(resolve(options.resume)),attempt.checkpoint)===resolve(options.checkpoint));
      if(!recorded || recorded.seed!==checkpoint.seed || recorded.stage!==checkpoint.stage) throw new Error('Checkpoint does not match the referenced report');
      const previous=inherited.inherited?.completion?.variants?.filter(v=>v.status==='won').map(v=>({stage:v.id,outcome:'won'})) ?? [];
      const navigation=inherited.inherited?.completion?.variants?.filter(v=>v.status==='visited').map(v=>v.id) ?? [];
      originCoverage=coverage(game,save,[...previous,...inherited.attempts.filter(a=>a.number<recorded.number)],[...navigation,...(save.completed.includes(17)?inherited.navigation ?? []:[])]);
    }
    const origin=options.resume?{source:resolve(options.resume),sourceCheckpoint:options.checkpoint?resolve(options.checkpoint):undefined,fingerprint:inherited.fingerprint,resultHash:inherited.resultHash,completion:originCoverage}:prior?.inherited ?? null;
    writeFileSync(join(out,'initial-save.json'),JSON.stringify(save,null,2)+'\n');
    if(bank) writeFileSync(join(out,'initial-bank.json'),JSON.stringify(bank,null,2)+'\n');
    const runner=new Runner(game,save,config,out,origin);
    if(config.center!=='off') runner.planner=createCollectionPlanner(game.data,save,{bank,starter:config.starter,commerce:config.center==='on',corner:config.corner==='earned'?'porygon':'off',rng:random(config.seed ^ 0xc011ec7),onAction:action=>runner.action(action)});
    try {
      await runner.runConfigured();
    } catch(error) {runner.issue('harness-or-game-error',error.message,{error:errorDetails(error)});}
    const report=runner.writeReport();
    if(prior) {
      const match=prior.resultHash===report.resultHash;
      writeFileSync(join(out,'replay.json'),JSON.stringify({match,expected:prior.resultHash,actual:report.resultHash},null,2)+'\n');
      if(!match) throw new Error('Deterministic replay diverged; compare the first differing action/checkpoint');
      console.log('Deterministic replay matched.');
    }
    console.log(`Report: ${join(out,'report.json')}\nCoverage: ${report.completion.campaign.filter(l=>l.status==='won').length}/42 campaign, ${report.completion.challenges.filter(l=>l.status==='won').length}/6 challenges, ${report.completion.dex.owned}/151 species.`);
    process.exitCode=report.requestedComplete?0:2;
    runner.planner?.dispose();
  } finally {restore();}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(error=>{console.error(error.stack);process.exitCode=1;});
