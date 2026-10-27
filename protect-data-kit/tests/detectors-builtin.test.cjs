const test = require('node:test');
const assert = require('node:assert');
const Detect = require('../src/detect.js');
const rules = require('../rules.json');

function ids(text, r) { return Detect.scan(text, r || rules).matches.map(function (m) { return m.id; }); }

test('sequence: nucleotide, upper and lower case', () => {
  assert.ok(ids('ATGGCGTACGTTAGCTAGCTAGGATCCA').includes('sequence'));
  assert.ok(ids('atggcgtacgttagctagctaggatcca').includes('sequence'));
});

test('sequence: protein', () => {
  assert.ok(ids('MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQ').includes('sequence'));
});

test('sequence: multi-line FASTA', () => {
  const fasta = '>SYN-SEQ-001\nATGGCGTACGTTAGCTAGCTAGGATCCAATGG\nCGTACGTTAGCTAGCTAGGATCCAATGGCGTA\n';
  assert.ok(ids(fasta).filter(function (i) { return i === 'sequence'; }).length >= 2);
});

test('sequence: short runs and ordinary words are not flagged', () => {
  assert.deepStrictEqual(ids('ACGT and Internationalization'), []);
});

test('sequence: minSeqLen is honored', () => {
  const strict = Object.assign({}, rules, { settings: { minSeqLen: 40 } });
  assert.deepStrictEqual(ids('ATGGCGTACGTTAGCTAGCTAGGATCCA', strict), []);
});

test('smiles: structure strings', () => {
  assert.ok(ids('Cc1ccc(F)cc1C(=O)NC2CCNCC2').includes('smiles'));
  assert.ok(ids('CN1C=NC2=C1C(=O)N(C(=O)N2C)C SYN-0001').includes('smiles'));
});

test('smiles: ordinary tokens are not flagged', () => {
  assert.deepStrictEqual(ids('well-known(2019)-based Scoop-Scoop-Scoop CO2-neutral'), []);
  assert.deepStrictEqual(ids('Compound 12 was synthesized in two steps.'), []);
});

test('smiles: redacted with the STRUCTURE placeholder', () => {
  const text = 'Use Cc1ccc(F)cc1C(=O)NC2CCNCC2 here';
  const r = Detect.scan(text, rules);
  assert.strictEqual(Detect.redact(text, r.matches), 'Use [STRUCTURE] here');
});
