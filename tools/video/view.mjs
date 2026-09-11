import Phaser from 'phaser';
import { BattleScene, spriteKey } from '../../src/scene.js';
import { createOriginalRenderer } from '../../src/original-story-ui.js';

const WIDTH = 960, HEIGHT = 640, PLAY = { x: 80, y: 64, width: 800, height: 480 };
const COLORS = { background: '#101722', panel: '#192432', ink: '#f3f6fa', muted: '#aebfd0', accent: '#99d16a', line: '#314152' };
const FORMS = ['normal', 'shiny', 'shadow'];
const clamp = value => Math.max(0, Math.min(1, value));
const makeCanvas = (width, height) => Object.assign(document.createElement('canvas'), { width, height });
// Phaser uses random texture keys. Rendering must not consume the bot's RNG.
// Keep this scope synchronous: awaiting browser work must never replace globals.
function visualCall(fn) {
  const previous = Math.random;
  Math.random = () => 0.2718281828459045;
  try { return fn(); } finally { Math.random = previous; }
}
const dexIds = save => new Set(FORMS.flatMap(form => save?.dex?.[form] ?? []).filter(id => id >= 1 && id <= 151));
const clockText = seconds => {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(value / 3600)).padStart(2, '0')}:${String(Math.floor(value / 60) % 60).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
};

/** A read-only presentation of live bot state. No engine tick, save operation,
 * controller click, stat assignment or player action is performed here.
 * Callers serve this page with <base href="/"> so original asset URLs resolve.
 */
export async function createVideoView({ data, assets }) {
  if (!data?.timelines || !assets?.pokemon || !assets?.maps || !assets?.effects) throw new Error('Video view requires the original timeline and asset manifests.');
  const canvas = makeCanvas(WIDTH, HEIGHT), context = canvas.getContext('2d', { alpha: false });
  const storyCanvas = makeCanvas(800, 480), storyRenderers = new Map(), safariRenderers = new Map();
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', left: '-10000px', top: '0', width: '800px', height: '480px', overflow: 'hidden' });
  const loading = document.createElement('div');
  loading.id = 'loading'; host.append(loading); document.body.append(host);
  const errors = [];
  let scene, game, disposed = false, currentMeta = {};
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const app = {
    data, assets: { ...assets, audio: assets.audio ?? {} }, battle: null,
    save: { settings: { speed: 1, sound: false, music: false } }, activeDrag: null,
    toast(message) { errors.push(String(message)); },
    renderHUD() {}, applyOriginalSettings() {},
    sceneReady(value) { scene = value; queueMicrotask(() => { game.loop.stop(); resolveReady(); }); },
  };
  class VideoScene extends BattleScene {
    // Loading, display objects and native renderer are the original scene.
    // Its wall-clock simulation and input loops are deliberately not installed.
    update() {}
    updateMusic() {}
    soundEffect() {}
    loadSpotHighlights() {}
  }
  try {
    game = visualCall(() => new Phaser.Game({
      type: Phaser.CANVAS, parent: host, width: 800, height: 480,
      backgroundColor: '#000000', pixelArt: true,
      scale: { mode: Phaser.Scale.NONE }, audio: { noAudio: true },
      input: { keyboard: false, mouse: false, touch: false, gamepad: false },
      render: { antialias: false, roundPixels: true }, scene: new VideoScene(app),
      callbacks: { postBoot(value) { value.events.once('destroy', () => { if (!scene) rejectReady(new Error('Video renderer was destroyed before it was ready.')); }); } },
    }));
    await ready;
    checkErrors();
  } catch (error) { host.remove(); game?.destroy(true); throw error; }

  function checkErrors() {
    if (disposed) throw new Error('Video view has been disposed.');
    if (errors.length) throw new Error(`Video artwork failed: ${errors.join('; ')}`);
  }
  function text(value, x, y, { size = 16, color = COLORS.ink, weight = 400, maxWidth, align = 'left' } = {}) {
    context.font = `${weight} ${size}px Arial, sans-serif`; context.fillStyle = color; context.textAlign = align;
    let result = String(value ?? '');
    if (maxWidth) while (result.length > 1 && context.measureText(result).width > maxWidth) result = result.slice(0, -2) + '…';
    context.fillText(result, x, y); context.textAlign = 'left';
  }
  function metadata(meta = {}) { currentMeta = { ...currentMeta, ...meta }; return currentMeta; }
  function saveFor(meta) { return meta.save ?? (meta._card ? null : app.battle?.campaignSave ?? app.battle?.save); }
  function dexCount(meta) {
    const supplied = typeof meta.dex === 'number' ? meta.dex : meta.dex?.count ?? meta.dex?.owned ?? meta.completion?.dex?.owned;
    const save = saveFor(meta);
    return Number.isFinite(supplied) ? supplied : save ? dexIds(save).size : null;
  }
  function framing(meta, { card = false, story = false } = {}) {
    context.fillStyle = COLORS.background; context.fillRect(0, 0, WIDTH, HEIGHT);
    const battle = app.battle, level = battle?.level;
    const stage = level ? `${level.isChallenge || battle.isChallenge ? 'Challenge ' + (battle.challengeId ?? level.challengeId) : 'Stage ' + (level.progressionId ?? level.id)} · ${level.displayName ?? level.name ?? level.title ?? level.className}` : 'Pokémon Tower Defense';
    text(meta.title ?? stage, 80, 28, { size: 22, weight: 700, maxWidth: 710 });
    text(`${dexCount(meta) ?? '—'}/${meta.dexTotal ?? 151}`, 880, 28, { size: 20, weight: 700, color: COLORS.accent, align: 'right' });
    const profile = meta.profileName ?? meta.profile?.name ?? (typeof meta.profile === 'string' || typeof meta.profile === 'number' ? meta.profile : null);
    const subtitle = [profile ? `Profile ${profile}` : null, meta.purpose ?? meta.phase ?? meta.subtitle, meta.visit != null ? `Visit ${meta.visit}${meta.totalVisits ? '/' + meta.totalVisits : ''}` : null].filter(Boolean).join(' · ');
    text(subtitle || 'Deterministic native game replay', 80, 50, { size: 13, color: COLORS.muted, maxWidth: 700 });
    text('Pokédex union', 880, 47, { size: 11, color: COLORS.muted, align: 'right' });
    context.fillStyle = '#000'; context.fillRect(PLAY.x, PLAY.y, PLAY.width, PLAY.height);
    context.strokeStyle = COLORS.line; context.lineWidth = 1; context.strokeRect(79.5, 63.5, 801, 481);
    const seconds = meta.logicalSeconds ?? Number(meta.logicalFrame ?? (card ? 0 : battle?.frame) ?? 0) / 21;
    const wave = battle ? battle.level.mode === 'invasion' ? `Energy ${Math.floor(battle.energy ?? 0)} · Candy ${battle.stolenCandy ?? 0}/${battle.candies.length}` : `Wave ${Math.min(battle.currentWave, battle.totalWaves)}/${battle.totalWaves} · Candy ${battle.candies.filter(c => c.state !== 'lost').length}/${battle.candies.length}` : '';
    text(card ? meta.note ?? 'Recorded game progress' : `${wave}  ·  ${battle?.state ?? ''}`, 80, 563, { size: 12, color: COLORS.muted, maxWidth: 560 });
    text(`Logical time ${clockText(seconds)}`, 880, 563, { size: 12, color: COLORS.muted, align: 'right' });
    const fitNote = story ? 'Original story framing · native timeline animation' : card ? 'Progress card from recorded state' : 'Whole map fitted to frame · sampled native ticks';
    text(meta.footer ?? fitNote, 80, 628, { size: 11, color: COLORS.muted, maxWidth: 790 });
  }
  function drawPortrait(profile, x, y, size = 28) {
    if (!profile) return;
    const key = spriteKey(profile, assets.pokemon), info = assets.pokemon[key], image = scene.textures.get(key)?.getSourceImage();
    if (!image || !info) return;
    const frame = info.animations.front?.[0] ?? 0, scale = size / Math.max(info.frameWidth, info.frameHeight);
    context.imageSmoothingEnabled = false;
    context.drawImage(image, frame * info.frameWidth, 0, info.frameWidth, info.frameHeight, x + (size - info.frameWidth * scale) / 2, y + (size - info.frameHeight * scale) / 2, info.frameWidth * scale, info.frameHeight * scale);
  }
  function party() {
    const battle = app.battle;
    if (!battle) return;
    const profiles = battle.visibleParty ?? battle.party ?? [];
    for (let i = 0; i < 6; i++) {
      const profile = profiles[i], x = 80 + i * 135;
      context.fillStyle = COLORS.panel; context.fillRect(x, 574, 125, 36);
      if (!profile) continue;
      const actor = battle.level.mode === 'invasion' && !battle.canPlace ? battle.enemies.find(p => p.partyUid === profile.uid && p.alive) : battle.towers.find(p => p.uid === profile.uid);
      const hp = actor ? clamp(actor.hp / actor.maxHp) : 1;
      drawPortrait(profile, x + 2, 577);
      text(data.species[profile.speciesId]?.name ?? profile.nickname ?? 'Pokémon', x + 34, 587, { size: 10, weight: 700, maxWidth: 86 });
      text(`L${profile.level}${actor ? ' · ' + Math.round(hp * 100) + '%' : ''}`, x + 34, 601, { size: 10, color: COLORS.muted });
      context.fillStyle = COLORS.line; context.fillRect(x + 34, 605, 84, 3);
      context.fillStyle = hp <= .2 ? '#ed7d77' : COLORS.accent; context.fillRect(x + 34, 605, 84 * hp, 3);
    }
  }
  function fitMap() {
    const map = assets.maps[app.battle.level.background], bounds = map.sourceBounds;
    const zoom = Math.min(800 / map.width, 480 / map.height), camera = scene.cameras.main;
    camera.setOrigin(0).setZoom(zoom);
    camera.setScroll(bounds.xMin - (800 / zoom - map.width) / 2, bounds.yMin - (480 / zoom - map.height) / 2);
    scene.sourceX = -camera.scrollX * zoom; scene.sourceY = -camera.scrollY * zoom;
  }
  async function waitForNativeArt() {
    const view = scene.nativeView;
    if (!view) return;
    await view.ready; checkErrors();
    const wanted = new Set();
    function visit(node) {
      if (node.visible === false || node.alpha <= 0) return;
      const pokemon = assets.pokemon[node.symbolName], rendered = Boolean(pokemon || view.byId?.[node.symbolId]);
      if (!pokemon && view.byId?.[node.symbolId]) wanted.add(node.symbolId);
      for (const child of node.children ?? []) if (!rendered || !child.sourcePlacement) visit(child);
    }
    for (const node of app.battle.moveRuntime.world.children) visit(node);
    await Promise.all([...wanted].map(id => view.load(id)));
    // showLevel/render can have started a load already; load(id) intentionally
    // returns early for existing entries, so also wait for those exact entries.
    const deadline = performance.now() + 30000;
    while ([...wanted].some(id => !view.entries.get(id)?.ready && !view.entries.get(id)?.error)) {
      if (performance.now() > deadline) throw new Error('Timed out waiting for native move artwork.');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    checkErrors();
  }
  async function safariArt(moveId) {
    const symbol = moveId === 398 ? 'do_bait_throw' : 'do_rock_throw';
    if (!safariRenderers.has(symbol)) safariRenderers.set(symbol, (async () => {
      const meta = scene.nativeView.manifest.symbols[symbol], [x0, y0, x1, y1] = meta.bounds;
      const image = makeCanvas(Math.ceil(x1 - x0) + 4, Math.ceil(y1 - y0) + 4);
      return { renderer: await createOriginalRenderer(image, symbol), canvas: image, meta, x: x0 - 2, y: y0 - 2 };
    })());
    return safariRenderers.get(symbol);
  }
  async function drawSafari() {
    const battle = app.battle;
    if (battle?.level.mode !== 'safari') return;
    const camera = scene.cameras.main;
    for (const projectile of battle.projectiles ?? []) {
      if (projectile.done || !projectile.source?.alive) continue;
      const art = await safariArt(projectile.move.id);
      // These exact native projectiles live outside the native display list.
      // Recovered art follows their existing coordinates and age; no model is
      // instantiated and no hit, RNG draw or effect is produced by the view.
      visualCall(() => art.renderer.render({ currentFrame: 1 + projectile.age % art.meta.frames, clock: { frame: projectile.age }, x: -art.x, y: -art.y, alpha: 1 }));
      context.save(); context.beginPath(); context.rect(80, 64, 800, 480); context.clip();
      context.translate(80, 64); context.scale(camera.zoom, camera.zoom);
      context.drawImage(art.canvas, projectile.source.x + projectile.x + art.x - camera.scrollX, projectile.source.y + projectile.y + art.y - camera.scrollY);
      context.restore();
    }
  }
  async function paintBattle(meta, { story = false, runtime = null } = {}) {
    if (!app.battle) throw new Error('Set a battle before rendering a native frame.');
    await waitForNativeArt();
    let mapAlpha = 1, mapVisible = true;
    visualCall(() => {
      if (story && runtime?.stage?.gfx_BG) {
        const bg = runtime.stage.gfx_BG;
        scene.cameras.main.setOrigin(0).setZoom(bg.scaleX || 1);
        scene.sourceX = bg.x; scene.sourceY = bg.y;
        scene.cameras.main.setScroll(-bg.x / (bg.scaleX || 1), -bg.y / (bg.scaleY || 1));
        mapAlpha = bg.alpha ?? 1; mapVisible = bg.visible !== false;
      } else fitMap();
      scene.render(); game.step(Number(meta.logicalFrame ?? app.battle.frame ?? 0) * 1000 / 21, 0);
    });
    framing(meta, { story });
    if (mapVisible) { context.save(); context.globalAlpha = mapAlpha; context.drawImage(game.canvas, 80, 64, 800, 480); context.restore(); }
    if (!story) await drawSafari();
    party(); checkErrors();
  }
  async function setBattle(battle, meta = {}) {
    checkErrors(); app.battle = battle; app.save = battle.campaignSave ?? battle.save; currentMeta = { ...meta };
    visualCall(() => { scene.showLevel(); fitMap(); });
    await waitForNativeArt();
    return canvas;
  }
  async function render(meta = {}) {
    metadata(meta); await paintBattle(currentMeta); return canvas;
  }
  async function storyFrame(runtime, meta = {}) {
    metadata(meta);
    const root = runtime?.root;
    await paintBattle(currentMeta, { story: true, runtime });
    if (root && runtime.renderRoot?.visible !== false) {
      const symbol = root.symbolName;
      if (!storyRenderers.has(symbol)) storyRenderers.set(symbol, createOriginalRenderer(storyCanvas, symbol));
      const renderer = await storyRenderers.get(symbol);
      visualCall(() => renderer.render(runtime.renderRoot));
      context.drawImage(storyCanvas, 80, 64);
    }
    checkErrors(); return canvas;
  }
  async function card(meta = {}) {
    // Jobs can render on different workers. A card without a save must not
    // inherit the unrelated previous job's party, Pokédex or metadata.
    currentMeta = { ...meta, _card: true }; framing(currentMeta, { card: true });
    context.fillStyle = COLORS.panel; context.fillRect(80, 64, 800, 480);
    const save = saveFor(currentMeta), dex = dexIds(save), kind = currentMeta.kind ?? currentMeta.type ?? '';
    if (/dex/i.test(kind) && save) {
      text(currentMeta.heading ?? 'Kanto Pokédex', 104, 101, { size: 25, weight: 700 });
      text(`${dexCount(currentMeta)}/151 species · normal, shiny and shadow combined`, 104, 124, { size: 13, color: COLORS.muted });
      const columns = 19, cellWidth = 39, cellHeight = 45;
      for (let id = 1; id <= 151; id++) {
        const x = 108 + ((id - 1) % columns) * cellWidth, y = 143 + Math.floor((id - 1) / columns) * cellHeight;
        context.globalAlpha = dex.has(id) ? 1 : .16;
        const form = FORMS.findIndex(name => save.dex?.[name]?.includes(id));
        drawPortrait({ speciesId: id, shiny: Math.max(0, form) }, x, y, 30);
        text(String(id).padStart(3, '0'), x + 15, y + 40, { size: 9, color: COLORS.muted, align: 'center' });
        context.globalAlpha = 1;
      }
    } else {
      text(currentMeta.heading ?? currentMeta.title ?? 'Recorded progress', 112, 116, { size: 28, weight: 700, maxWidth: 736 });
      const lines = currentMeta.lines ?? currentMeta.details ?? [];
      const values = Array.isArray(lines) ? lines : String(lines).split('\n');
      values.slice(0, 10).forEach((line, index) => text(typeof line === 'object' ? `${line.label ?? line.type ?? ''}${line.value != null ? ': ' + line.value : ''}` : line, 112, 164 + index * 32, { size: 17, color: index ? COLORS.muted : COLORS.ink, maxWidth: 732 }));
      if (save && !values.length) {
        text(`Pokédex ${dexCount(currentMeta)}/151`, 112, 178, { size: 24, color: COLORS.accent });
        text(`Campaign ${save.completed?.length ?? 0}/42 · Challenges ${save.challengeCompleted ?? 0}/6`, 112, 219, { size: 19 });
        text(`Money ${save.money ?? 0} · Pokémon ${save.pokemon?.length ?? 0}`, 112, 254, { size: 17, color: COLORS.muted });
      }
    }
    checkErrors(); return canvas;
  }
  function dispose() {
    if (disposed) return;
    disposed = true; scene.nativeView?.destroy(); scene.nativeView = null;
    game.loop.stop(); visualCall(() => { game.destroy(true); game.runDestroy(); });
    host.remove(); storyRenderers.clear(); safariRenderers.clear();
  }
  return { canvas, setBattle, render, storyFrame, card, dispose,
    presentation: { width: WIDTH, height: HEIGHT, gameplay: PLAY, camera: 'whole-map-fit; original source framing during stories', safariProjectiles: 'original Bait/Rock artwork at the live native projectile coordinates and age', audio: false },
  };
}
