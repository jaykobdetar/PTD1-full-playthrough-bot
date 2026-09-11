#!/usr/bin/env node
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import * as Model from '../../src/model.js';
import {loadGame,digest} from '../bot/runtime.mjs';
import {replayBattle} from './replay-battle.mjs';

const path=resolve(process.argv[2]??'artifacts/video/replay-descriptors/descriptors.json');
const manifest=JSON.parse(readFileSync(path,'utf8')),root=dirname(path);
if(typeof Model.videoNextId!=='function')throw new Error('Run preflight with --loader ./tools/video/observe-loader.mjs.');
if(!manifest.verified)throw new Error('Only descriptors from a matching observational replay may be used.');
const game=loadGame();game.data.endingManifest=JSON.parse(readFileSync(new URL('../../public/assets/story36/manifest.json',import.meta.url),'utf8'));
const results=[],failures=[];
let processed=0;
for(const row of manifest.descriptors){
  const descriptor=JSON.parse(readFileSync(join(root,row.descriptorPath),'utf8'));
  try {
    const result=await replayBattle(game,descriptor);
    const saveHash=digest(result.save),saveMatch=saveHash===descriptor.attempt.saveHash;
    if(!saveMatch)throw Object.assign(new Error(`Final save hash differs for ${descriptor.key}.`),{result,actual:saveHash,expected:descriptor.attempt.saveHash});
    Object.assign(row,{storyFrames:result.storyFrames,battleFrames:result.battleFrames,frameCount:result.frameCount,preflight:true});
    results.push({key:row.key,matches:{...result.matches,save:true},identityStart:descriptor.identityStart,identityEnd:result.identityEnd,
      frames:result.frames,storyFrames:result.storyFrames,frameCount:result.frameCount,saveHash});
    result.battle.dispose();
    console.log(`${++processed}/${manifest.descriptors.length} ${row.key} exact; ${result.frames} battle + ${result.storyFrames} story frames`);
  } catch(error) {
    failures.push({key:row.key,message:error.message,actual:error.actual,expected:error.expected,matches:error.result?.matches});
    error.result?.battle?.dispose();
    console.error(error.stack);break;
  }
  writeFileSync(join(root,'preflight.json'),JSON.stringify({verified:false,processed,results,failures},null,2)+'\n');
}
const verified=failures.length===0&&results.length===manifest.descriptors.length;
manifest.preflight=verified;
if(verified)writeFileSync(path,JSON.stringify(manifest,null,2)+'\n');
writeFileSync(join(root,'preflight.json'),JSON.stringify({verified,processed,sourceFingerprint:manifest.sourceFingerprint,totalFrames:results.reduce((n,r)=>n+r.frameCount,0),results,failures},null,2)+'\n');
if(!verified)process.exitCode=1;
