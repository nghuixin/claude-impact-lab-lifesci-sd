const fs = require('fs');
const path = require('path');
const Detect = require('../src/detect.js');
const rules = require('../rules.json');

const root = path.join(__dirname, '..');
let failures = 0;

function check(name, ok, detail) {
  if (ok) { console.log('PASS ' + name); return; }
  failures++;
  console.log('FAIL ' + name + (detail ? ' :: ' + detail : ''));
}
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function idsIn(rel) {
  return Detect.scan(read(rel), rules).matches.map(function (m) { return m.id; });
}

// Synthetic files must trigger the detectors they exist to demonstrate.
const positives = {
  'synthetic/assay_results.csv': ['assay-header', 'assay-row'],
  'synthetic/sequences.fasta': ['sequence'],
  'synthetic/compounds.smi': ['smiles'],
  'synthetic/trial_sites.md': ['phi-email', 'phi-phone', 'phi-ssn', 'phi-mrn', 'phi-dob', 'phi-name-date']
};
Object.keys(positives).forEach(function (rel) {
  const found = idsIn(rel);
  positives[rel].forEach(function (id) {
    check(rel + ' triggers ' + id, found.indexOf(id) !== -1, 'found: ' + Array.from(new Set(found)).join(','));
  });
});

// Synthetic safeguards.
Object.keys(positives).concat(['synthetic/README.md']).forEach(function (rel) {
  const text = read(rel);
  check(rel + ' has the SYNTHETIC header', /SYNTHETIC, not real data/.test(text.split('\n').slice(0, 2).join('\n')));
});
['synthetic/assay_results.csv', 'synthetic/compounds.smi', 'synthetic/sequences.fasta'].forEach(function (rel) {
  check(rel + ' uses the SYN- prefix', /SYN-/.test(read(rel)));
});

// Negatives and the documented blind spot.
check('public text produces zero matches', idsIn('tests/fixtures/public-text.txt').length === 0);
check('false-negative prose is (knowingly) not flagged', idsIn('tests/fixtures/false-negative-prose.txt').length === 0);

// Redacting each synthetic positive file leaves nothing detectable.
const realRules = Detect.normalizeRules(rules).rules;
Object.keys(positives).forEach(function (rel) {
  const text = read(rel);
  const redacted = Detect.redact(text, Detect.scan(text, realRules).matches);
  const left = Detect.scan(redacted, realRules).matches;
  check(rel + ' redacts to zero remaining matches', left.length === 0, 'left: ' + left.map(function (m) { return m.id; }).join(','));
});

// Static offline checks on the built page.
const builtPath = path.join(root, 'index.html');
check('index.html has been built', fs.existsSync(builtPath), 'run: npm run build');
if (fs.existsSync(builtPath)) {
  const html = fs.readFileSync(builtPath, 'utf8');
  ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'http://', 'https://', '<link', 'import(', ' src='].forEach(function (bad) {
    check('index.html contains no "' + bad + '"', html.indexOf(bad) === -1);
  });
  [
    ['innerHTML/outerHTML/insertAdjacentHTML', /innerHTML|outerHTML|insertAdjacentHTML/],
    ['document.write', /document\.write/],
    ['eval(', /\beval\s*\(/],
    ['new Function', /new\s+Function/],
    ['window.open', /window\.open/],
    ['location assignment or access', /\blocation\s*[.=]/],
    ['<iframe', /<iframe/i],
    ['form with action', /<form[^>]*\baction\s*=/i],
    ['@import', /@import/],
    ['url(', /(?<![A-Za-z])url\s*\(/i],
    ['src attribute', /\bsrc\s*=/i],
    ['EventSource', /EventSource/],
    ['RTCPeerConnection', /RTCPeerConnection/],
    ['new Worker', /new\s+Worker/],
    ['srcdoc', /srcdoc/i],
    ['http-equiv', /http-equiv/i],
    ['<img', /<img/i],
    ['anchor tag with href', /<a\s[^>]*href\s*=/i]
  ].forEach(function (pair) {
    check('index.html matches no forbidden pattern: ' + pair[0], !pair[1].test(html));
  });
  check('print stylesheet hides the leak form', /@media print\s*\{(?:[^{}]*\{[^}]*\})*[^{}]*#leak-form/.test(html));
  let fresh = null;
  try { fresh = require('../build.cjs').buildHtml(); } catch (e) { fresh = null; }
  check('index.html is up to date with src/ and rules.json', fresh === html, 'index.html is stale: run npm run build and commit it');
  check('index.html has no unreplaced build markers', !/\/\*__[A-Z]+__\*\//.test(html));
  check('index.html states the blind spots', /unpublished results/i.test(html) && /screenshots/i.test(html) && /attachments/i.test(html));
  check('index.html says the checker is advisory', /advisory/i.test(html));
  check('index.html has the leak log tab', /Leak log/.test(html) && /id="panel-leak"/.test(html));
  check('leak log tells users to describe, not paste', /Describe, do not paste/.test(html));
  check('leak log says it is not legal or compliance advice', /record, not legal or compliance advice/.test(html));
  check('leak log script is inlined', /const LeakLog =/.test(html) && /pdk\.leaklog\.v1/.test(html));
}

if (failures > 0) { console.log('\n' + failures + ' check(s) failed.'); process.exit(1); }
console.log('\nAll checks passed.');
