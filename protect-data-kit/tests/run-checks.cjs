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

// Static offline checks on the built page.
const builtPath = path.join(root, 'index.html');
check('index.html has been built', fs.existsSync(builtPath), 'run: npm run build');
if (fs.existsSync(builtPath)) {
  const html = fs.readFileSync(builtPath, 'utf8');
  ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'http://', 'https://', '<link', 'import(', ' src='].forEach(function (bad) {
    check('index.html contains no "' + bad + '"', html.indexOf(bad) === -1);
  });
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
