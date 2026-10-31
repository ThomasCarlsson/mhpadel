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

const ok1 = await run('tur', L.buildScript([60, 100, 200], ['h'], 'sj'), (o) => Array.isArray(o.events) && o.events.length > 0);
const ok2 = await run('lunar', L.buildLunarScript(), (o) => o.pools && Object.keys(o.pools).length > 0);
let ok3 = false;
try { ok3 = await run('baner', L.buildCourtsScript(), (o) => o.clubs && Object.keys(o.clubs).length > 0); } catch (e) { console.error('baner: ' + e); }

console.log('Resultat: turneringer=' + ok1 + ' lunar=' + ok2 + ' baner=' + ok3);
if (!ok1 && !ok2) process.exit(1);
