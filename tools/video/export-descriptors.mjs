#!/usr/bin/env node
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync} from 'node:fs';
import {resolve,join,dirname,relative} from 'node:path';
import * as Model from '../../src/model.js';
import {rockTunnelSession} from '../../src/rock-tunnel.js';
import {Runner} from '../bot/run.mjs';
import {loadGame,deterministicEnvironment,random,fingerprint,digest} from '../bot/runtime.mjs';
import {createCollectionPlanner} from '../bot/collection.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const [sourceArgument,outArgument] = process.argv.slice(2);
if (!sourceArgument || !outArgument || typeof Model.videoNextId !== 'function') {
  throw new Error('Usage: node --loader ./tools/video/observe-loader.mjs tools/video/export-descriptors.mjs REPORT NEW_OUTPUT_DIRECTORY');
}
const sourcePath=resolve(sourceArgument), sourceDir=dirname(sourcePath), out=resolve(outArgument);
const prior=JSON.parse(readFileSync(sourcePath,'utf8'));
if (prior.inherited || prior.parentReplay) throw new Error('Video export currently requires the original fresh primary report.');
if (prior.fingerprint!==fingerprint()) throw new Error('Frozen source fingerprint differs from the recorded playthrough.');
if (existsSync(out)&&readdirSync(out).length) throw new Error('Export output directory must be new or empty.');
mkdirSync(join(out,'descriptors'),{recursive:true});
const epoch='2026-09-08T12:00:00.000Z', restore=deterministicEnvironment(prior.config.seed,epoch);
const ambientRandom=Math.random;let ambientRandomCalls=0;
Math.random=()=>{ambientRandomCalls++;return ambientRandom();};
const originalPlay=Runner.prototype.play, descriptors=[];
const replayOut=join(out,'observed-replay');
Runner.prototype.play=function(level,options={}) {
  const group=relative(replayOut,this.out).replaceAll('\\','/')||'primary';
  const number=this.sequence+1,key=`${group}:${String(number).padStart(5,'0')}`;
  const identityStart=Model.videoNextId(), initialAmbientCalls=ambientRandomCalls;
  const session=clone(rockTunnelSession);
  const tunnel=options.tunnel?clone(Object.fromEntries(['options','flags','room','status','pending','active','serial','questResult'].map(name=>[name,options.tunnel[name]]))):null;
  const observedLevel=clone(level);
  const attempt=originalPlay.call(this,level,options);
  if (!attempt.checkpoint) return attempt;
  const identityEnd=Model.videoNextId();
  const checkpoint=JSON.parse(readFileSync(join(this.out,attempt.checkpoint),'utf8'));
  delete checkpoint.bank; // Battle replay needs only the recorded active save.
  const reportPath=join(sourceDir,group==='primary'?'':group,'report.json');
  const checkpointPath=join(dirname(reportPath),attempt.checkpoint);
  const descriptorPath=`descriptors/${key.replace(':','-')}.json`;
  const descriptor={version:1,key,checkpoint,attempt:clone(attempt),level:observedLevel,tunnel,
    identityStart,identityEnd,ambientRandomCalls:initialAmbientCalls,seed:prior.config.seed,epoch,session,
    sourceFingerprint:prior.fingerprint,reportPath,checkpointPath};
  writeFileSync(join(out,descriptorPath),JSON.stringify(descriptor)+'\n');
  descriptors.push({key,reportPath,checkpointPath,descriptorPath,identityStart,identityEnd,frames:attempt.frames,
    seed:attempt.seed,stage:attempt.stage,outcome:attempt.outcome});
  writeFileSync(join(out,'descriptors.json'),JSON.stringify({version:1,sourceReport:sourcePath,sourceFingerprint:prior.fingerprint,verified:false,descriptors},null,2)+'\n');
  return attempt;
};
try {
  const game=loadGame(),save=Model.newSave(game.data,prior.config.starter);
  const runner=new Runner(game,save,prior.config,replayOut);
  writeFileSync(join(replayOut,'initial-save.json'),JSON.stringify(save,null,2)+'\n');
  if(prior.config.center!=='off')runner.planner=createCollectionPlanner(game.data,save,{starter:prior.config.starter,commerce:prior.config.center==='on',corner:prior.config.corner==='earned'?'porygon':'off',rng:random(prior.config.seed^0xc011ec7),onAction:action=>runner.action(action)});
  await runner.runConfigured();
  const report=runner.writeReport();
  const verified=report.resultHash===prior.resultHash;
  const manifest={version:1,sourceReport:sourcePath,sourceFingerprint:prior.fingerprint,verified,
    expectedResultHash:prior.resultHash,observedResultHash:report.resultHash,descriptors};
  writeFileSync(join(out,'descriptors.json'),JSON.stringify(manifest,null,2)+'\n');
  writeFileSync(join(out,'observation-check.json'),JSON.stringify({verified,expected:prior.resultHash,actual:report.resultHash,visits:descriptors.length,descriptorHash:digest(descriptors)},null,2)+'\n');
  runner.planner?.dispose();
  if(!verified)throw new Error('Observational replay diverged from the recorded run.');
  console.log(`Exported ${descriptors.length} exact descriptors; observed replay hash matches.`);
} finally {Runner.prototype.play=originalPlay;restore();}
