// Henter data fra Rankedin (og Padelmates, hvis det virker) og lægger dem i _site/data.
// Logikken er den samme som i appen: den læses direkte ud af index.html.
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const src = html.match(/<script id="logic">([\s\S]*?)<\/script>/)[1];
const mod = { exports: {} };
new Function('module', src)(mod);
const L = mod.exports;

fs.mkdirSync('_site/data', { recursive: true });
fs.copyFileSync('index.html', '_site/index.html');

async function run(name, code, check) {
  let copied = null;
  const logs = [];
  const sandbox = {
    fetch, copy: (t) => { copied = t; }, window: {},
    console: { log: (x) => { logs.push(String(x)); console.log(name + ': ' + x); }, error: console.error },
    setTimeout, Date, JSON, Promise, Set, Math, Array, Object, String, Number, URL, Map, RegExp, Error, isNaN, parseInt, parseFloat, encodeURIComponent,
  };
  try {
    await vm.runInNewContext(code, sandbox);
  } catch (e) {
    console.error(name + ' fejlede: ' + e);
  }
  const txt = copied || sandbox.window.padelData;
  if (!txt) { console.error(name + ': ingen data'); return false; }
  let obj;
  try { obj = JSON.parse(txt); } catch (e) { console.error(name + ': ugyldigt svar'); return false; }
  if (!check(obj)) { console.error(name + ': data så tomme ud, springer over'); return false; }
  fs.writeFileSync('_site/data/' + name + '.json', txt);
  console.log(name + ': gemt (' + Math.round(txt.length / 1024) + ' kB)');
  return true;
}

// ---------- tidsplan ----------
// Workflowet kører hver time. Hver del opdateres kun, når den er "forfalden" ifølge reglerne herunder.
// Tidspunkter er dansk tid. Det, der ikke skal opdateres, genbruges fra den side, der allerede er udgivet.
const SITE = 'https://thomascarlsson.github.io/mhpadel/data/';
const force = ['push', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME || '');
const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
const day = parts.find((p) => p.type === 'weekday').value;   // Mon..Sun
const hour = +parts.find((p) => p.type === 'hour').value;
const fsu = ['Fri', 'Sat', 'Sun'].includes(day);
const weekend = ['Sat', 'Sun'].includes(day);

const EVERY = { hour: 60, three: 180, eight: 480 };
const interval = {
  // DPF Turneringer: fredag-søndag hver time kl. 8-22, ellers hver 8. time
  tur: fsu && hour >= 8 && hour <= 22 ? EVERY.hour : EVERY.eight,
  // Lunar Liga: mandag-fredag hver time kl. 16-23, lørdag-søndag hver 3. time, ellers hver 8. time
  lunar: !weekend && hour >= 16 && hour <= 23 ? EVERY.hour : weekend ? EVERY.three : EVERY.eight,
  // Book bane: hver 8. time
  baner: EVERY.eight,
};
console.log('Dansk tid: ' + day + ' kl. ' + hour + '. Intervaller (min): ' + JSON.stringify(interval) + (force ? ' (tvunget opdatering)' : ''));

async function previous(name) {
  try {
    const r = await fetch(SITE + name + '.json?t=' + Date.now());
    if (!r.ok) return null;
    const txt = await r.text();
    return { txt, obj: JSON.parse(txt) };
  } catch (e) { return null; }
}
const due = (prev, min) => force || !prev || !prev.obj.at || (Date.now() - Date.parse(prev.obj.at)) >= (min - 12) * 60000;

async function part(name, build, check) {
  const prev = await previous(name);
  if (!due(prev, interval[name])) {
    fs.writeFileSync('_site/data/' + name + '.json', prev.txt);
    console.log(name + ': ikke forfalden, genbruger data fra ' + prev.obj.at);
    return true;
  }
  const ok = await run(name, build(), check);
  if (!ok && prev) {
    fs.writeFileSync('_site/data/' + name + '.json', prev.txt);
    console.log(name + ': hentning fejlede, beholder tidligere data');
    return true;
  }
  return ok;
}

const ok1 = await part('tur', () => L.buildScript([60, 100, 200], ['h'], 'sj'), (o) => Array.isArray(o.events) && o.events.length > 0);
const ok2 = await part('lunar', () => L.buildLunarScript(), (o) => o.pools && Object.keys(o.pools).length > 0);
let ok3 = false;
try { ok3 = await part('baner', () => L.buildCourtsScript(), (o) => o.clubs && Object.keys(o.clubs).length > 0); } catch (e) { console.error('baner: ' + e); }

console.log('Resultat: turneringer=' + ok1 + ' lunar=' + ok2 + ' baner=' + ok3);
if (!ok1 && !ok2) process.exit(1);
