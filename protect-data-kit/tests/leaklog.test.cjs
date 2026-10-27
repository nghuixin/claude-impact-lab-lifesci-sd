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
