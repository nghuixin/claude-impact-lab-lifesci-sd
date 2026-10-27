const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Detect = require('../src/detect.js');
const rules = require('../rules.json');

function ids(text) { return Detect.scan(text, rules).matches.map(function (m) { return m.id; }); }
function first(text, id) {
  return Detect.scan(text, rules).matches.filter(function (m) { return m.id === id; })[0];
}

test('every detector in rules.json compiles', () => {
  assert.deepStrictEqual(Detect.scan('x', rules).errors, []);
});

test('public text produces zero matches', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'public-text.txt'), 'utf8');
  assert.deepStrictEqual(Detect.scan(text, rules).matches.map(function (m) { return m.text; }), []);
});

test('inchi', () => {
  assert.ok(ids('Structure: InChI=1S/C6H12O/c1-2-3-4-5-6-7/h7H,2-6H2,1H3 end').includes('inchi'));
});

test('assay-values: potency with units', () => {
  assert.strictEqual(first('The lead had IC50 = 12.4 nM in cells.', 'assay-values').text, 'IC50 = 12.4 nM');
  assert.ok(ids('Ki of 3 uM').includes('assay-values'));
});

test('assay-values: percent inhibition and p-values', () => {
  assert.ok(ids('Showed 87% inhibition at the top dose').includes('assay-values'));
  assert.ok(ids('the difference was significant (p < 0.05)').includes('assay-values'));
});

test('assay-header: unit-bearing column names', () => {
  assert.ok(ids('compound_id,ic50_nM,ki_nM').includes('assay-header'));
  assert.ok(ids('Kd(nM), Hill').includes('assay-header'));
});

test('assay-header does not fire on names like Kimmel', () => {
  assert.deepStrictEqual(ids('Dr. Kimmel presented.'), []);
});

test('assay-row: a line with two decimal values', () => {
  assert.ok(ids('SYN-0001,TGT-A,12.4,8.1,0.97').includes('assay-row'));
});

test('phi detectors', () => {
  assert.ok(ids('Contact jane.doe@example.test now').includes('phi-email'));
  assert.ok(ids('SSN 000-12-3456').includes('phi-ssn'));
  assert.ok(ids('Call (555) 010-1234').includes('phi-phone'));
  assert.ok(ids('Call 555-010-1234').includes('phi-phone'));
  assert.ok(ids('MRN: 0012345').includes('phi-mrn'));
  assert.ok(ids('DOB: 01/02/1970').includes('phi-dob'));
  assert.ok(ids('Participant: Jane Doe, 03/14/1962').includes('phi-name-date'));
});

test('a date alone is not PHI', () => {
  assert.deepStrictEqual(ids('The visit was on 2024-01-15.'), []);
});

test('secrets', () => {
  assert.ok(ids('key sk-ant-' + 'x'.repeat(30)).includes('secret'));
  assert.ok(ids('api_key = abcdef1234567890abcd').includes('secret'));
  assert.ok(ids('AKIA' + 'A'.repeat(16)).includes('secret'));
});

test('a short password value is not flagged', () => {
  assert.deepStrictEqual(ids('password: hunter2'), []);
});

test('redaction uses the typed placeholder', () => {
  const text = 'Mail jane.doe@example.test today';
  const r = Detect.scan(text, rules);
  assert.strictEqual(Detect.redact(text, r.matches), 'Mail [PHI] today');
});

function timedScan(text) {
  const start = process.hrtime.bigint();
  const result = Detect.scan(text, rules);
  return { ms: Number(process.hrtime.bigint() - start) / 1e6, result: result };
}

test('long run of email characters scans fast and matches nothing', () => {
  const { ms, result } = timedScan('a'.repeat(60000));
  assert.ok(ms < 1000, 'scan took ' + ms.toFixed(1) + ' ms');
  assert.deepStrictEqual(result.matches, []);
});

test('long run of digits scans fast and matches nothing', () => {
  const { ms, result } = timedScan('1'.repeat(30000));
  assert.ok(ms < 250, 'scan took ' + ms.toFixed(1) + ' ms');
  assert.deepStrictEqual(result.matches, []);
});

test('long run of "a." scans fast and matches nothing', () => {
  const { ms, result } = timedScan('a.'.repeat(30000));
  assert.ok(ms < 1000, 'scan took ' + ms.toFixed(1) + ' ms');
  assert.deepStrictEqual(result.matches, []);
});

test('phi-email still matches an address preceded by a space', () => {
  assert.strictEqual(first('write to a@b.co now', 'phi-email').text, 'a@b.co');
  assert.strictEqual(first('Contact jane.doe@example.test now', 'phi-email').text, 'jane.doe@example.test');
});

test('assay-row still matches a row that follows other text', () => {
  assert.ok(ids('row 1: SYN-0001,TGT-A,12.4,8.1,0.97').includes('assay-row'));
  assert.ok(ids('SYN-0001,TGT-A,12.4,8.1,0.97').includes('assay-row'));
});
