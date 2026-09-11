import * as Model from '../../src/model.js';
import {Battle} from '../../src/battle.js';
import {ReverseBattle} from '../../src/reverse-battle.js';
import {SafariBattle} from '../../src/safari-battle.js';
import {ChallengeBattle,ChallengeInvasion} from '../../src/challenge-battle.js';
import {initializeStageHooks} from '../../src/stage-hooks.js';
import {recordOwned} from '../../src/profile-features.js';
import {RockTunnel,rockTunnelSession,recordTunnelSessionCapture,awardRoute2Flash} from '../../src/rock-tunnel.js';
import {StoryRuntime} from '../../src/story-runtime.js';
import {STORY_CONTROLLERS} from '../../src/story-data-controllers.js';
import {storyWinController} from '../../src/story-data-stage.js';
import {EndingStory} from '../../src/ending-story.js';
import {prepareParty,createPolicy} from '../bot/policy.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
const entity=p=>p?{uid:p.uid,speciesId:p.speciesId,level:p.level,shiny:p.shiny}:undefined;
let declaredFactoryIndex=1;
export const currentFactoryIndex=()=>Model.videoNextId?.()??declaredFactoryIndex;
function random(seed) {
  let a=seed>>>0;
  return ()=>{a=(a+0x6d2b79f5)>>>0;let t=Math.imul(a^(a>>>15),a|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}
function canonical(value) {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
function same(a,b){return JSON.stringify(canonical(a))===JSON.stringify(canonical(b));}
function summarizeStoryAction(action,frame) {
  const result={frame,type:action.type};
  for(const key of ['id','quantity','value','popup','name','destination','levelId','waveClass'])if(action[key]!==undefined)result[key]=action[key];
  if(action.profile)result.profile=entity(action.profile);
  if(action.type==='trace')result.values=action.values.map(String);
  if(action.type==='source-message')result.message=typeof action.message==='string'?action.message:action.message?.[0];
  return result;
}
function chooseStoryControl(runtime,{choice='yes',direction='left',chooseControl}={}) {
  const controls=runtime.controls.filter(control=>control.width>0&&control.height>0);
  if(chooseControl){const chosen=chooseControl({runtime,controls});if(chosen)return controls.find(control=>control.name===(chosen.name??chosen));}
  return controls.find(control=>/^butt_(next|end|start|close)$/.test(control.name))
    ??controls.find(control=>control.name===`butt_${choice}`)
    ??controls.find(control=>control.name===`btn_${direction}`)
    ??controls.find(control=>/^btn_(left|right|up|down|end)$/.test(control.name));
}

/** Render an independently restored, recorded native battle. Nothing here
 * advances a renderer's clock: callbacks observe a completed original tick.
 * The observed descriptor restores identity/session/navigation metadata absent
 * from ordinary save files. It never substitutes wins, attacks, or resources.
 * A worker must receive descriptors in increasing identityStart order.
 */
export async function replayBattle(game,descriptor,{
  onBattle,onFrame,onStoryFrame,onEvent,onAction,
}={}) {
  const {checkpoint,attempt,level:recordedLevel}=descriptor;
  const data=game.data,save=clone(checkpoint.save),level=clone(recordedLevel);
  const epoch=Date.parse(descriptor.epoch),ambient=random(descriptor.seed);
  if(!Number.isFinite(epoch))throw new Error('Descriptor has no valid deterministic epoch.');
  for(let i=0;i<(descriptor.ambientRandomCalls??0);i++)ambient();
  const RealDate=globalThis.Date;
  class ReplayDate extends RealDate {
    constructor(...args){super(...(args.length?args:[epoch]));}
    static now(){return epoch;}
  }
  // Restore browser globals before every async renderer/encoder callback.
  function sync(operation,rng=ambient) {
    const previousDate=globalThis.Date,previousRandom=Math.random;
    globalThis.Date=ReplayDate;Math.random=rng;
    try{return operation();}finally{globalThis.Date=previousDate;Math.random=previousRandom;}
  }
  const next=currentFactoryIndex();
  if(next>descriptor.identityStart)throw new Error(`Worker identity allocator ${next} passed descriptor ${descriptor.key} start ${descriptor.identityStart}; use a new worker.`);
  sync(()=>{for(let id=next;id<descriptor.identityStart;id++)Model.makePokemon(data,1);});
  declaredFactoryIndex=descriptor.identityStart;
  Object.assign(rockTunnelSession,clone(descriptor.session));
  let battle,finishEvent=null,storyFrames=0,battleFrames=0;
  const actions=[],storyInputs=[],pending=[];
  const emitAction=action=>{const row={frame:battle?.frame??0,...action};actions.push(row);if(onAction)pending.push(()=>onAction(row,battle));};
  const flush=async()=>{while(pending.length)await pending.shift()();};
  const listener=(type,event)=>{
    if(type==='capture'&&!level.temporaryParty){recordOwned(save,event.profile);recordTunnelSessionCapture(event.profile);}
    if(type==='finish'){finishEvent=event;if(battle)awardRoute2Flash(battle,event.won);}
    if(onEvent)pending.push(()=>onEvent(type,event,battle));
  };
  let tunnel=null;
  sync(()=>{
    prepareParty(data,save,level,{onAction:emitAction,...checkpoint.partyOptions});
    const Engine=level.challengeId?(level.mode==='invasion'?ChallengeInvasion:ChallengeBattle)
      :level.mode==='safari'?SafariBattle:level.mode==='invasion'?ReverseBattle:Battle;
    battle=new Engine(data,level,save,listener,{campaignId:checkpoint.campaignId,seed:checkpoint.seed,rng:random(checkpoint.seed^0xa511e9b3)});
    if(descriptor.tunnel){
      tunnel=new RockTunnel(data,save,{...descriptor.tunnel.options,rng:()=>0.5,session:rockTunnelSession});
      for(const key of ['flags','room','status','pending','active','serial','questResult'])tunnel[key]=clone(descriptor.tunnel[key]);
      tunnel.bindBattle(battle);
    }
    initializeStageHooks(battle);
  });
  await onBattle?.(battle,{key:descriptor.key,descriptor,phase:'prepare'});await flush();

  async function story(controller,phase,event=null,options={},providedRng=null) {
    if(!controller)return {actions:[],inputs:[],nextStage:null};
    if(!STORY_CONTROLLERS[controller])throw new Error(`Unknown recorded story controller ${controller}.`);
    const rng=providedRng??random(checkpoint.seed^(phase==='win'?0x21942:0x71337));
    const {maxFrames=20000,stallFrames=2100,clickEvery=5}=options;
    const localActions=[],inputs=[];let completion=null;
    const runtime=sync(()=>new StoryRuntime(data,{
      timelines:data.timelines,save,level,battle,stageFlags:{...battle.stageFacts,...options.stageFlags},rng,
      onAction(action){if(!action.type.startsWith('audio-')&&action.type!=='battle-audio-pause')localActions.push(summarizeStoryAction(action,action.runtime.clock.frame));},
      onComplete(result){completion=result;},
    }),rng);
    const args=[runtime.stage,...(battle.isChallenge&&phase==='win'?[!event?.reward]:[])];
    let previous='',stableFrames=0;
    sync(()=>runtime.open(controller,args),rng);
    for(let frame=0;frame<maxFrames&&!runtime.closed;frame++){
      sync(()=>runtime.tick(),rng);
      storyFrames++;
      await onStoryFrame?.(runtime,{key:descriptor.key,phase,frame:runtime.clock.frame,controller:runtime.controllerName,battle});
      const signature=JSON.stringify([runtime.controllerName,runtime.root?.symbolName,runtime.root?.currentFrame,runtime.root?.currentLabel,runtime.controls.map(control=>control.name),localActions.length]);
      stableFrames=signature===previous?stableFrames+1:0;previous=signature;
      if(stableFrames>=stallFrames)break;
      if(frame%clickEvery||runtime.closed)continue;
      sync(()=>{
        const control=chooseStoryControl(runtime,options);
        if(control){inputs.push({frame:runtime.clock.frame,control:control.name,label:runtime.root?.currentLabel});runtime.click(control.clip);}
      },rng);
    }
    if(!runtime.closed)throw new Error(`Story ${controller} did not terminate at ${runtime.clock.frame}.`);
    for(const action of localActions)emitAction({type:'story',phase,...action});
    for(const input of inputs){storyInputs.push({phase,...input});emitAction({type:'story-input',phase,...input});}
    await flush();
    const nextStage=completion?.type==='change-stage'&&!completion.destination?.startsWith('screen_')?completion.destination:null;
    return {actions:localActions,inputs,nextStage,frames:runtime.clock.frame};
  }

  const storyOptions=checkpoint.storyOptions??{};
  let terminal=false,intro=null;
  if(!tunnel&&!battle.originalIntroComplete){
    const introRng=random(checkpoint.seed^0x71337);
    intro=await story(level.introPopup,'intro',null,storyOptions,introRng);
    if(!intro.nextStage){
      battle.originalIntroComplete=true;
      if(level.id===36){
        const manifest=data.endingManifest??game.endingManifest;
        if(!manifest)throw new Error('Stage36 needs game.data.endingManifest.');
        const ending=sync(()=>new EndingStory(battle,manifest));
        sync(()=>ending.completeIntro());
        await story(storyWinController(level),'win',{won:true},storyOptions,introRng);
        sync(()=>ending.closeEnding());terminal=true;
      }
    }
  }
  const policy=sync(()=>createPolicy(battle,{onAction:emitAction,...checkpoint.policyOptions}));
  if(battle.state!=='won'){
    sync(()=>{
      for(const uid of checkpoint.requiredDeployUids??[]){
        const member=battle.partyMembers.find(profile=>profile.uid===uid);
        const spot=member&&level.spots.find(candidate=>battle.isSpotEligible(member,candidate.index)&&!battle.towers.some(tower=>tower.placed&&tower.spotIndex===candidate.index));
        if(!spot||!battle.place(uid,spot.index))throw new Error(`Cannot deploy recorded story participant ${uid}.`);
        emitAction({type:'story-deploy',uid,spotIndex:spot.index});
      }
      policy.prepare();
      if(battle.state==='ready'&&!battle.start())throw new Error('Replay could not start the native battle.');
    });await flush();
    while(['running','paused'].includes(battle.state)&&battleFrames<(attempt.frames+1)){
      sync(()=>{policy.step();if(battle.state==='paused')battle.togglePause();battle.tick();});
      battleFrames++;await flush();
      await onFrame?.(battle,{key:descriptor.key,phase:'battle',frame:battle.frame,descriptor});
    }
  }
  const outcome=battle.state==='won'?'won':battle.state==='lost'?'lost':battle.state==='error'?'error':'stalled';
  const result={key:descriptor.key,outcome,frames:battle.frame,wave:battle.currentWave,stats:clone(battle.stats),candy:battle.remainingCandy,
    party:battle.partyMembers.map(profile=>({...entity(profile),moves:clone(profile.moves),experience:profile.experience})),
    storyFrames,battleFrames,frameCount:storyFrames+battleFrames,actions,storyInputs,save,battle};
  if(outcome==='won'&&!tunnel&&!terminal)await story(storyWinController(level),'win',finishEvent??{won:true},storyOptions);
  result.storyFrames=storyFrames;result.frameCount=storyFrames+battleFrames;
  sync(()=>Model.validateSave(save,data));
  await flush();
  const actualIdentity=Model.videoNextId?.()??descriptor.identityEnd;
  result.identityEnd=actualIdentity;
  result.matches={outcome:outcome===attempt.outcome,frames:battle.frame===attempt.frames,stats:same(result.stats,attempt.stats),
    candy:result.candy===attempt.candy,party:same(result.party,attempt.party),identity:actualIdentity===descriptor.identityEnd};
  declaredFactoryIndex=actualIdentity;
  if(Object.values(result.matches).some(value=>!value))throw Object.assign(new Error(`Native replay diverged for ${descriptor.key}: ${JSON.stringify(result.matches)}`),{result});
  return result;
}
