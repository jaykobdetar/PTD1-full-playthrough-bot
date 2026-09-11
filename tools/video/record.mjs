#!/usr/bin/env node
import {readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, createReadStream, renameSync, rmSync} from 'node:fs';
import {appendFile} from 'node:fs/promises';
import {resolve, dirname, join, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash, randomBytes} from 'node:crypto';
import {spawn, execFileSync} from 'node:child_process';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createServer} from 'vite';
import {chromium} from './node_modules/playwright-core/index.mjs';
import {buildTimeline, scheduleTimeline} from './timeline.mjs';
import {fingerprint, digest} from '../bot/runtime.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const atomic = (path, value) => {writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n'); renameSync(path + '.tmp', path);};
const safe = key => key.replace(/[^a-zA-Z0-9_-]/g, '-');
const flags = {report: 'artifacts/bot/strict-final/report.json', out: 'artifacts/video/strict-playthrough',
  descriptors: 'artifacts/video/strict-descriptors/descriptors.json', speeds: '1,20,60', workers: '3',
  chrome: process.env.PTD_BROWSER_EXECUTABLE ?? '/usr/bin/google-chrome', ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', bitrate: '1800000'};
for (let i = 2; i < process.argv.length; i++) {
  const argument = process.argv[i];
  if (['--resume', '--help'].includes(argument)) flags[argument.slice(2)] = true;
  else if (/^--/.test(argument) && ['report', 'out', 'descriptors', 'speeds', 'workers', 'chrome', 'ffmpeg', 'ffprobe', 'bitrate', 'limit', 'visits'].includes(argument.slice(2))) {
    const value = process.argv[++i]; if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`); flags[argument.slice(2)] = value;
  } else throw new Error(`Unknown argument ${argument}`);
}
if (flags.help) {
  console.log('Usage: node tools/video/record.mjs [--report REPORT] [--descriptors MANIFEST] [--out DIRECTORY] [--speeds 1,20,60] [--workers 3] [--resume] [--limit VISITS] [--visits KEY,KEY] [--chrome PATH] [--ffmpeg PATH] [--ffprobe PATH] [--bitrate 1800000]');
  process.exit(0);
}
const speeds = flags.speeds.split(',').map(Number), workers = Number(flags.workers), bitrate = Number(flags.bitrate);
if (!speeds.length || new Set(speeds).size !== speeds.length || speeds.some(s => !Number.isInteger(s) || s < 1)) throw new Error('Speeds must be distinct positive integers.');
if (!Number.isInteger(workers) || workers < 1 || workers > 8 || !Number.isInteger(bitrate) || bitrate < 100000) throw new Error('Invalid worker count or bitrate.');
if (flags.limit && (!Number.isInteger(Number(flags.limit)) || Number(flags.limit) < 1)) throw new Error('Limit must be a positive visit count.');
const reportPath = resolve(flags.report), descriptorPath = resolve(flags.descriptors), out = resolve(flags.out);
const descriptorManifest = read(descriptorPath), report = read(reportPath);
if (!descriptorManifest.verified || descriptorManifest.observedResultHash !== report.resultHash || descriptorManifest.sourceFingerprint !== report.fingerprint)
  throw new Error('Descriptors must come from a verified observation of this exact report.');
if (fingerprint() !== report.fingerprint) throw new Error('Game/bot source fingerprint differs from the recorded run.');
if (!descriptorManifest.preflight) throw new Error('Run tools/video/preflight.mjs with the observation loader before recording.');
for (const executable of [flags.ffmpeg, flags.ffprobe]) execFileSync(executable, ['-version'], {stdio: 'ignore'});
const names = read(join(root, 'public/data/game-data.json')).species;
let timeline = buildTimeline(reportPath, {descriptors: descriptorPath, speeds, names});
if (flags.visits) {
  const selected = new Set(flags.visits.split(',')), all = new Set(timeline.segments.map(s => s.key));
  for (const key of selected) if (!all.has(key)) throw new Error(`Unknown visit ${key}`);
  timeline.segments = timeline.segments.filter(s => selected.has(s.key));
} else if (flags.limit) {
  let count = 0;
  timeline.segments = timeline.segments.filter(s => s.kind === 'visit' ? ++count <= Number(flags.limit) : count < Number(flags.limit));
}
const partial = Boolean(flags.limit || flags.visits), descriptorRows = new Map(descriptorManifest.descriptors.map(row => [row.key, row]));
let sourceFrames = 0, visitNumber = 0;
for (const segment of timeline.segments) {
  segment.sourceStartFrame = sourceFrames; sourceFrames += segment.frames;
  if (segment.kind === 'visit') segment.visitNumber = ++visitNumber;
  segment.totalVisits = timeline.coverage.visits;
}
// Progress cards describe source state at the next recorded visit. Explicit
// initial/final snapshots supplied by the timeline take precedence.
let cardSave = read(join(dirname(reportPath), 'final-save.json'));
for (const segment of [...timeline.segments].reverse()) {
  if (segment.kind === 'visit') cardSave = read(segment.descriptorPath).checkpoint.save;
  else segment.meta.save ??= cardSave;
}
const videoFiles = readdirSync(join(root, 'tools/video')).filter(name => /\.(mjs|html)$/.test(name)).sort();
const videoFingerprint = digest(videoFiles.map(name => [name, readFileSync(join(root, 'tools/video', name), 'utf8')]));
const settings = {version: 1, reportHash: report.resultHash, sourceFingerprint: report.fingerprint, videoFingerprint,
  fps: 21, width: 960, height: 640, speeds, bitrate, partial, segmentKeys: timeline.segments.map(s => s.key)};
const settingsHash = digest(settings), manifestPath = join(out, 'recording.json');
mkdirSync(out, {recursive: true});
let manifest;
if (existsSync(manifestPath)) {
  if (!flags.resume) throw new Error('Output already contains a recording. Use --resume or a new output directory.');
  manifest = read(manifestPath);
  if (manifest.settingsHash !== settingsHash) throw new Error('Cannot resume: source, timing, or encoder settings changed.');
} else {
  if (readdirSync(out).length) throw new Error('New recording output directory must be empty.');
  manifest = {settings, settingsHash, createdAt: new Date().toISOString(), status: 'recording', segments: {}, videos: []};
}
mkdirSync(join(out, 'segments'), {recursive: true}); mkdirSync(join(out, 'previews'), {recursive: true});
atomic(join(out, 'timeline.json'), timeline); atomic(manifestPath, manifest);
const partPath = (key, speed) => join(out, 'segments', `${safe(key)}-${speed}x.h264`);
async function fileHash(path) {const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex');}
for (const [key, completed] of Object.entries(manifest.segments)) for (const stream of completed.streams) {
  const path = partPath(key, stream.speed);
  if (!existsSync(path) || statSync(path).size !== stream.bytes || await fileHash(path) !== stream.sha256) throw new Error(`Completed segment is missing or damaged: ${basename(path)}`);
}
const pending = timeline.segments.filter(s => !manifest.segments[s.key]), jobs = new Map(timeline.segments.map(s => [s.key, s]));
const token = randomBytes(16).toString('hex'), prefix = `/__video/${token}`, active = new Set(), browserErrors = [];
let browser, server, cancelled = false;
const progress = new Map(), started = Date.now();
function printProgress() {
  const completed = Object.values(manifest.segments), done = completed.reduce((n, s) => n + s.sourceFrames, 0);
  const activeFrames = [...progress.values()].reduce((n, s) => n + s.frames, 0), elapsed = (Date.now() - started) / 1000;
  const line = {completed: completed.length, total: timeline.segments.length, sourceFrames: done + activeFrames, expectedFrames: sourceFrames,
    percent: Number((100 * (done + activeFrames) / sourceFrames).toFixed(2)), elapsedSeconds: Math.round(elapsed),
    active: [...progress.values()]};
  atomic(join(out, 'progress.json'), line); console.log(JSON.stringify(line));
}
const interval = setInterval(printProgress, 15000).unref();
async function middleware(req, res, next) {
  if (!req.url.startsWith(prefix + '/')) return next();
  try {
    const [kind, encodedKey, speedText] = req.url.slice(prefix.length + 1).split('/');
    const key = decodeURIComponent(encodedKey ?? ''), job = jobs.get(key);
    if (!job) {res.statusCode = 404; return res.end('Unknown segment');}
    if (kind === 'descriptor' && req.method === 'GET' && job.kind === 'visit') {
      res.setHeader('Content-Type', 'application/json'); return res.end(readFileSync(job.descriptorPath));
    }
    const speed = Number(speedText);
    if (kind !== 'upload' || req.method !== 'POST' || !active.has(key) || !speeds.includes(speed)) {res.statusCode = 400; return res.end('Invalid active video stream');}
    let size = 0; const chunks = [];
    for await (const chunk of req) {size += chunk.length; if (size > 32 * 1024 * 1024) throw new Error('Video upload exceeds 32 MiB'); chunks.push(chunk);}
    await appendFile(partPath(key, speed) + '.partial', Buffer.concat(chunks));
    res.end('ok');
  } catch (error) {res.statusCode = 500; res.end(error.message);}
}
async function mux(speed) {
  const counts = Object.fromEntries(timeline.segments.map(s => [s.key, manifest.segments[s.key].streams.find(row => row.speed === speed).frames]));
  const schedule = scheduleTimeline(timeline, {speed, visitFrames: counts});
  const stem = `playthrough-${speed}x${partial ? '-sample' : ''}`, videoPath = join(out, `${stem}.mp4`), metadataPath = join(out, `${stem}.ffmetadata`);
  const escape = text => String(text).replace(/[\\=;#\n]/g, char => '\\' + char);
  const metadata = [';FFMETADATA1', `title=${escape(`Pokémon Tower Defense bot playthrough — ${speed}x${partial ? ' sample' : ''}`)}`,
    'comment=Silent deterministic native replay; fixed readable activity-summary cards.',
    ...schedule.chapters.flatMap(chapter => ['[CHAPTER]', 'TIMEBASE=1/21', `START=${chapter.startFrame}`, `END=${chapter.endFrame}`, `title=${escape(chapter.title)}`])].join('\n') + '\n';
  writeFileSync(metadataPath, metadata); atomic(join(out, `${stem}-chapters.json`), schedule);
  const temporary = join(out, `${stem}.partial.mp4`);
  const process = spawn(flags.ffmpeg, ['-hide_banner', '-loglevel', 'warning', '-y', '-fflags', '+genpts', '-r', '21', '-f', 'h264', '-i', 'pipe:0',
    '-f', 'ffmetadata', '-i', metadataPath, '-map', '0:v:0', '-map_metadata', '1', '-map_chapters', '1', '-c:v', 'copy', '-movflags', '+faststart', temporary], {stdio: ['pipe', 'ignore', 'pipe']});
  let stderr = ''; process.stderr.on('data', chunk => {stderr = (stderr + chunk).slice(-16000);});
  const exited = new Promise((resolveExit, reject) => {process.once('error', reject); process.once('close', code => code === 0 ? resolveExit() : reject(new Error(`FFmpeg failed (${code}): ${stderr}`)));});
  async function* bytes() {for (const segment of timeline.segments) for await (const chunk of createReadStream(partPath(segment.key, speed))) yield chunk;}
  await Promise.all([pipeline(Readable.from(bytes()), process.stdin), exited]);
  const probe = JSON.parse(execFileSync(flags.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-show_chapters', '-of', 'json', temporary], {maxBuffer: 8 * 1024 * 1024}));
  const stream = probe.streams.find(s => s.codec_type === 'video');
  if (Number(stream?.nb_frames) !== schedule.totalFrames || stream.width !== 960 || stream.height !== 640
    || Math.abs(Number(stream.duration) - schedule.durationSeconds) > 1 / 21 || probe.chapters.length !== schedule.chapters.length)
    throw new Error(`Muxed video verification failed for ${speed}x: ${JSON.stringify(stream)}`);
  renameSync(temporary, videoPath);
  const video = {speed, path: videoPath, bytes: statSync(videoPath).size, sha256: await fileHash(videoPath), frames: schedule.totalFrames,
    seconds: schedule.durationSeconds, chapters: schedule.chapters.length, verified: true};
  atomic(join(out, `${stem}-probe.json`), probe); return video;
}
try {
  if (pending.length) {
    server = await createServer({root, logLevel: 'error', server: {host: '127.0.0.1', port: 0},
      plugins: [{name: 'video-observation', enforce: 'pre', transform(code, id) {
        if (id.split('?')[0] === join(root, 'src/model.js')) return code + '\nexport function videoNextId() { return nextId; }\n';
      }, configureServer(vite) {vite.middlewares.use(middleware);}}]});
    await server.listen(); const url = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({executablePath: flags.chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']});
    let nextJob = 0;
    const worker = async index => {
      let context, page, completedHere = 0;
      async function newPage() {
        await context?.close(); context = await browser.newContext({viewport: {width: 960, height: 640}}); page = await context.newPage();
        page.on('pageerror', error => {browserErrors.push({worker: index, message: error.message});});
        await page.exposeFunction('videoProgress', row => progress.set(index, row));
        await page.goto(`${url}/tools/video/record.html`, {waitUntil: 'load'});
        await page.evaluate(() => window.videoReady);
      }
      try {
        await newPage();
        while (!cancelled) {
          const job = pending[nextJob++]; if (!job) break;
          // Fresh realms bound renderer asset memory and reset the private UID
          // allocator when a worker crosses the auxiliary profile insertion.
          if (completedHere && (completedHere % 12 === 0 || (job.kind === 'visit' && job.actions.source !== page.lastSource))) await newPage();
          if (job.kind === 'visit') page.lastSource = job.actions.source;
          active.add(job.key); progress.set(index, {key: job.key, frames: 0, expected: job.frames});
          for (const speed of speeds) {rmSync(partPath(job.key, speed) + '.partial', {force: true}); writeFileSync(partPath(job.key, speed) + '.partial', '');}
          const result = await page.evaluate(({job, options}) => window.renderVideoJob(job, options), {
            job: {...job, descriptorUrl: `${prefix}/descriptor/${encodeURIComponent(job.key)}`},
            options: {speeds, fps: 21, width: 960, height: 640, bitrate, uploadBase: `${prefix}/upload`},
          });
          if (browserErrors.length) throw new Error(`Browser error: ${JSON.stringify(browserErrors)}`);
          for (const field of ['preview', 'storyPreview']) if (result[field]) {
            writeFileSync(join(out, 'previews', `${safe(job.key)}-${field}.png`), Buffer.from(result[field].split(',')[1], 'base64')); delete result[field];
          }
          for (const stream of result.streams) {
            const partialPath = partPath(job.key, stream.speed) + '.partial';
            const expected = job.kind === 'card' ? job.frames : Math.ceil(result.sourceFrames / stream.speed);
            if (stream.frames !== expected || statSync(partialPath).size !== stream.bytes) throw new Error(`Encoded stream differs from native frame ledger: ${job.key}/${stream.speed}`);
            renameSync(partialPath, partPath(job.key, stream.speed)); stream.sha256 = await fileHash(partPath(job.key, stream.speed));
          }
          manifest.segments[job.key] = {...result, completedAt: new Date().toISOString()};
          active.delete(job.key); progress.delete(index); atomic(manifestPath, manifest); completedHere++;
        }
      } catch (error) {cancelled = true; throw error;}
      finally {await context?.close();}
    };
    const outcomes = await Promise.allSettled(Array.from({length: Math.min(workers, pending.length)}, (_, index) => worker(index)));
    const failures = outcomes.filter(row => row.status === 'rejected'); if (failures.length) throw new AggregateError(failures.map(row => row.reason), 'Video render failed. Completed segments are resumable.');
  }
  await browser?.close(); browser = null; await server?.close(); server = null;
  manifest.status = 'muxing'; atomic(manifestPath, manifest); printProgress();
  manifest.videos = [];
  for (const speed of speeds) {console.log(`Muxing ${speed}x MP4…`); manifest.videos.push(await mux(speed)); atomic(manifestPath, manifest);}
  manifest.gameComplete = Boolean(report.completion.complete && report.requestedComplete);
  manifest.status = partial ? 'sample-complete' : manifest.gameComplete ? 'complete' : 'recorded-with-blockers'; manifest.completedAt = new Date().toISOString();
  manifest.coverage = {...timeline.coverage, recordedVisits: timeline.segments.filter(s => s.kind === 'visit').length,
    sourceFrames, recordedSegments: timeline.segments.length, fullRun: !partial};
  atomic(manifestPath, manifest); console.log(JSON.stringify({status: manifest.status, videos: manifest.videos, coverage: manifest.coverage}, null, 2));
} catch (error) {
  manifest.status = 'failed'; manifest.error = {message: error.message, details: error.errors?.map(e => e.stack) ?? error.stack};
  atomic(manifestPath, manifest); console.error(error); process.exitCode = 1;
} finally {clearInterval(interval); await browser?.close(); await server?.close();}
