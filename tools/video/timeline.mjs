import {readFileSync, existsSync, writeFileSync} from 'node:fs';
import {resolve, dirname, relative, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const read = path => JSON.parse(readFileSync(path, 'utf8'));
const actionType = row => row.type ?? row.action ?? 'unknown';
const menuActions = new Set(['train', 'evolve', 'learn-move', 'learn-healing']);
const outsideActions = new Set(['local-trade', 'local-trade-evolution', 'local-trade-return', 'restore-primary-party',
  'release-collection-duplicates', 'teach-field', 'learn-capture-move', 'learn-ghost-identification',
  'learn-capture-paralysis', 'learn-story-cut', 'tunnel-choice']);
const isOutside = row => !row.phase && (row.attempt == null || outsideActions.has(actionType(row))
  || /^(center-|collection-|auxiliary-)/.test(actionType(row)));
const category = row => actionType(row) === 'tunnel-choice' ? 'navigation'
  : actionType(row) === 'collection-plan' ? 'planning'
    : actionType(row) === 'collection-evolution-pass' && row.result?.changes?.length ? 'evolution'
      : actionType(row) === 'release-collection-duplicates' ? 'storage' : 'account';
const labels = {navigation: 'Rock Tunnel navigation', planning: 'Next collection objective', evolution: 'Collection evolutions',
  storage: 'Storage cleanup', account: 'Local Pokémon Center and profile activity', menu: 'Training and move activity'};

function ranges(rows) {
  const result = [];
  for (const {sequence} of [...rows].sort((a, b) => a.sequence - b.sequence)) {
    const last = result.at(-1);
    if (last && sequence === last[1] + 1) last[1] = sequence;
    else result.push([sequence, sequence]);
  }
  return result;
}
const actionRef = (source, rows) => ({source: source.key, reportPath: source.reportPath, actionPath: source.actionPath,
  ranges: ranges(rows), count: rows.length});
const countBy = (rows, key) => rows.reduce((counts, row) => {const value = key(row); counts[value] = (counts[value] ?? 0) + 1; return counts;}, {});

function summary(rows, kind, names) {
  const counts = countBy(rows, actionType), changes = rows.flatMap(row => row.result?.changes ?? []);
  const species = id => names?.[id]?.name ?? names?.[id] ?? `#${id}`;
  const lines = [];
  if (kind === 'navigation') lines.push(...rows.map(row => `Room ${row.room}: ${row.action} (${row.status})`));
  if (kind === 'planning') lines.push(...rows.map(row => row.reason ?? `Visit ${row.stage}`));
  const grants = rows.filter(row => row.pokemon?.speciesId).map(row => species(row.pokemon.speciesId));
  if (grants.length) lines.push(`Acquired: ${grants.slice(0, 8).join(', ')}${grants.length > 8 ? `, and ${grants.length - 8} more` : ''}`);
  const evolutions = [...rows, ...changes].filter(row => ['evolve', 'evolve-item'].includes(actionType(row)));
  if (evolutions.length) lines.push(`Evolved: ${evolutions.slice(0, 5).map(row => `${species(row.from)} → ${species(row.to)}`).join('; ')}${evolutions.length > 5 ? `; ${evolutions.length - 5} more` : ''}`);
  const trained = rows.filter(row => actionType(row) === 'train');
  if (trained.length) lines.push(`${trained.length} paid level-up${trained.length === 1 ? '' : 's'}; cost ${trained.reduce((n, row) => n + (row.cost ?? 0), 0)}`);
  const releases = rows.filter(row => actionType(row) === 'release-collection-duplicates');
  if (releases.length) lines.push(`Released ${releases.reduce((n, row) => n + (row.result?.count ?? 0), 0)} duplicates; ${releases.at(-1).result?.retained ?? '?'} Pokémon retained`);
  for (const row of rows.filter(row => actionType(row) === 'center-dailyCredits')) lines.push(`Profile ${row.after?.slot ?? row.before?.slot ?? 0}: credits ${row.before?.credits ?? '?'} → ${row.after?.credits ?? '?'}`);
  for (const row of rows.filter(row => /^auxiliary-trip-(start|finish)$/.test(actionType(row)))) lines.push(`${actionType(row).endsWith('start') ? 'Loan team and begin' : 'Return team after'} profile ${row.slot} trip`);
  const stones = changes.filter(row => row.action === 'buy-stone');
  if (stones.length) lines.push(`${stones.length} evolution stones purchased; cost ${stones.reduce((n, row) => n + row.cost, 0)}`);
  if (!lines.length) lines.push(Object.entries(counts).map(([type, count]) => `${type.replace(/^center-/, '').replaceAll('-', ' ')} ×${count}`).join(' · '));
  return {lines: lines.slice(0, 7), counts, changes, detailCount: lines.length};
}

function visitChapter(source, attempt, highestCampaign) {
  if (source.key !== 'primary') return {key: source.key, title: `${source.slot === 1 ? 'Blue' : source.slot === 2 ? 'Red' : 'Auxiliary'} profile ${source.slot ?? source.key}: campaign and collection`};
  if (attempt.purpose?.startsWith('collection')) return {key: 'collection', title: 'Pokédex completion: trades, captures and evolutions'};
  if (attempt.purpose === 'challenge') return {key: 'challenges', title: 'All six challenges, including retries'};
  if (attempt.purpose === 'tunnel') return {key: 'rock-tunnel', title: 'Rock Tunnel: every room and route'};
  const level = Math.max(highestCampaign, attempt.campaignId ?? 1);
  const [first, last] = [[1, 5], [6, 11], [12, 15], [16, 20], [21, 25], [26, 30], [31, 36], [37, 42]].find(([, last]) => level <= last) ?? [37, 42];
  return {key: `campaign-${first}-${last}`, title: `Campaign ${first}–${last}, including retries and preparation`};
}

function descriptorMap(input) {
  const path = typeof input === 'string' ? resolve(input) : null;
  const value = path ? read(path) : input;
  const rows = Array.isArray(value) ? value : value?.descriptors ?? value?.visits ?? [];
  if (!Array.isArray(rows)) throw new Error('Descriptor manifest must contain an array of visits');
  const map = new Map(rows.map(row => [row.key, {...row, descriptorPath: row.descriptorPath && path
    ? resolve(dirname(path), row.descriptorPath) : row.descriptorPath}]));
  if (map.size !== rows.length) throw new Error('Descriptor manifest contains duplicate visit keys');
  return {map, manifest: Array.isArray(value) ? null : value};
}

/** Build an observational video plan from the immutable bot reports/actions.
 * `actions` is an ownership reference: every source sequence belongs to exactly
 * one segment. Native menu actions receive a clearly labeled summary AFTER the
 * visit, because the historical bot never recorded those menus as UI footage.
 * Descriptors may be the exporter manifest filename, its object, or its rows.
 */
export function buildTimeline(reportPath, {descriptors, fps = 21, cardSeconds = 2, maxCardActions = 32, names,
  speeds = [1, 20, 60]} = {}) {
  if (!Number.isInteger(fps) || fps < 1 || !Number.isFinite(cardSeconds) || cardSeconds <= 0
    || !Number.isInteger(maxCardActions) || maxCardActions < 1) throw new Error('Invalid video timing or card limits');
  reportPath = resolve(reportPath);
  const rootDir = dirname(reportPath), descriptorInput = descriptorMap(descriptors), descriptorRows = descriptorInput.map,
    sources = [], insertions = [], segments = [];
  let cardNumber = 0;
  const card = (source, rows, kind, meta = {}) => ({kind: 'card', key: `card:${String(++cardNumber).padStart(5, '0')}`,
    reportPath: source.reportPath, actions: actionRef(source, rows), frames: Math.ceil(cardSeconds * fps), holdSeconds: cardSeconds,
    presentation: 'activity-summary', meta: {kind, title: labels[kind] ?? kind, subtitle: 'Recorded activity summary — not captured UI footage',
      scope: 'between-visits', ...summary(rows, kind, names), ...meta}});

  function loadSource(path, slot) {
    const report = read(path), dir = dirname(path), key = dir === rootDir ? 'primary' : relative(rootDir, dir).replaceAll('\\', '/');
    if (sources.some(source => source.key === key)) throw new Error(`Repeated report source ${key}`);
    const actionPath = join(dir, 'actions.jsonl'), text = readFileSync(actionPath, 'utf8').trim();
    const actions = text ? text.split('\n').map(JSON.parse) : [];
    actions.forEach((row, index) => {if (row.sequence !== index + 1) throw new Error(`Noncontiguous action sequence in ${key} at ${index + 1}`);});
    if (report.actionCount != null && report.actionCount !== actions.length) throw new Error(`Action count mismatch in ${key}`);
    const source = {key, slot, reportPath: path, actionPath, resultHash: report.resultHash, actionHash: report.actionHash,
      actionCount: actions.length, report, actions};
    sources.push(source);
    return source;
  }
  function appendSource(source) {
    const attempts = source.report.attempts ?? [], starts = new Map(), menus = new Map(), visitKeys = new Set();
    const byAttempt = new Map();
    for (const row of source.actions) if (!isOutside(row)) {
      if (!byAttempt.has(row.attempt)) byAttempt.set(row.attempt, []);
      byAttempt.get(row.attempt).push(row);
    }
    let highestCampaign = 1, previousAnchor = 0;
    for (const attempt of attempts) {
      const key = `${source.key}:${String(attempt.number).padStart(5, '0')}`;
      if (visitKeys.has(key)) throw new Error(`Repeated visit ${key}`);
      visitKeys.add(key);
      const rows = byAttempt.get(attempt.number) ?? [];
      if (!rows.length) throw new Error(`No recorded action anchor for visit ${key}`);
      const anchor = rows[0].sequence;
      if (anchor <= previousAnchor) throw new Error(`Visit order contradicts action order in ${key}`);
      previousAnchor = anchor;
      const menuRows = rows.filter(row => !row.phase && menuActions.has(actionType(row)));
      const liveRows = rows.filter(row => !menuRows.includes(row));
      if (attempt.purpose === 'progression') highestCampaign = Math.max(highestCampaign, attempt.campaignId ?? 1);
      const descriptor = descriptorRows.get(key);
      if (descriptor && ((descriptor.seed != null && descriptor.seed !== attempt.seed)
        || (descriptor.stage != null && descriptor.stage !== attempt.stage)
        || (descriptor.outcome != null && descriptor.outcome !== attempt.outcome))) throw new Error(`Descriptor does not match recorded visit ${key}`);
      const knownFrames = descriptor?.frameCount ?? descriptor?.sourceFrameCount
        ?? (Number.isInteger(descriptor?.storyFrames) && Number.isInteger(descriptor?.frames) ? descriptor.frames + descriptor.storyFrames : null);
      if (knownFrames != null && (!Number.isInteger(knownFrames) || knownFrames < 1)) throw new Error(`Invalid native frame count for ${key}`);
      const visit = {kind: 'visit', key, visitKey: key, reportPath: source.reportPath,
        checkpointPath: resolve(dirname(source.reportPath), attempt.checkpoint), descriptorPath: descriptor?.descriptorPath,
        actions: actionRef(source, liveRows), frames: knownFrames ?? Math.max(1, attempt.frames ?? 0), timingVerified: knownFrames != null,
        presentation: 'native-replay', chapter: visitChapter(source, attempt, highestCampaign),
        meta: {source: source.key, number: attempt.number, stage: attempt.stage, name: attempt.name, purpose: attempt.purpose,
          campaignId: attempt.campaignId, challengeId: attempt.challengeId, seed: attempt.seed, outcome: attempt.outcome,
          battleFrames: attempt.frames ?? 0, storyFrames: descriptor?.storyFrames ?? null, storyOnly: attempt.frames === 0,
          dexGained: attempt.collectionGained ?? attempt.dexGained ?? [], moneyDelta: attempt.moneyDelta, levelGains: attempt.levelGains ?? [], saveHash: attempt.saveHash}};
      starts.set(anchor, visit);
      if (menuRows.length) menus.set(key, card(source, menuRows, 'menu', {scope: 'during-visit', visitKey: key,
        title: `Activity during ${attempt.name ?? attempt.stage}`, chapter: visit.chapter}));
    }
    for (const attempt of byAttempt.keys()) if (!attempts.some(row => row.number === attempt)) throw new Error(`Actions reference missing visit ${source.key}:${attempt}`);
    const children = new Map();
    for (const aux of source.report.auxiliary ?? []) {
      const completion = source.actions.find(row => actionType(row) === 'auxiliary-playthrough' && row.path === aux.path && row.slot === aux.slot);
      const start = completion && source.actions.filter(row => row.sequence < completion.sequence
        && actionType(row) === 'auxiliary-trip-start' && row.slot === aux.slot).at(-1);
      if (!start || children.has(start.sequence)) throw new Error(`Missing or ambiguous auxiliary insertion for ${aux.path}`);
      children.set(start.sequence, aux);
    }
    let pending = [], pendingKind = null;
    const flush = () => {if (pending.length) segments.push(card(source, pending, pendingKind)); pending = []; pendingKind = null;};
    for (const row of source.actions) {
      const visit = starts.get(row.sequence);
      if (visit) {flush(); segments.push(visit); if (menus.has(visit.key)) segments.push(menus.get(visit.key));}
      if (isOutside(row)) {
        const kind = category(row);
        if (pending.length && (pendingKind !== kind || pending.length >= maxCardActions)) flush();
        pendingKind = kind; pending.push(row);
      }
      const aux = children.get(row.sequence);
      if (aux) {
        flush();
        const child = loadSource(resolve(dirname(source.reportPath), aux.path), aux.slot);
        if (child.report.resultHash !== aux.resultHash || child.report.attempts.length !== aux.attempts
          || child.report.totalTicks !== aux.totalTicks) throw new Error(`Auxiliary report differs from parent evidence: ${aux.path}`);
        insertions.push({parent: source.key, afterAction: row.sequence, beforeAction: row.sequence + 1, child: child.key});
        appendSource(child);
      }
    }
    flush();
  }

  const root = loadSource(reportPath);
  const descriptorManifest = descriptorInput.manifest;
  if (descriptorManifest?.verified === false
    || (descriptorManifest?.observedResultHash && descriptorManifest.observedResultHash !== root.report.resultHash)
    || (descriptorManifest?.expectedResultHash && descriptorManifest.expectedResultHash !== root.report.resultHash)
    || (descriptorManifest?.sourceFingerprint && descriptorManifest.sourceFingerprint !== root.report.fingerprint)) {
    throw new Error('Descriptor replay does not match the source report');
  }
  const initialPath = join(rootDir, 'initial-save.json'), initial = existsSync(initialPath) ? read(initialPath) : null;
  segments.push(card(root, [], 'Fresh deterministic run', {kind: 'start', save: initial, sourceSavePath: initialPath,
    chapter: {key: 'start', title: root.report.config?.center==='on'?'Fresh save and Pokécenter-assisted preparation':'Fresh starter and earned progression'},
    lines: [`Seed ${root.report.config?.seed ?? '?'} · native ${fps} ticks/second`, root.report.inherited ? 'Continuation from recorded prior evidence' : 'Fresh run — no inherited completion',
      ...(initial ? [`Initial money ${initial.money}; ${initial.pokemon?.length ?? 0} Pokémon; ${initial.completed?.length ?? 0} completed levels`] : [])]}));
  appendSource(root);
  const completion = root.report.completion ?? {}, countStatus = (rows, status) => (rows ?? []).filter(row => row.status === status).length;
  segments.push(card(root, [], 'Final recorded result', {kind: 'final', completion,
    chapter: {key: 'final', title: 'Final cleanup and completion evidence'},
    lines: [`Campaign ${countStatus(completion.campaign, 'won')}/42 · challenges ${countStatus(completion.challenges, 'won')}/6`,
      `Variants ${countStatus(completion.variants, 'won')} won + ${countStatus(completion.variants, 'visited')} navigation-only`,
      `Pokédex ${completion.dex?.owned ?? '?'}/151 species · ${root.report.issues?.length ?? 0} reported issues`,
      `Result SHA-256: ${root.report.resultHash ?? 'unavailable'}`]}));
  const finalPath = join(rootDir, 'final-save.json'), finalSave = read(finalPath);
  const speciesIds = [...new Set(['normal', 'shiny', 'shadow'].flatMap(form => finalSave.dex?.[form] ?? []))]
    .filter(id => id >= 1 && id <= 151).sort((a, b) => a - b);
  if (completion.dex?.owned != null && speciesIds.length !== completion.dex.owned) throw new Error('Final save Pokédex disagrees with report coverage');
  segments.push(card(root, [], 'Recorded final Pokédex', {kind: 'pokedex', save: finalSave, sourceSavePath: finalPath, speciesIds,
    chapter: {key: 'final', title: 'Final cleanup and completion evidence'},
    lines: [`${speciesIds.length}/151 species recorded across normal, shiny and shadow forms`,
      'Read from final-save.json after all recorded storage cleanup']}));

  // Attach between-visit summaries to the following chapter. During-visit menu
  // summaries retain their own visit chapter even when a child trip follows.
  let nextChapter = {key: 'final', title: 'Final cleanup and completion evidence'};
  for (const segment of [...segments].reverse()) {
    if (segment.chapter) nextChapter = segment.chapter;
    else segment.chapter = segment.meta.chapter ?? nextChapter;
    delete segment.meta.chapter;
  }
  const assignments = new Map(sources.map(source => [source.key, new Set()]));
  for (const segment of segments) for (const [first, last] of segment.actions.ranges) for (let n = first; n <= last; n++) {
    const assigned = assignments.get(segment.actions.source);
    if (assigned.has(n)) throw new Error(`Action mapped twice: ${segment.actions.source}:${n}`);
    assigned.add(n);
  }
  for (const source of sources) if (assignments.get(source.key).size !== source.actionCount) throw new Error(`Unmapped actions in ${source.key}`);
  const visits = segments.filter(segment => segment.kind === 'visit');
  let chronologicalCard = 0;
  for (const segment of segments) if (segment.kind === 'card') segment.key = `card:${String(++chronologicalCard).padStart(5, '0')}`;
  const expectedVisits = sources.reduce((n, source) => n + source.report.attempts.length, 0);
  if (visits.length !== expectedVisits || (root.report.totalVisits != null && visits.length !== root.report.totalVisits)) throw new Error('Visit coverage mismatch');
  const ticks = visits.reduce((n, visit) => n + visit.meta.battleFrames, 0);
  if (root.report.totalTicks != null && ticks !== root.report.totalTicks) throw new Error('Battle tick coverage mismatch');
  const timeline = {version: 1, fps, cardSeconds, reportPath, fingerprint: root.report.fingerprint, resultHash: root.report.resultHash,
    replayVerified: descriptorManifest?.verified === true,
    timingVerified: visits.every(visit => visit.timingVerified),
    timingPolicy: 'Native gameplay and story are sampled at the selected speed; labeled activity summaries retain their readable fixed holds.',
    sources: sources.map(({report, actions, ...source}) => source), segments,
    coverage: {visits: visits.length, battles: visits.filter(visit => !visit.meta.storyOnly).length,
      storyOnlyVisitKeys: visits.filter(visit => visit.meta.storyOnly).map(visit => visit.key), visitsBySource: countBy(visits, visit => visit.meta.source),
      outcomes: countBy(visits, visit => visit.meta.outcome), battleTicks: ticks, actions: sources.reduce((n, source) => n + source.actionCount, 0),
      mappedActions: [...assignments.values()].reduce((n, set) => n + set.size, 0), unmappedActions: 0, duplicateActions: 0,
      descriptorVisits: visits.filter(visit => visit.descriptorPath).length,
      missingDescriptorKeys: visits.filter(visit => !visit.descriptorPath).map(visit => visit.key),
      navigationActions: sources.flatMap(source => source.actions).filter(row => actionType(row) === 'tunnel-choice').length,
      navigationControllers: root.report.navigation ?? [], auxiliaryInsertions: insertions}, chapters: [], durations: {}};
  for (const speed of speeds) {const schedule = scheduleTimeline(timeline, {speed}); timeline.durations[speed] = {frames: schedule.totalFrames, seconds: schedule.durationSeconds};}
  timeline.chapters = scheduleTimeline(timeline).chapters;
  return timeline;
}

/** Finalize exact timestamps using the encoder's actual per-visit output frame
 * counts. Without overrides, 21-fps sampling is 0,speed,2*speed,... per visit.
 */
export function scheduleTimeline(timeline, {speed = 1, visitFrames = {}} = {}) {
  if (!Number.isInteger(speed) || speed < 1) throw new Error('Playback speed must be a positive integer');
  let cursor = 0;
  const chapters = [], segments = timeline.segments.map(segment => {
    const override = visitFrames instanceof Map ? visitFrames.get(segment.key) : visitFrames[segment.key];
    const count = segment.kind === 'card' ? segment.frames : override ?? Math.max(1, Math.ceil(segment.frames / speed));
    if (!Number.isInteger(count) || count < 1) throw new Error(`Invalid encoded frame count for ${segment.key}`);
    const scheduled = {...segment, outputStartFrame: cursor, outputFrames: count, outputStartSeconds: cursor / timeline.fps,
      outputEndFrame: cursor + count, outputDurationSeconds: count / timeline.fps};
    if (chapters.at(-1)?.key !== segment.chapter.key) chapters.push({...segment.chapter, id: `chapter-${String(chapters.length + 1).padStart(3, '0')}`,
      startFrame: cursor, startSeconds: cursor / timeline.fps,
      firstSegment: segment.key, visitKeys: []});
    if (segment.kind === 'visit') chapters.at(-1).visitKeys.push(segment.key);
    cursor += count;
    chapters.at(-1).endFrame = cursor;
    return scheduled;
  });
  return {speed, fps: timeline.fps, totalFrames: cursor, durationSeconds: cursor / timeline.fps,
    timingVerified: timeline.timingVerified || timeline.segments.filter(segment => segment.kind === 'visit')
      .every(segment => (visitFrames instanceof Map ? visitFrames.has(segment.key) : Object.hasOwn(visitFrames, segment.key))), segments, chapters};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [reportPath, outputPath, descriptorPath] = process.argv.slice(2);
  if (!reportPath || !outputPath) throw new Error('Usage: node tools/video/timeline.mjs REPORT OUTPUT [DESCRIPTORS]');
  const timeline = buildTimeline(reportPath, {descriptors: descriptorPath});
  writeFileSync(resolve(outputPath), JSON.stringify(timeline, null, 2) + '\n');
  console.log(JSON.stringify({output: resolve(outputPath), coverage: timeline.coverage, timingVerified: timeline.timingVerified, durations: timeline.durations}, null, 2));
}
