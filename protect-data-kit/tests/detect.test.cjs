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

function withoutKey(obj, key) {
  const copy = Object.assign({}, obj);
  delete copy[key];
  return copy;
}

const badSeverityRule = Object.assign({}, secretRule, { severity: 'high' });

test('normalizeRules drops a detector with a wrong-case severity', () => {
  const n = Detect.normalizeRules({ version: 1, detectors: [badSeverityRule] });
  assert.strictEqual(n.ok, true);
  assert.deepStrictEqual(n.rules.detectors, []);
  const r = Detect.scan('a SECRETWORD b', n.rules);
  assert.strictEqual(r.matches.length, 0);
  assert.strictEqual(r.verdict, 'Clear');
});

test('scan skips a detector with a wrong-case severity, reports it, and never returns Clear with matches', () => {
  const alone = Detect.scan('a SECRETWORD b', Object.assign({}, none, { detectors: [badSeverityRule] }));
  assert.strictEqual(alone.matches.length, 0);
  assert.strictEqual(alone.errors.length, 1);

  const mixed = Detect.scan('ABC-12345 SECRETWORD',
    Object.assign({}, none, { detectors: [badSeverityRule], idFormats: ['ABC-\\d{5}'] }));
  assert.strictEqual(mixed.matches.length, 1);
  assert.strictEqual(mixed.errors.length, 1);
  assert.notStrictEqual(mixed.verdict, 'Clear');
  assert.strictEqual(mixed.verdict, 'Review');
});

test('a null detector entry in scan does not throw and is reported in errors', () => {
  let r;
  assert.doesNotThrow(function () {
    r = Detect.scan('a SECRETWORD b', Object.assign({}, none, { detectors: [null, secretRule] }));
  });
  assert.strictEqual(r.errors.length, 1);
  assert.strictEqual(r.matches.length, 1);
  assert.strictEqual(r.verdict, 'Stop');
});

test('normalizeRules drops detectors missing id, pattern, or placeholder', () => {
  const n = Detect.normalizeRules({
    version: 1,
    detectors: [
      withoutKey(secretRule, 'id'),
      withoutKey(secretRule, 'pattern'),
      withoutKey(secretRule, 'placeholder'),
      null,
      secretRule
    ]
  });
  assert.deepStrictEqual(n.rules.detectors, [secretRule]);
});

test('normalizeRules keeps valid regex and builtin detectors and drops builtins without fn', () => {
  const builtinRule = { id: 'b', type: 'builtin', fn: 'nope', label: 'B', severity: 'Medium', placeholder: 'B', reason: 'r' };
  const builtinNoFn = withoutKey(builtinRule, 'fn');
  const n = Detect.normalizeRules({ version: 1, detectors: [secretRule, builtinRule, builtinNoFn] });
  assert.deepStrictEqual(n.rules.detectors, [secretRule, builtinRule]);
});

test('normalizeRules filters malformed entries out of the base detectors fallback too', () => {
  const base = { version: 1, detectors: [null, withoutKey(secretRule, 'placeholder'), secretRule] };
  const n = Detect.normalizeRules({ version: 1 }, base);
  assert.deepStrictEqual(n.rules.detectors, [secretRule]);
});

test('storableRules omits detectors that match the base', () => {
  const base = { version: 1, settings: { minSeqLen: 20 }, detectors: [secretRule], idFormats: [], watchlist: [] };
  const rules = Object.assign({}, base, { watchlist: ['Aurora'] });
  const s = Detect.storableRules(rules, base);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(s, 'detectors'), false);
});

test('storableRules includes detectors only when they differ from the base', () => {
  const base = { version: 1, settings: { minSeqLen: 20 }, detectors: [secretRule], idFormats: [], watchlist: [] };
  const changed = Object.assign({}, base, { detectors: [Object.assign({}, secretRule, { severity: 'Medium' })] });
  assert.deepStrictEqual(Detect.storableRules(changed, base).detectors, changed.detectors);
});

test('storableRules always keeps version, settings, watchlist and idFormats', () => {
  const base = { version: 1, settings: { minSeqLen: 20 }, detectors: [], idFormats: [], watchlist: [] };
  const rules = { version: 1, settings: { minSeqLen: 30 }, detectors: [], idFormats: ['ABC-\\d{5}'], watchlist: [{ term: 'Aurora', category: 'program' }] };
  const s = Detect.storableRules(rules, base);
  assert.strictEqual(s.version, 1);
  assert.deepStrictEqual(s.settings, { minSeqLen: 30 });
  assert.deepStrictEqual(s.idFormats, ['ABC-\\d{5}']);
  assert.deepStrictEqual(s.watchlist, [{ term: 'Aurora', category: 'program' }]);
});

test('storableRules output round-trips through normalizeRules to the original rules', () => {
  const base = Detect.normalizeRules({ version: 1, settings: {}, detectors: [secretRule] }).rules;
  const rules = Object.assign({}, base, { idFormats: ['X-\\d+'], watchlist: [{ term: 'Aurora', category: 'program' }] });
  const back = Detect.normalizeRules(Detect.storableRules(rules, base), base);
  assert.strictEqual(back.ok, true);
  assert.deepStrictEqual(back.rules, rules);
});

// Simulates Safari before 16.4, where a lookbehind in new RegExp(...) throws at run time.
function withoutLookbehind(fn) {
  const Original = global.RegExp;
  global.RegExp = new Proxy(Original, {
    construct: function (target, args, newTarget) {
      if (typeof args[0] === 'string' && args[0].indexOf('(?<') !== -1) throw new SyntaxError('Invalid regular expression: lookbehind unsupported');
      return Reflect.construct(target, args, newTarget === global.RegExp ? target : newTarget);
    }
  });
  try { return fn(); } finally { global.RegExp = Original; }
}

test('simulated old browser really throws on lookbehind', () => {
  withoutLookbehind(() => assert.throws(() => new RegExp('(?<!a)b')));
});

test('watchlist compile failure does not throw and reports a fixed error without the term', () => {
  const rules = Object.assign({}, none, { watchlist: ['SecretTerm'] });
  const r = withoutLookbehind(() => Detect.scan('Alpha SecretTerm beta', rules));
  assert.ok(r.errors.length >= 1);
  r.errors.forEach((e) => assert.ok(e.indexOf('SecretTerm') === -1, e));
});

test('null or non-object watchlist entries do not throw', () => {
  const rules = Object.assign({}, none, { watchlist: [null, 5, undefined, 'x'] });
  assert.doesNotThrow(() => Detect.scan('x y', rules));
});
