const test = require('node:test');
const assert = require('node:assert');
const Detect = require('../src/detect.js');
const LeakLog = require('../src/leaklog.js');

const rules = Detect.normalizeRules(require('../rules.json')).rules;

const good = {
  when: '2026-10-26T14:30:00.000Z',
  kind: 'ip', how: 'pasted', where: 'claude_ai', found: 'self', reachable: 'dont_know',
  actions: ['deleted', 'told_contact'],
  notes: 'Pasted a results summary into a chat by mistake.'
};

test('a valid entry is accepted and normalised', () => {
  const r = LeakLog.createEntry(good, rules, []);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(Object.keys(r.entry).sort(),
    ['actions', 'found', 'how', 'id', 'kind', 'notes', 'reachable', 'when', 'where']);
  assert.strictEqual(r.entry.id, 'LK-001');
  assert.strictEqual(r.entry.when, '2026-10-26T14:30:00.000Z');
});

test('unknown extra fields are dropped, never stored', () => {
  const r = LeakLog.createEntry(Object.assign({}, good, { secret: 'x', name: 'A Person' }), rules, []);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.entry.secret, undefined);
  assert.strictEqual(r.entry.name, undefined);
});

test('required choices and the date are validated', () => {
  ['kind', 'how', 'where', 'found', 'reachable'].forEach(function (name) {
    const bad = Object.assign({}, good); bad[name] = '';
    const r = LeakLog.createEntry(bad, rules, []);
    assert.strictEqual(r.ok, false, name);
  });
  assert.strictEqual(LeakLog.createEntry(Object.assign({}, good, { when: 'not a date' }), rules, []).ok, false);
  assert.strictEqual(LeakLog.createEntry(Object.assign({}, good, { actions: ['bogus'] }), rules, []).ok, false);
});

test('notes longer than the limit are rejected', () => {
  const r = LeakLog.createEntry(Object.assign({}, good, { notes: 'a '.repeat(300) }), rules, []);
  assert.strictEqual(r.ok, false);
});

test('notes that contain the data itself are refused, and the data is not echoed back', () => {
  const seq = 'ATGGCGTACGTTAGCTAGCTAGGATCCA';
  const r = LeakLog.createEntry(Object.assign({}, good, { notes: 'Pasted ' + seq + ' into chat' }), rules, []);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.blocked.length, 1);
  assert.strictEqual(r.blocked[0].label, 'Sequence');
  assert.strictEqual(JSON.stringify(r).indexOf(seq), -1);
});

test('emails in notes are refused', () => {
  const r = LeakLog.createEntry(Object.assign({}, good, { notes: 'sent to jane.doe@example.test' }), rules, []);
  assert.strictEqual(r.ok, false);
  assert.ok(r.blocked.length >= 1);
});

test('ids continue from the highest existing id', () => {
  assert.strictEqual(LeakLog.nextId([]), 'LK-001');
  assert.strictEqual(LeakLog.nextId([{ id: 'LK-001' }, { id: 'LK-007' }, { id: 'LK-003' }]), 'LK-008');
  assert.strictEqual(LeakLog.nextId([{ id: 'junk' }]), 'LK-001');
});

test('reportRows renders labels, a stable UTC time and a none-recorded default', () => {
  const e = LeakLog.createEntry(Object.assign({}, good, { actions: [] }), rules, []).entry;
  const row = LeakLog.reportRows([e])[0];
  assert.strictEqual(row.when, '2026-10-26 14:30 UTC');
  assert.strictEqual(row.how, 'Pasted into a chat or prompt');
  assert.strictEqual(row.actions, 'None recorded');
  LeakLog.COLUMNS.forEach(function (c) { assert.strictEqual(typeof row[c[0]], 'string', c[0]); });
});

test('exportReport has the documented shape', () => {
  const e = LeakLog.createEntry(good, rules, []).entry;
  const rep = LeakLog.exportReport([e], new Date('2026-10-26T15:00:00.000Z'));
  assert.strictEqual(rep.format, 'leak-report');
  assert.strictEqual(rep.version, 1);
  assert.strictEqual(rep.generated, '2026-10-26T15:00:00.000Z');
  assert.deepStrictEqual(rep.entries, [e]);
});

test('WHERE options come from the decision tree so the two stay in step', () => {
  const Tree = require('../src/tree.js');
  assert.deepStrictEqual(LeakLog.WHERE, Tree.QUESTIONS.where.options);
});

test('fails closed: an incomplete safety check refuses the save without echoing the rule text', () => {
  const badRules = Object.assign({}, rules, { idFormats: ['(zzz'] });
  const r = LeakLog.createEntry(good, badRules, []);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.join(' ').indexOf('safety check') !== -1);
  assert.strictEqual(JSON.stringify(r).indexOf('(zzz'), -1);
});

test('an incomplete safety check does not block an entry with empty notes', () => {
  const badRules = Object.assign({}, rules, { idFormats: ['(zzz'] });
  assert.strictEqual(LeakLog.createEntry(Object.assign({}, good, { notes: '' }), badRules, []).ok, true);
});

const raw = [
  { id: 'LK-002', when: '2026-10-26T14:30:00.000Z', kind: 'ip', how: 'pasted', where: 'claude_ai',
    found: 'self', reachable: 'dont_know', actions: ['deleted'], notes: 'ok' }
];

test('sanitizeEntries drops non-objects, missing or invalid fields, and keeps valid entries unchanged', () => {
  const valid = LeakLog.createEntry(good, rules, []).entry;
  const bad = [
    null,
    'a string',
    Object.assign({}, valid, { id: 'LK-009', kind: undefined }),
    Object.assign({}, valid, { id: 'LK-010', when: 'not a date' })
  ];
  const out = LeakLog.sanitizeEntries([valid].concat(bad));
  assert.strictEqual(out.dropped, 4);
  assert.deepStrictEqual(out.entries, [valid]);
});

test('sanitizeEntries strips unknown keys from entries it keeps', () => {
  const out = LeakLog.sanitizeEntries([Object.assign({}, raw[0], { secret: 'x', name: 'A Person' })]);
  assert.strictEqual(out.dropped, 0);
  assert.deepStrictEqual(Object.keys(out.entries[0]).sort(),
    ['actions', 'found', 'how', 'id', 'kind', 'notes', 'reachable', 'when', 'where']);
});

test('sanitizeEntries coerces actions, dedupes and canonicalises them, and truncates notes', () => {
  const out = LeakLog.sanitizeEntries([Object.assign({}, raw[0], {
    actions: 'deleted', notes: 'x'.repeat(LeakLog.NOTES_MAX + 50)
  }), Object.assign({}, raw[0], { id: 'LK-003', actions: ['told_contact', 'bogus', 'deleted', 'deleted'], notes: 42 })]);
  assert.strictEqual(out.dropped, 0);
  assert.deepStrictEqual(out.entries[0].actions, ['deleted']);
  assert.strictEqual(out.entries[0].notes.length, LeakLog.NOTES_MAX);
  assert.deepStrictEqual(out.entries[1].actions, ['deleted', 'told_contact']);
  assert.strictEqual(out.entries[1].notes, '');
});

test('sanitizeEntries returns nothing for non-array input', () => {
  assert.deepStrictEqual(LeakLog.sanitizeEntries({ id: 'LK-001' }), { entries: [], dropped: 0 });
  assert.deepStrictEqual(LeakLog.sanitizeEntries(null), { entries: [], dropped: 0 });
});

test('reportRows does not throw on null, empty or valid entries, and tolerates non-array actions', () => {
  const rows = LeakLog.reportRows([null, {}, raw[0]]);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(LeakLog.reportRows([Object.assign({}, raw[0], { actions: 'deleted' })])[0].actions, 'None recorded');
});

test('exportReport of sanitised stored entries contains only whitelisted keys', () => {
  const kept = LeakLog.sanitizeEntries([Object.assign({}, raw[0], { secret: 'x' })]).entries;
  const rep = LeakLog.exportReport(kept, new Date('2026-10-26T15:00:00.000Z'));
  rep.entries.forEach(function (e) {
    assert.deepStrictEqual(Object.keys(e).sort(),
      ['actions', 'found', 'how', 'id', 'kind', 'notes', 'reachable', 'when', 'where']);
  });
});
