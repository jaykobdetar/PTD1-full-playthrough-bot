import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { chromium } from './node_modules/playwright-core/index.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = new URL('../../artifacts/video/view-smoke/', import.meta.url);
mkdirSync(out, { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5183', '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
try {
  await Promise.race([
    new Promise((resolve, reject) => {
      server.stdout.on('data', data => { if (String(data).includes('http://127.0.0.1:5183')) resolve(); });
      server.stderr.on('data', data => { if (/error|Error/.test(String(data))) reject(new Error(String(data))); });
      server.once('exit', code => reject(new Error(`Vite exited with ${code}`)));
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Video test server did not start.')), 10000).unref()),
  ]);
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__video_view_test__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><head><base href="/"></head><body style="margin:0;background:#101722"></body>' }));
  await page.goto('http://127.0.0.1:5183/__video_view_test__');
  const checkpoint = JSON.parse(readFileSync(new URL('../../docs/bot-repros/xp-overflow/checkpoint.json', import.meta.url)));
  const result = await page.evaluate(async checkpoint => {
    const [{ createVideoView }, { Battle }, { SafariBattle }, { ChallengeBattle }, { newSave }, { initializeStageHooks }, { createPolicy }, { StoryRuntime }] = await Promise.all([
      import('/tools/video/view.mjs'), import('/src/battle.js'), import('/src/safari-battle.js'), import('/src/challenge-battle.js'), import('/src/model.js'), import('/src/stage-hooks.js'), import('/tools/bot/policy.mjs'), import('/src/story-runtime.js'),
    ]);
    const [data, levels, pokemon, maps, effects, audio, timelines] = await Promise.all(['data/game-data.json', 'data/levels.json', 'assets/pokemon-manifest.json', 'assets/map-manifest.json', 'assets/effects-manifest.json', 'assets/audio-manifest.json', 'data/story-timelines.json'].map(path => fetch('/' + path).then(r => r.json())));
    data.timelines = timelines;
    const view = await createVideoView({ data, assets: { pokemon, maps, effects, audio } });
    document.body.append(view.canvas);
    const save = newSave(data, 1), battle = new Battle(data, levels.levels.find(l => l.id === 1), save, () => {}, { seed: 1, rng: () => .5 });
    initializeStageHooks(battle); const policy = createPolicy(battle); policy.prepare(); battle.start({ allowEmpty: true });
    for (let i = 0; i < 3000 && battle.state === 'running'; i++) {
      policy.step(); battle.tick();
      if (JSON.stringify(battle.moveRuntime.snapshot()).match(/"symbolName":"(?:do_|hit_)/)) break;
    }
    const snapshot = b => JSON.stringify({ save: b.save, campaignSave: b.campaignSave, frame: b.frame, state: b.state, stats: b.stats, towers: b.towers.map(p => [p.uid, p.hp, p.x, p.y, p.cooldown]), enemies: b.enemies.map(p => [p.uid, p.hp, p.x, p.y]), native: b.moveRuntime.snapshot(), projectiles: b.projectiles?.map(p => [p.x, p.y, p.age, p.done]) });
    let randomCalls = 0; const before = snapshot(battle), originalRandom = Math.random;
    Math.random = () => { randomCalls++; return .5; };
    await view.setBattle(battle, { profile: 'Red', purpose: 'Browser renderer verification' });
    await view.render(); const first = view.canvas.toDataURL();
    await view.render(); const second = view.canvas.toDataURL();
    Math.random = originalRandom;
    const after = snapshot(battle);
    const runtime = new StoryRuntime(data, { timelines, save, level: battle.level, battle, rng: () => .5 });
    runtime.open(battle.level.introPopup); runtime.tick(20);
    const storyBefore = JSON.stringify({ clock: runtime.clock.frame, save, root: runtime.root.currentFrame });
    await view.storyFrame(runtime, { phase: 'Original story' }); const story = view.canvas.toDataURL();
    const storyAfter = JSON.stringify({ clock: runtime.clock.frame, save, root: runtime.root.currentFrame });
    const safari = new SafariBattle(data, levels.levels.find(l => l.id === 29), structuredClone(checkpoint.save), () => {}, { seed: 1, rng: () => .5 });
    initializeStageHooks(safari); const safariPolicy = createPolicy(safari, { targetSpecies: [115, 128] }); safariPolicy.prepare(); safari.start();
    for (let i = 0; i < 1000 && !safari.projectiles.length; i++) { safariPolicy.step(); safari.tick(); }
    if (safari.projectiles.length) safari.tick();
    const safariBefore = snapshot(safari);
    await view.setBattle(safari, { profile: 'Red', purpose: 'Safari native projectile verification' });
    await view.render(); const safariImage = view.canvas.toDataURL(), safariAfter = snapshot(safari);
    const challenge = new ChallengeBattle(data, levels.variants.find(l => l.challengeId === 1), structuredClone(checkpoint.save), () => {}, { seed: 1, rng: () => .5 });
    const challengePolicy = createPolicy(challenge); challengePolicy.prepare(); challenge.start({ allowEmpty: true });
    for (let i = 0; i < 100 && challenge.state === 'running'; i++) { challengePolicy.step(); challenge.tick(); }
    const challengeBefore = snapshot(challenge);
    await view.setBattle(challenge, { profile: 'Red', purpose: 'Temporary challenge party verification' });
    await view.render(); const challengeImage = view.canvas.toDataURL(), challengeAfter = snapshot(challenge);
    await view.card({ kind: 'pokedex', title: 'Recorded Pokédex', save: checkpoint.save }); const dex = view.canvas.toDataURL();
    const output = { unchanged: before === after, identicalFrames: first === second, randomCalls, storyUnchanged: storyBefore === storyAfter, safariUnchanged: safariBefore === safariAfter, safariProjectiles: safari.projectiles.length, challengeUnchanged: challengeBefore === challengeAfter, temporaryChallengeParty: challenge.party.filter(Boolean).every(p => p.temporary), presentation: view.presentation, images: { battle: first, story, safari: safariImage, challenge: challengeImage, dex } };
    view.dispose(); return output;
  }, checkpoint);
  for (const [name, url] of Object.entries(result.images)) writeFileSync(new URL(name + '.png', out), Buffer.from(url.split(',')[1], 'base64'));
  delete result.images;
  assert.equal(result.unchanged, true, 'native battle/save/display state changed during rendering');
  assert.equal(result.identicalFrames, true, 'repeated native frame pixels differ');
  assert.equal(result.randomCalls, 0, 'renderer consumed gameplay RNG');
  assert.equal(result.storyUnchanged, true, 'story rendering advanced or changed the controller');
  assert.equal(result.safariUnchanged, true, 'Safari rendering changed projectile/game state');
  assert.ok(result.safariProjectiles > 0, 'no real Safari projectile was available to verify');
  assert.equal(result.challengeUnchanged, true, 'challenge rendering changed the model or persistent save');
  assert.equal(result.temporaryChallengeParty, true, 'challenge renderer test did not use the real temporary team');
  assert.deepEqual(errors, [], 'browser errors');
  writeFileSync(new URL('result.json', out), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) { const exited = once(server, 'exit'); server.kill(); await exited.catch(() => {}); }
}
