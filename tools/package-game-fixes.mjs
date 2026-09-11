#!/usr/bin/env node
/** Package only production fixes and their independent regressions. */
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const files=['src/model.js','src/safari-battle.js','src/achievements.js','src/battle.js','src/move-native.js','src/rock-tunnel.js','src/story-data-controllers.js',
 'tests/capture-capacity.test.js','tests/experience-overflow.test.js','tests/move-native.test.js','tests/native-text.test.js','tests/rock-tunnel.test.js','tests/story-runtime.test.js','tests/story-reward-gates.test.js'];
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:20*1024*1024});
const sha=content=>createHash('sha256').update(content).digest('hex');
const base=git(['rev-parse','HEAD']).trim(),tracked=[],added=[],rows=[];
for(const path of files){let before=null;try{before=git(['show',`${base}:${path}`]);tracked.push(path);}catch{added.push(path);}
 rows.push({path,beforeSha256:before===null?null:sha(before),afterSha256:sha(readFileSync(join(root,path)))});}
let patch=git(['diff','--binary',base,'--',...tracked]);
for(const path of added){try{patch+=git(['diff','--no-index','--','/dev/null',path]);}catch(error){if(error.status!==1)throw error;patch+=error.stdout;}}
const out=join(root,'docs/game-fixes');mkdirSync(out,{recursive:true});
const patchPath=join(out,'game-fixes.patch');writeFileSync(patchPath,patch);
const verification=mkdtempSync(join(tmpdir(),'ptd-fix-apply-'));
try{
 for(const path of tracked){mkdirSync(dirname(join(verification,path)),{recursive:true});writeFileSync(join(verification,path),git(['show',`${base}:${path}`]));}
 execFileSync('git',['apply','--check',patchPath],{cwd:verification});
 execFileSync('git',['apply',patchPath],{cwd:verification});
 for(const row of rows)if(sha(readFileSync(join(verification,row.path)))!==row.afterSha256)throw new Error(`Applied content mismatch: ${row.path}`);
 writeFileSync(join(out,'manifest.json'),JSON.stringify({baseCommit:base,patchSha256:sha(patch),verifiedApply:true,
  verification:'Applied to the base versions in an isolated temporary directory; every output file matched the recorded SHA-256.',
  included:rows,excluded:['bot and video tools','bot-only tests','reports and media','package/dependency changes'],fixIds:Array.from({length:9},(_,i)=>`QA-${String(i+1).padStart(3,'0')}`)},null,2)+'\n');
 console.log(`Packaged and verified ${files.length} files at ${patchPath}`);
}finally{rmSync(verification,{recursive:true,force:true});}
