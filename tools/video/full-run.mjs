#!/usr/bin/env node
// One local job: fresh strict play, exact replay, preflight, then all videos.
// It stops on failure and never labels a partial run as a complete recording.
import {spawn} from 'node:child_process';
import {openSync,closeSync,mkdirSync,existsSync,readFileSync,writeFileSync,renameSync,statfsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fingerprint} from '../bot/runtime.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
process.chdir(root);
const name=process.argv[2]??'strict-final-2';
if(!/^[a-zA-Z0-9_-]+$/.test(name))throw new Error('Use one simple new run name.');
const out=resolve('artifacts/pipelines',name),bot=resolve('artifacts/bot',name);
const descriptors=resolve('artifacts/video',`${name}-descriptors`),video=resolve('artifacts/video',`${name}-playthrough`);
if([out,bot,descriptors,video].some(existsSync))throw new Error('Use a new run name; existing outputs are preserved.');
mkdirSync(out,{recursive:true});
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const expectedFingerprint=fingerprint();
const state={name,status:'running',stage:'initializing',started:new Date().toISOString(),sourceFingerprint:expectedFingerprint,bot,descriptors,video,steps:[]};
function save(){writeFileSync(join(out,'status.json.tmp'),JSON.stringify(state,null,2)+'\n');renameSync(join(out,'status.json.tmp'),join(out,'status.json'));}
async function run(stage,args){
  if(fingerprint()!==expectedFingerprint)throw new Error('Gameplay source changed during the pipeline.');
  state.stage=stage;const log=join(out,`${stage}.log`),step={stage,args,log,started:new Date().toISOString()};state.steps.push(step);save();
  console.log(`${step.started} ${stage}`);
  const fd=openSync(log,'wx');
  try{
    const exitCode=await new Promise((accept,reject)=>{
      const child=spawn(process.execPath,args,{cwd:root,stdio:['ignore',fd,fd]});
      child.once('error',reject);child.once('exit',(code,signal)=>{step.signal=signal;accept(code);});
    });
    step.exitCode=exitCode;step.finished=new Date().toISOString();save();
    if(exitCode!==0)throw new Error(`${stage} failed (exit ${exitCode}); inspect ${log}`);
  }finally{closeSync(fd);}
}
try{
  await run('play',['tools/bot/run.mjs','--seed','1','--starter','1','--center','trades','--corner','earned','--mode','all','--max-attempts','200','--grind','3','--max-battles','12000','--dex-visits','8000','--out',bot]);
  const report=join(bot,'report.json'),result=read(report);
  if(!result.requestedComplete||!result.completion.complete||result.inherited)throw new Error('Fresh run did not meet full completion requirements.');
  state.gameHours=result.totalTicks/21/3600;save();
  await run('observe',['--loader','./tools/video/observe-loader.mjs','tools/video/export-descriptors.mjs',report,descriptors]);
  const manifest=join(descriptors,'descriptors.json');
  await run('preflight',['--loader','./tools/video/observe-loader.mjs','tools/video/preflight.mjs',manifest]);
  // Long earned-training runs require a bounded bitrate. Leave headroom for
  // raw resumable segments, assembled MP4s, and encoder bitrate variation.
  const bitrate=350000,fs=statfsSync(root),free=fs.bavail*fs.bsize;
  const estimate=state.gameHours*3600*(1+1/20+1/60)*bitrate/8*2.5+15e9;
  state.recording={speeds:[1,20,60],bitrate,estimatedPeakBytes:estimate,freeBytes:free};save();
  if(free<estimate)throw new Error(`Estimated recording space ${Math.ceil(estimate/1e9)} GB exceeds available ${Math.floor(free/1e9)} GB.`);
  await run('record',['tools/video/record.mjs','--report',report,'--descriptors',manifest,'--out',video,'--speeds','1,20,60','--workers','3','--bitrate',String(bitrate)]);
  if(read(join(video,'recording.json')).status!=='complete')throw new Error('Recorder did not verify a complete full-run export.');
  state.status='complete';state.finished=new Date().toISOString();save();
  console.log(`Complete: ${video}`);
}catch(error){state.status='failed';state.error=error.stack;state.finished=new Date().toISOString();save();console.error(error.stack);process.exitCode=1;}
