const test = require('node:test');
const assert = require('node:assert');
const Detect = require('../src/detect.js');

const none = { version: 1, settings: {}, detectors: [], idFormats: [], watchlist: [] };
const secretRule = {
  id: 't', type: 'regex', pattern: 'SECRETWORD', flags: '',
  label: 'T', severity: 'High', placeholder: 'T', reason: 'r'
};

test('watchlist matches whole words, case-insensitive', () => {
  const r = Detect.scan('Aurora is on the list but Auroraville is not.',
    Object.assign({}, none, { watchlist: ['aurora'] }));
  assert.strictEqual(r.matches.length, 1);
  assert.strictEqual(r.matches[0].text, 'Aurora');
  assert.strictEqual(r.matches[0].severity, 'Watchlist');
  assert.strictEqual(r.verdict, 'Review');
});

test('watchlist object entries carry a category into label and placeholder', () => {
  const rules = Object.assign({}, none, { watchlist: [{ term: 'Project Aurora', category: 'program' }] });
  const text = 'We paused Project Aurora last week.';
  const r = Detect.scan(text, rules);
  assert.strictEqual(r.matches[0].label, 'Watchlist: program');
  assert.strictEqual(Detect.redact(text, r.matches), 'We paused [WATCHLIST:program] last week.');
});

test('empty watchlist terms are ignored', () => {
  const r = Detect.scan('anything', Object.assign({}, none, { watchlist: ['', '   ', { term: '' }] }));
  assert.strictEqual(r.matches.length, 0);
});

test('idFormats produce Medium matches', () => {
  const r = Detect.scan('See ABC-12345 and ABC-9.', Object.assign({}, none, { idFormats: ['ABC-\\d{5}'] }));
  assert.strictEqual(r.matches.length, 1);
  assert.strictEqual(r.matches[0].text, 'ABC-12345');
  assert.strictEqual(r.matches[0].severity, 'Medium');
  assert.strictEqual(r.matches[0].placeholder, 'ID');
});

test('an invalid idFormat is reported in errors and does not throw', () => {
  const r = Detect.scan('text', Object.assign({}, none, { idFormats: ['('] }));
  assert.strictEqual(r.errors.length, 1);
  assert.strictEqual(r.matches.length, 0);
});

test('overlap keeps the higher severity', () => {
  const rules = Object.assign({}, none, { idFormats: ['ABC-\\d{5}'], watchlist: ['ABC-12345'] });
  const r = Detect.scan('ABC-12345', rules);
  assert.strictEqual(r.matches.length, 1);
  assert.strictEqual(r.matches[0].severity, 'Medium');
});

test('verdict is Clear for text with no matches', () => {
  const r = Detect.scan('Nothing to see here.', none);
  assert.strictEqual(r.verdict, 'Clear');
  assert.deepStrictEqual(r.counts, { High: 0, Medium: 0, Watchlist: 0 });
});

test('a High match gives Stop and is counted', () => {
  const r = Detect.scan('a SECRETWORD b', Object.assign({}, none, { detectors: [secretRule] }));
  assert.strictEqual(r.verdict, 'Stop');
  assert.strictEqual(r.counts.High, 1);
});

test('redact replaces matches with typed placeholders and leaves the rest alone', () => {
  const text = 'a SECRETWORD b';
  const r = Detect.scan(text, Object.assign({}, none, { detectors: [secretRule] }));
  assert.strictEqual(Detect.redact(text, r.matches), 'a [T] b');
  assert.strictEqual(text, 'a SECRETWORD b');
});

test('an unknown builtin detector is reported in errors', () => {
  const rules = Object.assign({}, none, {
    detectors: [{ id: 'x', type: 'builtin', fn: 'nope', label: 'X', severity: 'High', placeholder: 'X', reason: 'r' }]
  });
  assert.strictEqual(Detect.scan('text', rules).errors.length, 1);
});

test('normalizeRules rejects the wrong version and non-objects', () => {
  assert.strictEqual(Detect.normalizeRules({ version: 2 }).ok, false);
  assert.strictEqual(Detect.normalizeRules(null).ok, false);
});

test('normalizeRules fills defaults and drops malformed entries', () => {
  const n = Detect.normalizeRules({ version: 1, idFormats: ['A', 5], watchlist: ['x', 7, { term: 'y' }, {}] });
  assert.strictEqual(n.ok, true);
  assert.strictEqual(n.rules.settings.minSeqLen, 20);
  assert.deepStrictEqual(n.rules.idFormats, ['A']);
  assert.deepStrictEqual(n.rules.watchlist, ['x', { term: 'y' }]);
});

test('normalizeRules falls back to base detectors when the file has none', () => {
  const base = { version: 1, detectors: [secretRule] };
  const n = Detect.normalizeRules({ version: 1 }, base);
  assert.deepStrictEqual(n.rules.detectors, [secretRule]);
});
