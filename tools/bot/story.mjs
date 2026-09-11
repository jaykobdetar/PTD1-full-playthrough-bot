import { readFileSync } from 'node:fs';
import { StoryRuntime } from '../../src/story-runtime.js';
import { STORY_CONTROLLERS } from '../../src/story-data-controllers.js';
import { storyWinController } from '../../src/story-data-stage.js';
import { EndingStory } from '../../src/ending-story.js';
import { ROCK_TUNNEL_ROOMS, partyHasFlash, tunnelParty, rockTunnelSession } from '../../src/rock-tunnel.js';

const progressionActions = new Set(['quest-progress', 'profile-change', 'pokemon-reward', 'item-reward', 'achievement', 'save']);
const endingManifest = () => JSON.parse(readFileSync(new URL('../../public/assets/story36/manifest.json', import.meta.url), 'utf8'));

function profileSummary(profile) {
  return { uid: profile.uid, speciesId: profile.speciesId, level: profile.level, shiny: profile.shiny };
}

function progressSnapshot(save) {
  return {
    unlocked: save.unlocked, completed: [...save.completed], badges: save.badges ?? 0,
    money: save.money, haveFlash: Boolean(save.haveFlash),
    pokemon: save.pokemon.map(profileSummary),
    originalExtraInfo: [...(save.originalExtraInfo ?? [])],
    inventory: { ...save.inventory }, achievements: { ...save.achievements },
  };
}

function progressDelta(before, save) {
  const after = progressSnapshot(save);
  return Object.fromEntries(Object.keys(after).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key])).map(key => [key, { before: before[key], after: after[key] }]));
}

function summarizeAction(action, frame) {
  const result = { frame, type: action.type };
  for (const key of ['id', 'quantity', 'value', 'popup', 'name', 'destination', 'levelId', 'waveClass']) {
    if (action[key] !== undefined) result[key] = action[key];
  }
  if (action.profile) result.profile = profileSummary(action.profile);
  if (action.type === 'trace') result.values = action.values.map(String);
  if (action.type === 'source-message') result.message = typeof action.message === 'string' ? action.message : action.message?.[0];
  return result;
}

/** Click only controls exposed by the recovered movie at its current frame.
 * These choices never call controller internals or set progression flags.
 * Passing a function permits a deterministic policy for a particular cutscene.
 */
export function chooseStoryControl(runtime, { choice = 'yes', direction = 'left', chooseControl } = {}) {
  const controls = runtime.controls.filter(control => control.width > 0 && control.height > 0);
  if (chooseControl) {
    const chosen = chooseControl({ runtime, controls });
    if (chosen) return controls.find(control => control.name === (chosen.name ?? chosen));
  }
  const owned=new Set(['normal','shiny','shadow'].flatMap(form=>runtime.save.dex?.[form]??[]));
  const dojo=runtime.save.gameVersion===2?'butt_hitmonchan':'butt_hitmonlee';
  const reward=controls.find(c=>c.name===dojo)
    ?? controls.find(c=>c.name==='butt_omanyte'&&!owned.has(138))
    ?? controls.find(c=>c.name==='butt_kabuto'&&!owned.has(140));
  if(reward)return reward;
  return controls.find(control => /^butt_(next|end|start|close)$/.test(control.name))
    ?? controls.find(control => control.name === `butt_${choice}`)
    ?? controls.find(control => control.name === `btn_${direction}`)
    ?? controls.find(control => /^btn_(left|right|up|down|end)$/.test(control.name));
}

/** Headless execution of the same StoryRuntime used by original-story-ui.js.
 * No Skip button is used, so first-visit dialogue and reward branches execute.
 * A bounded failure includes the visible controls and the last input history.
 */
export function runStory(data, {
  level, save, battle = null, controller, phase = 'custom', event = null,
  args, stageFlags = {}, rng = () => 0.5, maxFrames = 20000,
  stallFrames = 2100, clickEvery = 5, onAction, ...policy
} = {}) {
  if (!controller) return { phase, controller: null, skipped: true, actions: [], inputs: [], changes: {}, nextStage: null };
  if (!STORY_CONTROLLERS[controller]) throw new Error(`Missing story controller ${controller} for ${level?.id} (${phase}).`);
  if (!data.timelines) throw new Error('The story bot requires data.timelines from public/data/story-timelines.json.');
  if (!Number.isInteger(clickEvery) || clickEvery < 1 || !Number.isInteger(maxFrames) || maxFrames < 1 || !Number.isInteger(stallFrames) || stallFrames < 1) throw new Error('Story frame bounds and clickEvery must be positive integers.');
  const actions = [], inputs = [], before = progressSnapshot(save);
  let completion = null;
  const runtime = new StoryRuntime(data, {
    timelines: data.timelines, save, level, battle,
    stageFlags: { ...battle?.stageFacts, ...stageFlags }, rng,
    onAction(action) {
      // Audio is emitted every animation frame by some recovered controllers;
      // it does not describe progression and needlessly bloats the audit log.
      if (!action.type.startsWith('audio-') && action.type !== 'battle-audio-pause') actions.push(summarizeAction(action, action.runtime.clock.frame));
      onAction?.(summarizeAction(action, action.runtime.clock.frame));
    },
    onComplete(result) { completion = result; },
  });
  const controllerArgs = (typeof args === 'function' ? args(runtime) : args)
    ?? [runtime.stage, ...(battle?.isChallenge && phase === 'win' ? [!event?.reward] : [])];
  let stableFrames = 0, previous = '';
  // Recovered controller functions still reference the module-global Math,
  // despite StoryRuntime supplying this.Math. Scope its random source for this
  // synchronous driver and always restore it, including on diagnostic failure.
  const originalRandom = Math.random;
  try {
    Math.random = rng;
    runtime.open(controller, controllerArgs);
    for (let frame = 0; frame < maxFrames && !runtime.closed; frame++) {
      runtime.tick();
      const signature = JSON.stringify([runtime.controllerName, runtime.root?.symbolName, runtime.root?.currentFrame, runtime.root?.currentLabel, runtime.controls.map(control => control.name), actions.length]);
      stableFrames = signature === previous ? stableFrames + 1 : 0;
      previous = signature;
      if (stableFrames >= stallFrames) break;
      if (frame % clickEvery || runtime.closed) continue;
      const control = chooseStoryControl(runtime, policy);
      if (control) {
        inputs.push({ frame: runtime.clock.frame, control: control.name, label: runtime.root?.currentLabel });
        runtime.click(control.clip);
      }
    }
    if (!runtime.closed) throw new Error(`Story made no terminating transition within ${runtime.clock.frame} frames.`);
  } catch (cause) {
    const error = new Error(`Story ${level?.id} ${phase} ${runtime.controllerName}: ${cause.message}`, { cause });
    error.diagnostic = {
      levelId: level?.id, phase, controller: runtime.controllerName, frame: runtime.clock.frame,
      label: runtime.root?.currentLabel, visibleControls: runtime.controls.map(control => control.name),
      lastInputs: inputs.slice(-12), lastActions: actions.slice(-12),
    };
    throw error;
  } finally {
    Math.random = originalRandom;
  }
  const transition = {
    type: completion?.type ?? 'popup-closed',
    destination: completion?.destination ?? null,
    waveClass: completion?.args?.[2]?.sourceClass ?? null,
  };
  return {
    phase, controller, frames: runtime.clock.frame, transition,
    nextStage: transition.type === 'change-stage' && !transition.destination?.startsWith('screen_') ? transition.destination : null,
    actions, inputs, changes: progressDelta(before, save),
    rewards: actions.filter(action => progressionActions.has(action.type)),
  };
}

/** The campaign runner still starts/ticks combat. This resolves only the intro.
 * Stage 36 has no combat: EndingStory owns its normal progression operation;
 * the recovered closing movie performs its trade, Pokédex update and badge.
 */
export function resolveIntro(data, level, save, battle, options = {}) {
  if (battle?.originalIntroComplete) return { phase: 'intro', skipped: true, actions: [], inputs: [], changes: {}, nextStage: null };
  const result = runStory(data, { ...options, level, save, battle, controller: level.introPopup, phase: 'intro' });
  if (result.nextStage) return result;
  if (battle) battle.originalIntroComplete = true;
  if (level.id !== 36) return result;
  if (!battle) throw new Error('Stage 36 story requires its live battle instance.');
  const before = progressSnapshot(save);
  const ending = new EndingStory(battle, options.endingManifest ?? endingManifest());
  ending.completeIntro();
  const win = resolveWin(data, level, save, battle, { won: true }, options);
  ending.closeEnding();
  return {
    ...result, terminal: true, won: battle.state === 'won', ending: win,
    actions: [...result.actions, { type: 'story-progress', levelId: 36 }, ...win.actions, { type: 'story-complete', levelId: 36 }],
    inputs: [...result.inputs, ...win.inputs],
    changes: progressDelta(before, save),
    rewards: [...result.rewards, ...win.rewards],
  };
}

export function resolveWin(data, level, save, battle, event, options = {}) {
  if (!event?.won) return { phase: 'win', skipped: true, actions: [], inputs: [], changes: {}, nextStage: null };
  const result = runStory(data, { ...options, level, save, battle, event, controller: storyWinController(level), phase: 'win' });
  // Stages such as the four-part Indigo Plateau supply the next battle in the
  // finish event; no victory popup exists between those parts.
  return { ...result, nextStage: result.nextStage ?? event.nextStage ?? null };
}

export function tunnelPrerequisites(data, save, session = rockTunnelSession) {
  const party = tunnelParty(save);
  const missing = [];
  if (!partyHasFlash(save)) missing.push('A party Pokémon must know Flash (225). Obtain Cut after stage 16, teach it to a compatible Pokémon, replay Route 2 and cut the central bush without deploying Abra, then teach Flash for 10,000.');
  const eligible = speciesId => party.some(pokemon => pokemon.speciesId === speciesId && pokemon.level >= 42 && pokemon.myTag !== 'h');
  const shinyQuestMissing = [];
  if ((session.pikachuCaptures ?? 0) < 10) shinyQuestMissing.push(`Catch ${10 - (session.pikachuCaptures ?? 0)} more Pikachu in this game session.`);
  if (!eligible(25)) shinyQuestMissing.push('Place a legitimately obtained Pikachu at level 42 or higher in the party.');
  if (!eligible(101)) shinyQuestMissing.push('Place a legitimately obtained Electrode at level 42 or higher in the party.');
  return { ready: missing.length === 0, missing, shinyQuestReady: shinyQuestMissing.length === 0, shinyQuestMissing };
}

function firstDirection(from, target) {
  const queue = [{ room: from, first: null }], visited = new Set([from]);
  while (queue.length) {
    const { room, first } = queue.shift();
    for (const [direction, destination] of Object.entries(ROCK_TUNNEL_ROOMS[room].exits)) {
      if (!Number.isInteger(destination) || visited.has(destination)) continue;
      if (destination === target) return first ?? direction;
      visited.add(destination);
      queue.push({ room: destination, first: first ?? direction });
    }
  }
  throw new Error(`No Rock Tunnel route from room ${from} to ${target}.`);
}

/** Feed each returned action to tunnel.choose(action), then play any exposed
 * encounter with tunnel.bindBattle before initializeStageHooks. The real
 * battle finish callback resolves its flag; this policy never marks it won.
 */
export function nextTunnelAction(tunnel, { allRooms = true, claimQuest = true } = {}) {
  const view = tunnel.view();
  if (['battle', 'completed', 'left'].includes(view.status)) return null;
  if (view.status === 'requires-flash') throw new Error(tunnelPrerequisites(tunnel.data, tunnel.save, tunnel.session).missing.join(' '));
  if (view.status === 'failed') return 'leave';
  if (view.status === 'encounter') return 'battle';
  if (view.status === 'quest') return 'check-quest';
  if (view.status === 'quest-result') return 'continue';
  if (view.status === 'exit') return 'exit';
  if (view.status !== 'route') throw new Error(`Unsupported Rock Tunnel state: ${view.status}.`);
  const target = allRooms ? [1, 2, 4, 10, 8, 7, 5, 9].find(room => !tunnel.flags[ROCK_TUNNEL_ROOMS[room].flag]) : null;
  let action;
  if (target === 1 && view.room === 1) action = 'left';
  else if (target && target !== view.room) action = firstDirection(view.room, target);
  else if (target) throw new Error(`Rock Tunnel room ${target} is uncompleted but exposes no battle.`);
  else {
    const flags = new Set(tunnel.save.originalExtraInfo ?? []);
    const claim = claimQuest && flags.has(32) && !flags.has(33) && tunnelPrerequisites(tunnel.data, tunnel.save, tunnel.session).shinyQuestReady;
    const destination = claim ? 1 : 6;
    action = view.room === 6 && !claim ? 'left' : firstDirection(view.room, destination);
  }
  if (!view.actions.some(candidate => candidate.id === action)) throw new Error(`Tunnel route selected unavailable action ${action} in room ${view.room}.`);
  return action;
}
