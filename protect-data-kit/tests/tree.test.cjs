const test = require('node:test');
const assert = require('node:assert');
const Tree = require('../src/tree.js');

test('question flow', () => {
  assert.strictEqual(Tree.nextQuestion({}), 'what');
  assert.strictEqual(Tree.nextQuestion({ what: 'public' }), null);
  assert.strictEqual(Tree.nextQuestion({ what: 'credentials' }), null);
  assert.strictEqual(Tree.nextQuestion({ what: 'internal' }), 'where');
  assert.strictEqual(Tree.nextQuestion({ what: 'internal', where: 'api' }), null);
  assert.strictEqual(Tree.nextQuestion({ what: 'ip' }), 'deid');
  assert.strictEqual(Tree.nextQuestion({ what: 'ip', deid: 'no' }), 'where');
  assert.strictEqual(Tree.nextQuestion({ what: 'ip', deid: 'no', where: 'api' }), 'agreement');
  assert.strictEqual(Tree.nextQuestion({ what: 'ip', deid: 'no', where: 'api', agreement: 'no' }), null);
});

test('outcome is null until the flow is complete', () => {
  assert.strictEqual(Tree.outcome({ what: 'ip' }), null);
});

const cases = [
  [{ what: 'credentials' }, 'dont_share'],
  [{ what: 'public' }, 'ok_as_is'],
  [{ what: 'internal', where: 'claude_ai' }, 'ok_as_is'],
  [{ what: 'internal', where: 'vendor' }, 'approved_env'],
  [{ what: 'internal', where: 'not_sure' }, 'approved_env'],
  [{ what: 'patient', deid: 'no', where: 'claude_ai', agreement: 'no' }, 'dont_share'],
  [{ what: 'patient', deid: 'partly', where: 'api', agreement: 'no' }, 'dont_share'],
  [{ what: 'patient', deid: 'no', where: 'claude_ai', agreement: 'dont_know' }, 'approved_env'],
  [{ what: 'patient', deid: 'no', where: 'claude_ai', agreement: 'yes' }, 'approved_env'],
  [{ what: 'ip', deid: 'no', where: 'claude_ai', agreement: 'yes' }, 'approved_env'],
  [{ what: 'ip', deid: 'no', where: 'claude_ai', agreement: 'no' }, 'approved_env'],
  [{ what: 'ip', deid: 'partly', where: 'claude_code', agreement: 'dont_know' }, 'approved_env'],
  [{ what: 'ip', deid: 'fully', where: 'claude_ai', agreement: 'no' }, 'ok_redact'],
  [{ what: 'patient', deid: 'fully', where: 'api', agreement: 'dont_know' }, 'approved_env'],
  [{ what: 'ip', deid: 'fully', where: 'claude_ai', agreement: 'dont_know' }, 'approved_env'],
  [{ what: 'patient', deid: 'fully', where: 'claude_ai', agreement: 'yes' }, 'ok_redact'],
  [{ what: 'ip', deid: 'fully', where: 'vendor', agreement: 'no' }, 'approved_env']
];

cases.forEach(function (c) {
  test('outcome ' + JSON.stringify(c[0]) + ' -> ' + c[1], () => {
    assert.strictEqual(Tree.outcome(c[0]), c[1]);
  });
});

test('unrecognized agreement value fails safe to approved_env', () => {
  assert.strictEqual(Tree.outcome({ what: 'patient', deid: 'fully', where: 'claude_ai', agreement: 'maybe' }), 'approved_env');
  assert.strictEqual(Tree.outcome({ what: 'ip', deid: 'fully', where: 'claude_ai', agreement: 'maybe' }), 'approved_env');
});

test('every complete answer set maps to a known outcome id', () => {
  const values = function (q) { return Tree.QUESTIONS[q].options.map(function (o) { return o[0]; }); };
  values('what').forEach(function (what) {
    values('deid').forEach(function (deid) {
      values('where').forEach(function (where) {
        values('agreement').forEach(function (agreement) {
          const answers = { what: what, deid: deid, where: where, agreement: agreement };
          if (Tree.nextQuestion(answers) === null) {
            assert.ok(Tree.OUTCOMES[Tree.outcome(answers)], JSON.stringify(answers));
          }
        });
      });
    });
  });
});

test("'dont_know' never behaves like 'yes'", () => {
  ['ip', 'patient'].forEach(function (what) {
    ['no', 'partly', 'fully'].forEach(function (deid) {
      const dk = Tree.outcome({ what: what, deid: deid, where: 'claude_ai', agreement: 'dont_know' });
      assert.notStrictEqual(dk, 'ok_as_is');
      assert.notStrictEqual(dk, 'ok_redact');
    });
  });
});

test('every outcome id has a title, body and next step; every question has options', () => {
  ['ok_as_is', 'ok_redact', 'approved_env', 'dont_share'].forEach(function (id) {
    const o = Tree.OUTCOMES[id];
    assert.ok(o.title && o.body && o.next);
  });
  Object.keys(Tree.QUESTIONS).forEach(function (q) {
    assert.ok(Tree.QUESTIONS[q].options.length >= 2);
  });
  assert.match(Tree.DISCLAIMER, /not legal or compliance advice/);
});
