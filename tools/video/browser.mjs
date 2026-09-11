import {createVideoView} from './view.mjs';
import {createVideoEncoders} from './encoder.mjs';
import {replayBattle} from './replay-battle.mjs';

const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
async function digest(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(stable(value)));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function json(path) {const response = await fetch(path); if (!response.ok) throw new Error(`Cannot load ${path}`); return response.json();}
window.videoReady = (async () => {
  const [data, levelData, pokemon, maps, effects, audio, timelines, endingManifest] = await Promise.all([
    '/data/game-data.json', '/data/levels.json', '/assets/pokemon-manifest.json', '/assets/map-manifest.json',
    '/assets/effects-manifest.json', '/assets/audio-manifest.json', '/data/story-timelines.json', '/assets/story36/manifest.json',
  ].map(json));
  Object.assign(data, {timelines, endingManifest});
  const game = {data, ...levelData}, view = await createVideoView({data, assets: {pokemon, maps, effects, audio}});
  document.body.append(view.canvas);
  document.querySelector('#loading')?.remove();
  window.renderVideoJob = async (job, options) => {
    const encoder = await createVideoEncoders({key: job.key, ...options});
    let battle, replay, frameCount = 0, preview, storyPreview;
    let lastProgress = performance.now();
    const meta = {...job.meta, profile: job.actions.source, visit: job.visitNumber, totalVisits: job.totalVisits,
      logicalFrame: job.sourceStartFrame, logicalSeconds: job.sourceStartFrame / options.fps};
    async function encode({hold = false} = {}) {
      await encoder.frame(view.canvas, {hold}); frameCount++;
      if (performance.now() - lastProgress > 3000) {
        lastProgress = performance.now();
        await window.videoProgress?.({key: job.key, frames: frameCount, expected: job.frames});
      }
    }
    function clock() {return {logicalFrame: job.sourceStartFrame + frameCount, logicalSeconds: (job.sourceStartFrame + frameCount) / options.fps};}
    try {
      if (job.kind === 'card') {
        await view.card({...meta, note: job.meta.subtitle, footer: 'Recorded activity summary · fixed readable hold at every playback speed'});
        preview = view.canvas.toDataURL('image/png');
        for (let i = 0; i < job.frames; i++) await encode({hold: true});
      } else {
        const descriptor = await json(job.descriptorUrl);
        replay = await replayBattle(game, descriptor, {
          async onBattle(value) {battle = value; await view.setBattle(battle, meta);},
          async onFrame(value, phase) {
            await view.render({...clock(), phase: phase.phase});
            if (value.frame === Math.min(420, descriptor.attempt.frames)) preview = view.canvas.toDataURL('image/png');
            await encode();
          },
          async onStoryFrame(runtime, phase) {
            await view.storyFrame(runtime, {...clock(), phase: `${phase.phase} story`});
            if (runtime.clock.frame === 80) storyPreview = view.canvas.toDataURL('image/png');
            await encode();
          },
        });
        const saveHash = await digest(replay.save);
        if (saveHash !== descriptor.attempt.saveHash) throw new Error(`Final save diverged for ${job.key}: ${saveHash}`);
        if (frameCount !== replay.frameCount || (job.timingVerified && frameCount !== job.frames)) throw new Error(`Native frame count differs for ${job.key}: ${frameCount}/${job.frames}`);
        replay = {key: replay.key, outcome: replay.outcome, battleFrames: replay.battleFrames, storyFrames: replay.storyFrames,
          frameCount: replay.frameCount, saveHash, matches: {...replay.matches, save: true}};
      }
      const encoded = await encoder.finish();
      return {...encoded, replay, presentation: view.presentation, preview: preview ?? view.canvas.toDataURL('image/png'), storyPreview};
    } catch (error) {encoder.abort(); throw error;}
    finally {battle?.dispose();}
  };
  return {presentation: view.presentation};
})();
