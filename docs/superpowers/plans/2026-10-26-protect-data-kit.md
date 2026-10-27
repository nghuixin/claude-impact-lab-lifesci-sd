# Protect-Data Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the event-day kit: an offline paste-checker, a decision tree, and synthetic datasets that help life sciences participants avoid putting proprietary data into AI tools.

**Architecture:** A pure-JavaScript detection engine (`src/detect.js`) driven by a plain-JSON rules file (`rules.json`) and a pure decision-tree module (`src/tree.js`). A dev-time `build.cjs` inlines the engine, tree, UI script and rules into one dependency-free `index.html`. Synthetic data is generated deterministically from seeds. Node's built-in test runner and a fixtures runner (`tests/run-checks.cjs`) verify everything headlessly.

**Tech Stack:** Plain JavaScript (browser + Node 18+), HTML/CSS, `node:test`. No runtime dependencies. No network calls.

**Spec:** `docs/superpowers/specs/2026-10-26-protect-data-kit-design.md`

## Global Constraints

- Deliverable is a single `index.html` with no dependencies, no network calls, no analytics, and no hosting. It works when opened from disk.
- All commands run from `/Users/thejaredchapman/coding_stuff/claude_communitiy/life_sciences_oct26/protect-data-kit` unless stated otherwise.
- The paste-checker is advisory. The page states that it cannot stop pasting elsewhere.
- Verdict wording: "Clear" means "no matches found", never "safe". The UI never claims a guarantee.
- The original text is never altered. Redaction produces a separate copyable box.
- Watchlist and ID formats persist only in browser `localStorage` on that machine. Export/import uses the `rules.json` format. An imported rules file overrides the embedded copy.
- Severities: **High** (sequences, SMILES/InChI, PHI, secrets), **Medium** (assay values, internal IDs), **Watchlist** (participant terms).
- Redaction placeholders are typed: `[SEQUENCE]`, `[STRUCTURE]`, `[ASSAY]`, `[ID]`, `[PHI]`, `[SECRET]`, `[WATCHLIST:<category>]`.
- The page lists known blind spots: unpublished results in prose, images/screenshots, attachments, anything not on the watchlist.
- Decision tree: "Don't know" about an agreement is never treated as yes and routes to "Only in an approved environment". Every outcome carries a line that this is guidance, not legal or compliance advice. No named regulations or plan terms.
- Synthetic data: every file starts with a "SYNTHETIC, not real data" header; compound IDs use the `SYN-` prefix; everything is generated from random seeds and never adapted from a real or published sequence, structure or study.
- Leak log (added after the user approved the design): records descriptions only and never the leaked data; free-text notes are scanned with the same detectors and a match blocks the save; no names of individuals; entries stay in browser `localStorage` and are sent nowhere; export shape is `{ format:'leak-report', version:1, generated, entries }`; the page says it is a record, not legal or compliance advice.
- Out of scope: enforcement (hooks, proxy, transcript audit), compliance or legal claims, statements about Anthropic data handling, image/PDF/attachment detection, a local LLM classifier.

**Git note:** the workspace is not a git repo. Every "Commit" step applies only if `git init` has been run. Otherwise skip it. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## File Structure

```
protect-data-kit/
  package.json                    scripts: build, test, check, synthetic
  rules.json                      detector rules, settings, empty idFormats/watchlist
  build.cjs                       inlines src/* + rules.json into index.html (dev-time only)
  index.html                      BUILT output (do not hand-edit)
  README.md                       how to open, rebuild, test
  FACILITATOR.md                  demo script: one flagged example, one false negative
  src/
    detect.js                     engine: scan, redact, normalizeRules (browser + Node)
    tree.js                       decision tree: nextQuestion, outcome, text (browser + Node)
    leaklog.js                    leak log: createEntry, nextId, reportRows, exportReport (browser + Node)
    leaklog-ui.js                 leak log tab wiring (browser only)
    app.js                        UI wiring (browser only)
    template.html                 page shell with build markers
  tools/
    generate-synthetic.cjs        seeded generator for synthetic/
  synthetic/                      generated: 4 data files + README.md
  tests/
    detect.test.cjs               engine tests
    detectors-regex.test.cjs      regex detector tests
    detectors-builtin.test.cjs    sequence + SMILES tests
    tree.test.cjs                 decision tree tests
    leaklog.test.cjs              leak log tests
    run-checks.cjs                fixtures + static offline checks, exits non-zero on failure
    fixtures/
      public-text.txt             must produce zero matches
      false-negative-prose.txt    known blind spot, must produce zero matches
```

---

### Task 1: Detection engine core

**Files:**
- Create: `package.json`, `rules.json`, `src/detect.js`
- Test: `tests/detect.test.cjs`

**Interfaces:**
- Produces (used by all later tasks):
  - `Detect.scan(text: string, rules: Rules) -> { matches: Match[], counts: {High:number, Medium:number, Watchlist:number}, verdict: 'Clear'|'Review'|'Stop', errors: string[] }`
  - `Match = { start:number, end:number, text:string, id:string, label:string, severity:'High'|'Medium'|'Watchlist', reason:string, placeholder:string }` (non-overlapping, sorted by `start`)
  - `Detect.redact(text: string, matches: Match[]) -> string` (each match replaced by `[` + placeholder + `]`)
  - `Detect.normalizeRules(obj: any, base?: Rules) -> { ok:true, rules:Rules } | { ok:false, error:string }`
  - `Rules = { version:1, settings:{minSeqLen:number}, detectors:Detector[], idFormats:string[], watchlist:(string|{term:string,category?:string})[] }`
  - `Detector = { id, label, severity, reason, placeholder, type:'regex'|'builtin', pattern?, flags?, fn? }`
  - Node: `module.exports = Detect`. Browser: global `const Detect`.
- Overlap rule: when matches overlap, keep higher severity (High > Medium > Watchlist), then longer, then earlier.
- Verdict: any High → `Stop`; else any Medium or Watchlist → `Review`; else `Clear`.

- [ ] **Step 1: Create `package.json` and an empty-detector `rules.json`**

`package.json`:
```json
{
  "name": "protect-data-kit",
  "private": true,
  "description": "Offline paste-checker, decision tree and synthetic data for protecting proprietary scientific data.",
  "scripts": {
    "build": "node build.cjs",
    "test": "node --test tests/*.test.cjs",
    "check": "node tests/run-checks.cjs",
    "synthetic": "node tools/generate-synthetic.cjs"
  }
}
```

`rules.json`:
```json
{
  "version": 1,
  "settings": { "minSeqLen": 20 },
  "detectors": [],
  "idFormats": [],
  "watchlist": []
}
```

- [ ] **Step 2: Write the failing tests**

`tests/detect.test.cjs`:
```js
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/detect.test.cjs`
Expected: FAIL with "Cannot find module '../src/detect.js'"

- [ ] **Step 4: Write the engine**

`src/detect.js`:
```js
const Detect = (function () {
  const SEVERITY_RANK = { High: 3, Medium: 2, Watchlist: 1 };

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function compileRegex(pattern, flags) {
    const f = flags || '';
    return new RegExp(pattern, f.indexOf('g') === -1 ? f + 'g' : f);
  }

  function collect(re, text) {
    const out = [];
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      out.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    }
    return out;
  }

  // Builtin detectors take (text, settings) and return [{start, end, text}].
  const BUILTINS = {};

  function scan(text, rules) {
    const errors = [];
    const raw = [];
    const settings = rules.settings || {};

    function add(found, meta) {
      found.forEach(function (f) { raw.push(Object.assign({}, f, meta)); });
    }

    (rules.detectors || []).forEach(function (d) {
      const meta = { id: d.id, label: d.label, severity: d.severity, reason: d.reason, placeholder: d.placeholder };
      try {
        if (d.type === 'builtin') {
          const fn = BUILTINS[d.fn];
          if (!fn) { errors.push('Unknown builtin detector: ' + d.fn); return; }
          add(fn(text, settings), meta);
        } else {
          add(collect(compileRegex(d.pattern, d.flags), text), meta);
        }
      } catch (e) {
        errors.push('Detector ' + d.id + ': ' + e.message);
      }
    });

    (rules.idFormats || []).forEach(function (p) {
      try {
        add(collect(compileRegex(p, 'g'), text), {
          id: 'id-format', label: 'Internal ID', severity: 'Medium',
          reason: 'Matches an internal ID format you defined.', placeholder: 'ID'
        });
      } catch (e) {
        errors.push('ID format "' + p + '": ' + e.message);
      }
    });

    (rules.watchlist || []).forEach(function (w) {
      const entry = typeof w === 'string' ? { term: w } : w;
      const term = (entry.term || '').trim();
      if (!term) return;
      const category = entry.category || 'term';
      const re = new RegExp('(?<![A-Za-z0-9_])' + escapeRegExp(term) + '(?![A-Za-z0-9_])', 'gi');
      add(collect(re, text), {
        id: 'watchlist', label: 'Watchlist: ' + category, severity: 'Watchlist',
        reason: 'On your watchlist (' + category + ').', placeholder: 'WATCHLIST:' + category
      });
    });

    const ranked = raw.slice().sort(function (a, b) {
      return (SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]) ||
        ((b.end - b.start) - (a.end - a.start)) ||
        (a.start - b.start);
    });
    const kept = [];
    ranked.forEach(function (m) {
      const clash = kept.some(function (k) { return m.start < k.end && k.start < m.end; });
      if (!clash) kept.push(m);
    });
    kept.sort(function (a, b) { return a.start - b.start; });

    const counts = { High: 0, Medium: 0, Watchlist: 0 };
    kept.forEach(function (m) { counts[m.severity]++; });
    const verdict = counts.High > 0 ? 'Stop' : (counts.Medium + counts.Watchlist > 0 ? 'Review' : 'Clear');
    return { matches: kept, counts: counts, verdict: verdict, errors: errors };
  }

  function redact(text, matches) {
    let out = '';
    let pos = 0;
    matches.slice().sort(function (a, b) { return a.start - b.start; }).forEach(function (m) {
      out += text.slice(pos, m.start) + '[' + m.placeholder + ']';
      pos = m.end;
    });
    return out + text.slice(pos);
  }

  function normalizeRules(obj, base) {
    if (!obj || typeof obj !== 'object') return { ok: false, error: 'Rules file must be a JSON object.' };
    if (obj.version !== 1) return { ok: false, error: 'Unsupported rules version (expected 1).' };
    const rules = {
      version: 1,
      settings: Object.assign({ minSeqLen: 20 }, obj.settings || {}),
      detectors: Array.isArray(obj.detectors) ? obj.detectors : ((base && base.detectors) || []),
      idFormats: Array.isArray(obj.idFormats) ? obj.idFormats.filter(function (x) { return typeof x === 'string'; }) : [],
      watchlist: Array.isArray(obj.watchlist)
        ? obj.watchlist.filter(function (w) { return typeof w === 'string' || (w && typeof w.term === 'string'); })
        : []
    };
    return { ok: true, rules: rules };
  }

  return { scan: scan, redact: redact, normalizeRules: normalizeRules, _collect: collect, _builtins: BUILTINS };
})();

if (typeof module !== 'undefined') module.exports = Detect;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/detect.test.cjs`
Expected: all tests PASS

- [ ] **Step 6: Commit (only if `git init` has been run)**

```bash
git add package.json rules.json src/detect.js tests/detect.test.cjs
git commit -m "feat: detection engine core with watchlist, ID formats, overlap and redaction" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Regex detectors in `rules.json`

**Files:**
- Modify: `rules.json` (replace `"detectors": []`)
- Create: `tests/fixtures/public-text.txt`
- Test: `tests/detectors-regex.test.cjs`

**Interfaces:**
- Consumes: `Detect.scan`, `Detect.redact` from Task 1; `rules.json` shape.
- Produces detector ids later tasks and `run-checks` rely on: `inchi`, `assay-values`, `assay-header`, `assay-row`, `phi-email`, `phi-ssn`, `phi-phone`, `phi-mrn`, `phi-dob`, `phi-name-date`, `secret`.
- Produces: `tests/fixtures/public-text.txt` (must scan to zero matches; reused by Task 5).

- [ ] **Step 1: Create the negative fixture**

`tests/fixtures/public-text.txt`:
```
Aspirin has been used for over a century to reduce pain and inflammation.
In 2019, 45% of survey respondents agreed that clinical trials should be easier to find.
The study enrolled adults across several sites, and the results were published in a peer reviewed journal.
Version 1.2 of the guidance asks teams to document who can see which files.
Protein folding is a topic of broad interest. ACGT is the DNA alphabet.
Internationalization and characterization are long words, but they are just words.
```

- [ ] **Step 2: Write the failing tests**

`tests/detectors-regex.test.cjs`:
```js
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/detectors-regex.test.cjs`
Expected: FAIL (matches missing, because `detectors` is empty); the compile and public-text tests pass.

- [ ] **Step 4: Add the detectors to `rules.json`**

Replace `"detectors": [],` with:
```json
  "detectors": [
    {"id":"inchi","type":"regex","pattern":"InChI=1S?\\/[^\\s]+","flags":"","label":"InChI string","severity":"High","placeholder":"STRUCTURE","reason":"InChI string; encodes a chemical structure."},
    {"id":"assay-values","type":"regex","pattern":"\\b(?:IC50|EC50|GI50|CC50|Ki|Kd)\\s*(?:=|:|≈|~|<|>|of|was|is)?\\s*\\d+(?:\\.\\d+)?\\s*(?:pM|nM|µM|uM|mM)\\b|\\b\\d+(?:\\.\\d+)?\\s*%\\s*inhibition\\b|\\bp\\s*[<=>]\\s*0?\\.\\d+","flags":"i","label":"Assay or result value","severity":"Medium","placeholder":"ASSAY","reason":"Looks like a potency, inhibition or significance result."},
    {"id":"assay-header","type":"regex","pattern":"\\b(?:IC50|EC50|GI50|CC50|Ki|Kd)[ _]?(?:\\((?:pM|nM|uM|µM|mM)\\)|(?:pM|nM|uM|µM|mM)\\b)","flags":"i","label":"Assay column header","severity":"Medium","placeholder":"ASSAY","reason":"Column name for a potency measurement with units."},
    {"id":"assay-row","type":"regex","pattern":"^[^\\n]*\\d+\\.\\d+[,\\t][^\\n]*\\d+\\.\\d+[^\\n]*$","flags":"m","label":"Numeric table row","severity":"Medium","placeholder":"ASSAY","reason":"A table row with several decimal values; may be assay data."},
    {"id":"phi-email","type":"regex","pattern":"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}","flags":"","label":"Email address","severity":"High","placeholder":"PHI","reason":"Email address; personal contact information."},
    {"id":"phi-ssn","type":"regex","pattern":"\\b\\d{3}-\\d{2}-\\d{4}\\b","flags":"","label":"SSN-shaped number","severity":"High","placeholder":"PHI","reason":"Matches the shape of a social security number."},
    {"id":"phi-phone","type":"regex","pattern":"(?<!\\d)(?:\\+?1[ .-]?)?\\(?\\d{3}\\)?[ .-]\\d{3}[ .-]\\d{4}(?!\\d)","flags":"","label":"Phone number","severity":"High","placeholder":"PHI","reason":"Phone number; personal contact information."},
    {"id":"phi-mrn","type":"regex","pattern":"\\bMRN\\s*[:#]?\\s*\\d{5,}\\b","flags":"i","label":"Medical record number","severity":"High","placeholder":"PHI","reason":"Medical record number."},
    {"id":"phi-dob","type":"regex","pattern":"\\b(?:DOB|D\\.O\\.B\\.?|date of birth)\\s*[:\\-]?\\s*\\d{1,4}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{1,4}\\b","flags":"i","label":"Date of birth","severity":"High","placeholder":"PHI","reason":"Date of birth."},
    {"id":"phi-name-date","type":"regex","pattern":"\\b[A-Z][a-z]+ [A-Z][a-z]+,? \\(?\\d{1,2}[\\/-]\\d{1,2}[\\/-]\\d{2,4}\\)?","flags":"","label":"Name with date","severity":"High","placeholder":"PHI","reason":"A person's name next to a date; may identify a participant."},
    {"id":"secret","type":"regex","pattern":"\\bsk-ant-[A-Za-z0-9_-]{20,}|\\bAKIA[0-9A-Z]{16}\\b|\\bgh[pousr]_[A-Za-z0-9]{36,}|\\bxox[baprs]-[A-Za-z0-9-]{10,}|(?:api[_-]?key|secret|token|password)\\s*[:=]\\s*['\"]?[A-Za-z0-9_-]{16,}","flags":"i","label":"Secret or API key","severity":"High","placeholder":"SECRET","reason":"Looks like an API key, token or password."}
  ],
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/detect.test.cjs tests/detectors-regex.test.cjs`
Expected: all PASS. If a case fails, fix the pattern in `rules.json` (remember JSON needs doubled backslashes), not the test.

- [ ] **Step 6: Commit (only if `git init` has been run)**

```bash
git add rules.json tests/detectors-regex.test.cjs tests/fixtures/public-text.txt
git commit -m "feat: regex detectors for assay values, PHI, secrets and InChI" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Sequence and SMILES builtin detectors

**Files:**
- Modify: `src/detect.js` (fill `BUILTINS`), `rules.json` (insert two detectors at the start of `detectors`)
- Test: `tests/detectors-builtin.test.cjs`

**Interfaces:**
- Consumes: `Detect._collect(re, text)` and `Detect._builtins` (exported in Task 1); `settings.minSeqLen`.
- Produces detector ids `sequence` and `smiles` (High). `run-checks` (Task 5) requires them.

- [ ] **Step 1: Write the failing tests**

`tests/detectors-builtin.test.cjs`:
```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/detectors-builtin.test.cjs`
Expected: FAIL; positive cases fail with "Unknown builtin" absent, so detectors simply do not match. Negatives pass.

- [ ] **Step 3: Implement the builtins**

In `src/detect.js`, replace the line `const BUILTINS = {};` with:
```js
  const BUILTINS = {
    sequence: function (text, settings) {
      const n = settings.minSeqLen || 20;
      const nucleotide = new RegExp('(?<![A-Za-z])[ACGTUNacgtun]{' + n + ',}(?![A-Za-z])', 'g');
      const protein = new RegExp('(?<![A-Za-z])[ACDEFGHIKLMNPQRSTVWY]{' + n + ',}(?![A-Za-z])', 'g');
      return collect(nucleotide, text).concat(collect(protein, text));
    },
    smiles: function (text) {
      const token = /[^\s,;"'`]+/g;
      const wholeToken = /^(?:Cl|Br|[BCNOSPFIHcnosp]|\[[^\]\s]+\]|[0-9]|%\d\d|[=#$:\/\\@+\-.()])+$/;
      return collect(token, text).filter(function (t) {
        if (t.text.length < 12 || !wholeToken.test(t.text)) return false;
        if (!/[0-9=#(\[]/.test(t.text)) return false;
        return (t.text.match(/[Cc]/g) || []).length >= 4;
      });
    }
  };
```

- [ ] **Step 4: Register the detectors in `rules.json`**

Insert these two entries immediately after `"detectors": [`:
```json
    {"id":"sequence","type":"builtin","fn":"sequence","label":"Sequence","severity":"High","placeholder":"SEQUENCE","reason":"Long run of nucleotide or amino-acid letters; looks like a biological sequence."},
    {"id":"smiles","type":"builtin","fn":"smiles","label":"Chemical structure (SMILES)","severity":"High","placeholder":"STRUCTURE","reason":"Looks like a SMILES structure string. This is a heuristic and can be wrong."},
```

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all tests across the three files PASS. The public-text negative test in Task 2 must still pass.

- [ ] **Step 6: Commit (only if `git init` has been run)**

```bash
git add src/detect.js rules.json tests/detectors-builtin.test.cjs
git commit -m "feat: sequence and SMILES builtin detectors" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Decision tree module

**Files:**
- Create: `src/tree.js`
- Test: `tests/tree.test.cjs`

**Interfaces:**
- Produces (used by `src/app.js` in Task 6):
  - `Tree.QUESTIONS: { [id]: { text:string, options:[value:string, label:string][] } }` with ids `what`, `deid`, `where`, `agreement`
  - `Tree.OUTCOMES: { [id]: { title:string, body:string, next:string } }` with ids `ok_as_is`, `ok_redact`, `approved_env`, `dont_share`
  - `Tree.DISCLAIMER: string`
  - `Tree.nextQuestion(answers: {what?,deid?,where?,agreement?}) -> 'what'|'deid'|'where'|'agreement'|null`
  - `Tree.outcome(answers) -> outcome id | null` (null until `nextQuestion` is null)
- Answer values: `what` ∈ `public|internal|ip|patient|credentials`; `deid` ∈ `fully|partly|no`; `where` ∈ `claude_ai|claude_code|api|vendor|not_sure`; `agreement` ∈ `yes|no|dont_know`.

- [ ] **Step 1: Write the failing tests**

`tests/tree.test.cjs`:
```js
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
  [{ what: 'patient', deid: 'fully', where: 'api', agreement: 'dont_know' }, 'ok_redact'],
  [{ what: 'ip', deid: 'fully', where: 'vendor', agreement: 'no' }, 'approved_env']
];

cases.forEach(function (c) {
  test('outcome ' + JSON.stringify(c[0]) + ' -> ' + c[1], () => {
    assert.strictEqual(Tree.outcome(c[0]), c[1]);
  });
});

test("'dont_know' never behaves like 'yes'", () => {
  ['ip', 'patient'].forEach(function (what) {
    ['no', 'partly'].forEach(function (deid) {
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/tree.test.cjs`
Expected: FAIL with "Cannot find module '../src/tree.js'"

- [ ] **Step 3: Write the module**

`src/tree.js`:
```js
const Tree = (function () {
  const TRUSTED_WHERE = ['claude_ai', 'claude_code', 'api'];

  const QUESTIONS = {
    what: {
      text: 'What is it?',
      options: [
        ['public', 'Public or published'],
        ['internal', 'Internal but not sensitive'],
        ['ip', 'Unpublished research or IP (sequences, structures, results, program names)'],
        ['patient', 'Patient or participant data'],
        ['credentials', 'Credentials (keys, passwords, tokens)']
      ]
    },
    deid: {
      text: 'Is it de-identified or abstracted?',
      options: [['fully', 'Yes, fully'], ['partly', 'Partly'], ['no', 'No']]
    },
    where: {
      text: 'Where is it going?',
      options: [
        ['claude_ai', 'Claude.ai chat'],
        ['claude_code', 'Claude Code on my machine'],
        ['api', 'An app calling the API'],
        ['vendor', 'A third-party tool or vendor'],
        ['not_sure', 'Not sure']
      ]
    },
    agreement: {
      text: 'Is there an agreement in place?',
      options: [
        ['yes', 'Yes, my organization has approved this tool for this data'],
        ['no', 'No'],
        ['dont_know', "Don't know"]
      ]
    }
  };

  const OUTCOMES = {
    ok_as_is: {
      title: 'OK as is',
      body: 'This looks like content that is already public or not sensitive.',
      next: 'Still skim it once for anything you did not mean to include.'
    },
    ok_redact: {
      title: 'OK after redacting',
      body: 'This can go in only if it is truly de-identified or abstracted, so check it first.',
      next: 'Run it through the paste-checker, remove or replace what it flags, then answer these questions again about the redacted text.'
    },
    approved_env: {
      title: 'Only in an approved environment',
      body: 'This should only go into a tool and setup your organization has approved for this kind of data.',
      next: 'Ask your security or compliance contact which environment is approved. If you are not sure, treat the answer as no.'
    },
    dont_share: {
      title: "Don't share",
      body: 'This should not be put into this tool.',
      next: 'Keep it out of prompts and files. If a credential was already pasted anywhere, rotate it now.'
    }
  };

  const DISCLAIMER = 'This is guidance to help you think it through, not legal or compliance advice.';

  function nextQuestion(a) {
    if (!a.what) return 'what';
    if (a.what === 'public' || a.what === 'credentials') return null;
    if (a.what === 'internal') return a.where ? null : 'where';
    if (!a.deid) return 'deid';
    if (!a.where) return 'where';
    if (!a.agreement) return 'agreement';
    return null;
  }

  function outcome(a) {
    if (nextQuestion(a) !== null) return null;
    if (a.what === 'credentials') return 'dont_share';
    if (a.what === 'public') return 'ok_as_is';
    if (a.what === 'internal') return TRUSTED_WHERE.indexOf(a.where) !== -1 ? 'ok_as_is' : 'approved_env';
    if (a.what === 'patient' && a.deid !== 'fully' && a.agreement === 'no') return 'dont_share';
    if (a.deid === 'fully' && TRUSTED_WHERE.indexOf(a.where) !== -1) return 'ok_redact';
    return 'approved_env';
  }

  return { QUESTIONS: QUESTIONS, OUTCOMES: OUTCOMES, DISCLAIMER: DISCLAIMER, nextQuestion: nextQuestion, outcome: outcome };
})();

if (typeof module !== 'undefined') module.exports = Tree;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/tree.test.cjs`
Expected: all PASS

- [ ] **Step 5: Commit (only if `git init` has been run)**

```bash
git add src/tree.js tests/tree.test.cjs
git commit -m "feat: decision tree logic and outcome text" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Synthetic datasets and the fixtures runner

**Files:**
- Create: `tools/generate-synthetic.cjs`, `tests/fixtures/false-negative-prose.txt`, `tests/run-checks.cjs`
- Generate: `synthetic/assay_results.csv`, `synthetic/sequences.fasta`, `synthetic/compounds.smi`, `synthetic/trial_sites.md`, `synthetic/README.md`

**Interfaces:**
- Consumes: `Detect.scan` (Tasks 1-3), `rules.json` detector ids, `tests/fixtures/public-text.txt` (Task 2).
- Produces: the `synthetic/` files, and `tests/run-checks.cjs` (exit code 0 = all pass). Task 6 extends `run-checks.cjs` with static offline checks.

- [ ] **Step 1: Create the false-negative fixture**

`tests/fixtures/false-negative-prose.txt`:
```
In our latest run the lead showed strong activity at a low dose, and the toxicity signal we worried about disappeared in the second cohort.
```
This is the known blind spot: unpublished results in prose. It must scan to zero matches, and the facilitator uses it to show the checker's limits.

- [ ] **Step 2: Write the failing fixtures runner**

`tests/run-checks.cjs`:
```js
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

if (failures > 0) { console.log('\n' + failures + ' check(s) failed.'); process.exit(1); }
console.log('\nAll checks passed.');
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node tests/run-checks.cjs`
Expected: FAIL with an ENOENT error for `synthetic/assay_results.csv` (files not generated yet).

- [ ] **Step 4: Write the generator**

`tools/generate-synthetic.cjs`:
```js
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'synthetic');
const HEADER = 'SYNTHETIC, not real data';

// Seeded PRNG (mulberry32) so the files are reproducible.
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(r, list) { return list[Math.floor(r() * list.length)]; }
function int(r, lo, hi) { return lo + Math.floor(r() * (hi - lo + 1)); }
function pad(n, w) { return String(n).padStart(w, '0'); }
function wrap(s, w) { const out = []; for (let i = 0; i < s.length; i += w) out.push(s.slice(i, i + w)); return out.join('\n'); }
function write(name, text) { fs.writeFileSync(path.join(outDir, name), text); }

fs.mkdirSync(outDir, { recursive: true });

// assay_results.csv
(function () {
  const r = rng(1001);
  const targets = ['TGT-A', 'TGT-B', 'TGT-C', 'TGT-D'];
  const rows = ['# ' + HEADER, 'compound_id,target,ic50_nM,ki_nM,hill_slope'];
  for (let i = 1; i <= 20; i++) {
    rows.push('SYN-' + pad(i, 4) + ',' + pick(r, targets) + ',' +
      (r() * 500 + 0.5).toFixed(1) + ',' + (r() * 200 + 0.5).toFixed(1) + ',' + (r() * 1.5 + 0.5).toFixed(2));
  }
  write('assay_results.csv', rows.join('\n') + '\n');
})();

// sequences.fasta
(function () {
  const r = rng(2002);
  const nuc = 'ACGT';
  const aa = 'ACDEFGHIKLMNPQRSTVWY';
  const out = ['; ' + HEADER];
  for (let i = 1; i <= 3; i++) {
    let s = ''; for (let k = 0; k < 120; k++) s += nuc[Math.floor(r() * nuc.length)];
    out.push('>SYN-SEQ-N' + pad(i, 3) + ' synthetic nucleotide', wrap(s, 60));
  }
  for (let i = 1; i <= 3; i++) {
    let s = ''; for (let k = 0; k < 90; k++) s += aa[Math.floor(r() * aa.length)];
    out.push('>SYN-SEQ-P' + pad(i, 3) + ' synthetic protein', wrap(s, 60));
  }
  write('sequences.fasta', out.join('\n') + '\n');
})();

// compounds.smi: generic made-up scaffold with random substituents.
(function () {
  const r = rng(3003);
  const subs = ['C', 'CC', 'CCC', 'OC', 'F', 'Cl', 'C(F)(F)F', 'N(C)C'];
  const rings = ['C2CCNCC2', 'C2CCOCC2', 'C2CCCC2'];
  const out = ['# ' + HEADER];
  for (let i = 1; i <= 12; i++) {
    const smi = pick(r, subs) + 'c1ccc(' + pick(r, subs) + ')cc1C(=O)N' + pick(r, rings);
    out.push(smi + ' SYN-' + pad(i, 4));
  }
  write('compounds.smi', out.join('\n') + '\n');
})();

// trial_sites.md: fake sites with PHI-shaped fields.
(function () {
  const r = rng(4004);
  const first = ['Pat', 'Jordan', 'Casey', 'Riley', 'Morgan', 'Avery'];
  const last = ['Example', 'Sample', 'Placeholder', 'Testcase', 'Demo', 'Mockup'];
  const sites = ['Harborview Demo Site', 'Northfield Sample Clinic', 'Lakeside Mock Hospital'];
  const out = ['<!-- ' + HEADER + ' -->', '# Synthetic trial sites', '', HEADER, ''];
  sites.forEach(function (site, s) {
    out.push('## SYN-SITE-' + pad(s + 1, 2) + ': ' + site, '');
    for (let p = 0; p < 2; p++) {
      const f = pick(r, first), l = pick(r, last);
      const dob = pad(int(r, 1, 12), 2) + '/' + pad(int(r, 1, 28), 2) + '/' + int(r, 1950, 2000);
      out.push(
        '- Participant: ' + f + ' ' + l + ', ' + dob,
        '  - MRN: ' + pad(int(r, 1, 9999999), 7),
        '  - DOB: ' + dob,
        '  - SSN: 000-' + pad(int(r, 1, 99), 2) + '-' + pad(int(r, 1, 9999), 4),
        '  - Contact: ' + f.toLowerCase() + '.' + l.toLowerCase() + '@example.test, (555) 010-' + pad(int(r, 0, 9999), 4)
      );
    }
    out.push('');
  });
  write('trial_sites.md', out.join('\n'));
})();

// README.md
write('README.md', [
  '<!-- ' + HEADER + ' -->',
  '# Synthetic datasets',
  '',
  HEADER + '. Every value in these files is invented. Compound IDs use the `SYN-` prefix so they cannot be mistaken for real programs. Nothing here is adapted from a real or published sequence, structure or study.',
  '',
  '## Files',
  '- `assay_results.csv`: fake compounds, targets and IC50/Ki values.',
  '- `sequences.fasta`: random nucleotide and protein sequences.',
  '- `compounds.smi`: made-up structure strings.',
  '- `trial_sites.md`: fake sites and participants with fake identifiers (to try the PHI checks).',
  '',
  '## Try them in a Claude session',
  'Use only these files, never your own data. Sample prompts:',
  '- "Summarize the assay table and tell me which targets look most potent."',
  '- "Group the compounds in compounds.smi by substituent pattern."',
  '- "What fields in trial_sites.md would be identifying? How would you de-identify this file?"',
  '- "Write a short README for the sequences in sequences.fasta."',
  '',
  'Then paste a file into the paste-checker (`index.html`) to see what it flags and how redaction looks.',
  ''
].join('\n'));

console.log('Wrote synthetic files to ' + outDir);
```

- [ ] **Step 5: Generate the files and run the checks**

Run: `node tools/generate-synthetic.cjs && node tests/run-checks.cjs`
Expected: "Wrote synthetic files ..." then every line `PASS`, ending with "All checks passed." If a `triggers` check fails, fix the detector or the generator output, not the check. Run `node tools/generate-synthetic.cjs` a second time and confirm `git diff`-style identical output (for example `shasum synthetic/*` before and after is unchanged).

- [ ] **Step 6: Run the full unit suite again**

Run: `npm test`
Expected: all PASS

- [ ] **Step 7: Commit (only if `git init` has been run)**

```bash
git add tools synthetic tests/run-checks.cjs tests/fixtures/false-negative-prose.txt
git commit -m "feat: seeded synthetic datasets and fixtures runner" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: UI, build script and offline static checks

**Files:**
- Create: `src/template.html`, `src/app.js`, `build.cjs`
- Modify: `tests/run-checks.cjs` (append static checks before the final summary)
- Generate: `index.html`

**Interfaces:**
- Consumes: `Detect.scan/redact/normalizeRules`, `Tree.QUESTIONS/OUTCOMES/DISCLAIMER/nextQuestion/outcome` as defined above; globals `Detect` and `Tree` exist because `detect.js` and `tree.js` are inlined as earlier classic scripts.
- Template markers (each appears exactly once): `/*__RULES__*/` (inside `<script type="application/json" id="embedded-rules">`), `/*__DETECT__*/`, `/*__TREE__*/`, `/*__APP__*/`.
- Produces `index.html`, a single file with no external references.

- [ ] **Step 1: Write the failing static checks**

In `tests/run-checks.cjs`, insert before the line `if (failures > 0) {`:
```js
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
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/run-checks.cjs`
Expected: FAIL on "index.html has been built".

- [ ] **Step 3: Write the page shell**

`src/template.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Protect-Data Kit</title>
<style>
  :root { --fg:#1b1b1f; --bg:#fafafa; --muted:#4a4a55; --line:#c9c9d3; --accent:#1a4fa0; }
  * { box-sizing: border-box; }
  body { margin:0; font:16px/1.5 system-ui, sans-serif; color:var(--fg); background:var(--bg); }
  header, main { max-width: 860px; margin: 0 auto; padding: 16px; }
  h1 { margin: 0 0 4px; font-size: 1.5rem; }
  h2, h3 { margin: 20px 0 8px; }
  p.lead { margin: 0; color: var(--muted); }
  [role=tablist] { display:flex; gap:8px; max-width:860px; margin:0 auto; padding:0 16px; }
  [role=tab] { font:inherit; padding:8px 14px; border:2px solid var(--line); background:#fff; border-radius:6px 6px 0 0; cursor:pointer; }
  [role=tab][aria-selected=true] { border-color: var(--accent); font-weight: 700; }
  button { font:inherit; padding:8px 14px; border:2px solid var(--accent); background:#fff; color:var(--accent); border-radius:6px; cursor:pointer; }
  button:focus-visible, textarea:focus-visible, input:focus-visible, summary:focus-visible { outline: 3px solid #f5a300; outline-offset: 2px; }
  textarea { width:100%; min-height:140px; font:14px/1.4 ui-monospace, monospace; padding:8px; border:2px solid var(--line); border-radius:6px; }
  .box { white-space: pre-wrap; word-break: break-word; border:2px solid var(--line); border-radius:6px; padding:8px; background:#fff; min-height:48px; font:14px/1.4 ui-monospace, monospace; }
  mark { padding:0 2px; border-radius:3px; color:inherit; }
  mark.sev-High { background:#ffd1d1; border-bottom:3px solid #b00020; }
  mark.sev-Medium { background:#ffe7b8; border-bottom:3px dashed #8a5a00; }
  mark.sev-Watchlist { background:#d6e6ff; border-bottom:3px dotted #1a4fa0; }
  #verdict { font-weight:700; padding:10px; border-radius:6px; border:2px solid var(--line); background:#fff; }
  #verdict.Stop { border-color:#b00020; } #verdict.Review { border-color:#8a5a00; } #verdict.Clear { border-color:#1a6b2f; }
  .opts { display:flex; flex-direction:column; gap:10px; max-width:560px; }
  .opts button { text-align:left; padding:14px; font-size:1.05rem; }
  .card { border:2px solid var(--accent); border-radius:8px; padding:16px; background:#fff; max-width:560px; }
  .small { color:var(--muted); font-size:.9rem; }
  ul.findings { padding-left: 20px; }
</style>
</head>
<body>
<header>
  <h1>Protect-Data Kit</h1>
  <p class="lead">Runs entirely in this browser tab. Nothing you paste here is sent anywhere.</p>
</header>

<div role="tablist" aria-label="Tools">
  <button role="tab" id="tab-check" aria-controls="panel-check" aria-selected="true">Paste-checker</button>
  <button role="tab" id="tab-tree" aria-controls="panel-tree" aria-selected="false">Decision tree</button>
</div>

<main>
<section id="panel-check" role="tabpanel" aria-labelledby="tab-check">
  <p class="small">This checker is advisory. It flags likely matches to help you notice them; it cannot stop you from pasting somewhere else, and it does not guarantee that text is safe to share.</p>
  <label for="input"><strong>Paste text to check</strong></label>
  <textarea id="input" spellcheck="false"></textarea>

  <div id="verdict" role="status" aria-live="polite">Paste text above to check it.</div>
  <p id="counts" class="small"></p>

  <h3>Highlighted</h3>
  <div id="highlight" class="box" aria-label="Text with matches highlighted"></div>

  <h3>Findings</h3>
  <ul id="findings" class="findings"></ul>

  <h3>Redacted copy</h3>
  <textarea id="redacted" readonly aria-label="Redacted copy of your text"></textarea>
  <p><button id="copy" type="button">Copy redacted text</button> <span id="copy-status" class="small" role="status"></span></p>

  <details>
    <summary><strong>Your watchlist and ID formats</strong> (saved only in this browser)</summary>
    <p><label for="watchlist">Watchlist, one per line. Optional category after a bar, e.g. <code>Project Aurora | program</code></label></p>
    <textarea id="watchlist" spellcheck="false"></textarea>
    <p><label for="idformats">Internal ID formats, one regular expression per line, e.g. <code>ABC-\d{5}</code></label></p>
    <textarea id="idformats" spellcheck="false"></textarea>
    <p>
      <button id="export" type="button">Export rules</button>
      <label class="small">Import rules <input id="import" type="file" accept="application/json,.json"></label>
      <button id="reset" type="button">Reset to defaults</button>
    </p>
    <p id="status" class="small" role="status"></p>
  </details>

  <h3>What this cannot catch</h3>
  <ul>
    <li>Unpublished results written in ordinary prose.</li>
    <li>Images and screenshots.</li>
    <li>Attachments and files you upload.</li>
    <li>Anything that is not on your watchlist and does not match a pattern.</li>
  </ul>
</section>

<section id="panel-tree" role="tabpanel" aria-labelledby="tab-tree" hidden>
  <div id="tree-body"></div>
</section>
</main>

<script type="application/json" id="embedded-rules">/*__RULES__*/</script>
<script>/*__DETECT__*/</script>
<script>/*__TREE__*/</script>
<script>/*__APP__*/</script>
</body>
</html>
```

- [ ] **Step 4: Write the UI script**

`src/app.js`:
```js
(function () {
  'use strict';

  var embedded = JSON.parse(document.getElementById('embedded-rules').textContent);
  var STORE_KEY = 'pdk.rules.v1';
  var $ = function (id) { return document.getElementById(id); };

  function defaults() { return Detect.normalizeRules(embedded).rules; }

  function loadRules() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (saved) {
        var n = Detect.normalizeRules(saved, embedded);
        if (n.ok) return n.rules;
      }
    } catch (e) { /* fall through to defaults */ }
    return defaults();
  }

  var rules = loadRules();

  function setStatus(msg) { $('status').textContent = msg; }

  function saveRules() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(rules)); setStatus(''); }
    catch (e) { setStatus('Could not save in this browser; your changes last for this tab only.'); }
  }

  // ---- watchlist helpers
  function parseWatchlist(text) {
    return text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
      var p = l.split('|');
      return { term: p[0].trim(), category: (p[1] || '').trim() || 'term' };
    });
  }
  function formatWatchlist(list) {
    return list.map(function (w) {
      var e = typeof w === 'string' ? { term: w } : w;
      return e.category && e.category !== 'term' ? e.term + ' | ' + e.category : e.term;
    }).join('\n');
  }
  function parseLines(text) {
    return text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
  }
  function syncInputs() {
    $('watchlist').value = formatWatchlist(rules.watchlist);
    $('idformats').value = rules.idFormats.join('\n');
  }

  // ---- checker
  var VERDICT_TEXT = {
    Clear: 'Clear: no matches found. This is not a guarantee that the text is safe to share.',
    Review: 'Review: possible matches found. Check each one below.',
    Stop: 'Stop: likely sensitive content found. Remove or redact it before sending it anywhere.'
  };

  function renderHighlights(container, text, matches) {
    container.textContent = '';
    var pos = 0;
    matches.forEach(function (m) {
      if (m.start > pos) container.appendChild(document.createTextNode(text.slice(pos, m.start)));
      var mark = document.createElement('mark');
      mark.className = 'sev-' + m.severity;
      mark.textContent = m.text;
      mark.title = m.label + ': ' + m.reason;
      container.appendChild(mark);
      pos = m.end;
    });
    if (pos < text.length) container.appendChild(document.createTextNode(text.slice(pos)));
  }

  function renderFindings(list, matches) {
    list.textContent = '';
    matches.forEach(function (m) {
      var li = document.createElement('li');
      li.textContent = '[' + m.severity + '] ' + m.label + ': ' + m.reason + ' Matched: ' + m.text;
      list.appendChild(li);
    });
  }

  function run() {
    var text = $('input').value;
    if (!text) {
      $('verdict').className = '';
      $('verdict').textContent = 'Paste text above to check it.';
      $('counts').textContent = '';
      $('highlight').textContent = '';
      $('findings').textContent = '';
      $('redacted').value = '';
      return;
    }
    var r = Detect.scan(text, rules);
    $('verdict').className = r.verdict;
    $('verdict').textContent = VERDICT_TEXT[r.verdict];
    $('counts').textContent = 'High: ' + r.counts.High + '   Medium: ' + r.counts.Medium + '   Watchlist: ' + r.counts.Watchlist;
    renderHighlights($('highlight'), text, r.matches);
    renderFindings($('findings'), r.matches);
    $('redacted').value = Detect.redact(text, r.matches);
    if (r.errors.length) setStatus('Some rules could not be applied: ' + r.errors.join(' | '));
  }

  $('input').addEventListener('input', run);

  $('copy').addEventListener('click', function () {
    var box = $('redacted');
    box.select();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(box.value).then(
        function () { $('copy-status').textContent = 'Copied.'; },
        function () { document.execCommand('copy'); $('copy-status').textContent = 'Copied.'; }
      );
    } else {
      document.execCommand('copy');
      $('copy-status').textContent = 'Copied.';
    }
  });

  $('watchlist').addEventListener('input', function () {
    rules.watchlist = parseWatchlist($('watchlist').value);
    saveRules(); run();
  });
  $('idformats').addEventListener('input', function () {
    rules.idFormats = parseLines($('idformats').value);
    saveRules(); run();
  });

  $('export').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'rules.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('import').addEventListener('change', function (ev) {
    var file = ev.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var n = Detect.normalizeRules(JSON.parse(reader.result), embedded);
        if (!n.ok) { setStatus('Import failed: ' + n.error); return; }
        rules = n.rules;
        saveRules(); syncInputs(); run();
        setStatus('Imported ' + file.name + '.');
      } catch (e) { setStatus('Import failed: that file is not valid JSON.'); }
    };
    reader.readAsText(file);
  });

  $('reset').addEventListener('click', function () {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
    rules = defaults();
    syncInputs(); run();
    setStatus('Reset to defaults.');
  });

  // ---- tabs
  function showTab(which) {
    ['check', 'tree'].forEach(function (t) {
      var selected = t === which;
      $('tab-' + t).setAttribute('aria-selected', String(selected));
      $('panel-' + t).hidden = !selected;
    });
  }
  $('tab-check').addEventListener('click', function () { showTab('check'); });
  $('tab-tree').addEventListener('click', function () { showTab('tree'); });

  // ---- decision tree
  var answers = {};

  function renderTree() {
    var body = $('tree-body');
    body.textContent = '';
    var q = Tree.nextQuestion(answers);

    if (q) {
      var h = document.createElement('h2');
      h.textContent = Tree.QUESTIONS[q].text;
      body.appendChild(h);
      var wrap = document.createElement('div');
      wrap.className = 'opts';
      Tree.QUESTIONS[q].options.forEach(function (opt) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = opt[1];
        b.addEventListener('click', function () { answers[q] = opt[0]; renderTree(); });
        wrap.appendChild(b);
      });
      body.appendChild(wrap);
    } else {
      var o = Tree.OUTCOMES[Tree.outcome(answers)];
      var card = document.createElement('div');
      card.className = 'card';
      card.setAttribute('role', 'status');
      var t = document.createElement('h2'); t.textContent = o.title;
      var p1 = document.createElement('p'); p1.textContent = o.body;
      var p2 = document.createElement('p'); p2.textContent = 'Next step: ' + o.next;
      var p3 = document.createElement('p'); p3.className = 'small'; p3.textContent = Tree.DISCLAIMER;
      card.appendChild(t); card.appendChild(p1); card.appendChild(p2); card.appendChild(p3);
      body.appendChild(card);
    }

    if (Object.keys(answers).length) {
      var restart = document.createElement('p');
      var rb = document.createElement('button');
      rb.type = 'button';
      rb.textContent = 'Start over';
      rb.addEventListener('click', function () { answers = {}; renderTree(); });
      restart.appendChild(rb);
      body.appendChild(restart);
    }
  }

  syncInputs();
  renderTree();
})();
```

- [ ] **Step 5: Write the build script**

`build.cjs`:
```js
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = function (f) { return fs.readFileSync(path.join(root, f), 'utf8'); };

const parts = {
  RULES: JSON.stringify(JSON.parse(read('rules.json'))).replace(/</g, '\\u003c'),
  DETECT: read('src/detect.js'),
  TREE: read('src/tree.js'),
  APP: read('src/app.js')
};

let html = read('src/template.html');
Object.keys(parts).forEach(function (key) {
  const marker = '/*__' + key + '__*/';
  if (html.split(marker).length !== 2) throw new Error('Template must contain ' + marker + ' exactly once');
  if (key !== 'RULES' && /<\/script/i.test(parts[key])) throw new Error('src for ' + key + ' contains </script');
  html = html.split(marker).join(parts[key]);
});

fs.writeFileSync(path.join(root, 'index.html'), html);
console.log('Built index.html (' + html.length + ' bytes)');
```

- [ ] **Step 6: Build and run every check**

Run: `npm run build && npm run check && npm test`
Expected: "Built index.html ...", all `PASS` lines (including the static offline checks), and all unit tests passing. If `contains no "http://"` fails, find the offending text in `src/` and remove it.

- [ ] **Step 7: Commit (only if `git init` has been run)**

```bash
git add src build.cjs index.html tests/run-checks.cjs
git commit -m "feat: paste-checker and decision tree UI, build script, offline static checks" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Leak log sheet

**Files:**
- Create: `src/leaklog.js`, `src/leaklog-ui.js`
- Modify: `src/template.html`, `src/app.js`, `build.cjs`, `tests/run-checks.cjs`
- Test: `tests/leaklog.test.cjs`
- Generate: `index.html` (rebuilt)

**Interfaces:**
- Consumes: `Detect.scan(text, rules) -> { matches:[{label,severity,start,end,text,...}], ... }`, `Detect.normalizeRules`, `Tree.QUESTIONS.where.options` (from `src/tree.js`); in the page, `rules` held by `src/app.js` (exposed to the new UI through `window.PDK.getRules()`).
- Produces (global `LeakLog` in the page; `module.exports = LeakLog` in Node):
  - `LeakLog.DATA_KINDS, HOW, WHERE, FOUND, REACHABLE, ACTIONS`: arrays of `[value, label]`; `WHERE` is `Tree.QUESTIONS.where.options`.
  - `LeakLog.NOTES_MAX = 500`
  - `LeakLog.COLUMNS`: array of `[key, heading]` used for the table and print report.
  - `LeakLog.createEntry(fields, rules, existing) -> { ok:true, entry } | { ok:false, errors:string[], blocked:{label,severity,start,end}[] }`. `fields = { when:string(ISO or datetime-local), kind, how, where, found, reachable, actions:string[], notes:string }`. `entry = { id:'LK-001', when:ISO-UTC string, kind, how, where, found, reachable, actions:string[], notes }` (whitelisted keys only). If `notes` matches any detector the save is refused: `blocked` carries labels and positions, never the matched text.
  - `LeakLog.nextId(entries) -> 'LK-NNN'` (max existing number + 1, zero-padded to 3).
  - `LeakLog.reportRows(entries) -> object[]` with human-readable strings for every `COLUMNS` key (`when` rendered as `YYYY-MM-DD HH:MM UTC`; empty `actions` rendered as `None recorded`).
  - `LeakLog.exportReport(entries, now:Date) -> { format:'leak-report', version:1, generated:ISO string, entries:[...] }` (the shape the later audit sub-project will also emit).
- Script order in the page: DETECT, TREE, LEAKLOG, APP, LEAKUI. New build markers: `/*__LEAKLOG__*/`, `/*__LEAKUI__*/`.

- [ ] **Step 1: Write the failing tests**

`tests/leaklog.test.cjs`:
```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/leaklog.test.cjs`
Expected: FAIL with "Cannot find module '../src/leaklog.js'"

- [ ] **Step 3: Write the pure module**

`src/leaklog.js`:
```js
const LeakLog = (function () {
  const treeRef = typeof Tree !== 'undefined' ? Tree : require('./tree.js');
  const detectRef = typeof Detect !== 'undefined' ? Detect : require('./detect.js');

  const NOTES_MAX = 500;

  const DATA_KINDS = [
    ['ip', 'Unpublished research or IP'],
    ['patient', 'Patient or participant data'],
    ['credentials', 'Credentials'],
    ['internal', 'Internal, not sensitive'],
    ['other', 'Other']
  ];
  const HOW = [
    ['pasted', 'Pasted into a chat or prompt'],
    ['uploaded', 'Uploaded a file'],
    ['link', 'Shared a link'],
    ['screenshot', 'Sent a screenshot or image'],
    ['tool_read', 'A tool read it from a prompt, file or folder'],
    ['api_app', 'Sent through an app or API'],
    ['other', 'Other']
  ];
  const WHERE = treeRef.QUESTIONS.where.options;
  const FOUND = [
    ['paste_checker', 'Paste-checker'],
    ['self', 'I noticed'],
    ['colleague', 'A colleague noticed'],
    ['audit', 'A later audit']
  ];
  const REACHABLE = [['yes', 'Yes'], ['no', 'No'], ['dont_know', "Don't know"]];
  const ACTIONS = [
    ['deleted', 'Deleted the conversation or file'],
    ['rotated', 'Rotated the credential'],
    ['told_contact', 'Told the security or compliance contact'],
    ['other', 'Other']
  ];

  const COLUMNS = [
    ['id', 'ID'], ['when', 'When'], ['kind', 'Data'], ['how', 'How it leaked'],
    ['where', 'Where it went'], ['found', 'How it was found'],
    ['reachable', 'Still reachable'], ['actions', 'Actions taken'], ['notes', 'Notes']
  ];

  function values(list) { return list.map(function (o) { return o[0]; }); }
  function labelOf(list, v) {
    const hit = list.filter(function (o) { return o[0] === v; })[0];
    return hit ? hit[1] : String(v);
  }

  function nextId(entries) {
    let max = 0;
    (entries || []).forEach(function (e) {
      const m = /^LK-(\d+)$/.exec(e && e.id);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return 'LK-' + String(max + 1).padStart(3, '0');
  }

  function createEntry(fields, rules, existing) {
    const f = fields || {};
    const errors = [];

    [['kind', DATA_KINDS], ['how', HOW], ['where', WHERE], ['found', FOUND], ['reachable', REACHABLE]]
      .forEach(function (pair) {
        if (values(pair[1]).indexOf(f[pair[0]]) === -1) errors.push('Choose a value for "' + pair[0] + '".');
      });

    const when = typeof f.when === 'string' ? Date.parse(f.when) : NaN;
    if (isNaN(when)) errors.push('Enter a valid date and time.');

    const actions = Array.isArray(f.actions) ? f.actions : [];
    if (actions.some(function (a) { return values(ACTIONS).indexOf(a) === -1; })) errors.push('Unknown action.');

    const notes = typeof f.notes === 'string' ? f.notes : '';
    if (notes.length > NOTES_MAX) errors.push('Notes are limited to ' + NOTES_MAX + ' characters.');

    let blocked = [];
    if (notes) {
      blocked = detectRef.scan(notes, rules).matches.map(function (m) {
        return { label: m.label, severity: m.severity, start: m.start, end: m.end };
      });
      if (blocked.length) errors.push('The notes look like they contain the data itself. Describe it instead of pasting it, then save again.');
    }

    if (errors.length) return { ok: false, errors: errors, blocked: blocked };

    return {
      ok: true,
      entry: {
        id: nextId(existing),
        when: new Date(when).toISOString(),
        kind: f.kind,
        how: f.how,
        where: f.where,
        found: f.found,
        reachable: f.reachable,
        actions: values(ACTIONS).filter(function (a) { return actions.indexOf(a) !== -1; }),
        notes: notes
      }
    };
  }

  function reportRows(entries) {
    return (entries || []).map(function (e) {
      return {
        id: e.id,
        when: String(e.when).replace('T', ' ').slice(0, 16) + ' UTC',
        kind: labelOf(DATA_KINDS, e.kind),
        how: labelOf(HOW, e.how),
        where: labelOf(WHERE, e.where),
        found: labelOf(FOUND, e.found),
        reachable: labelOf(REACHABLE, e.reachable),
        actions: (e.actions && e.actions.length)
          ? e.actions.map(function (a) { return labelOf(ACTIONS, a); }).join('; ')
          : 'None recorded',
        notes: e.notes || ''
      };
    });
  }

  function exportReport(entries, now) {
    return { format: 'leak-report', version: 1, generated: now.toISOString(), entries: entries.slice() };
  }

  return {
    NOTES_MAX: NOTES_MAX, DATA_KINDS: DATA_KINDS, HOW: HOW, WHERE: WHERE, FOUND: FOUND,
    REACHABLE: REACHABLE, ACTIONS: ACTIONS, COLUMNS: COLUMNS,
    createEntry: createEntry, nextId: nextId, reportRows: reportRows, exportReport: exportReport
  };
})();

if (typeof module !== 'undefined') module.exports = LeakLog;
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/leaklog.test.cjs`
Expected: all PASS

- [ ] **Step 5: Add the page markup**

In `src/template.html`:

(a) Inside the `<style>` block, before `</style>`, add:
```css
  table.leak-table { border-collapse: collapse; width: 100%; background: #fff; font-size: .9rem; }
  table.leak-table th, table.leak-table td { border: 1px solid var(--line); padding: 6px; text-align: left; vertical-align: top; }
  fieldset { border: 2px solid var(--line); border-radius: 6px; }
  select, input[type=datetime-local] { font: inherit; padding: 6px; max-width: 100%; }
  @media print { header, [role=tablist], .no-print { display: none; } body { background: #fff; } }
```

(b) In the tablist `<div role="tablist" ...>`, after the `tab-tree` button, add:
```html
  <button role="tab" id="tab-leak" aria-controls="panel-leak" aria-selected="false">Leak log</button>
```

(c) After the `panel-tree` `</section>` (before `</main>`), add:
```html
<section id="panel-leak" role="tabpanel" aria-labelledby="tab-leak" hidden>
  <h2>Leak log</h2>
  <p class="small">Use this to record that sensitive data was shared where it should not have been. It keeps descriptions only. Describe, do not paste: never type or paste the data itself, and do not enter the names of individuals (roles are fine). Entries stay in this browser and are sent nowhere. This is a record, not legal or compliance advice.</p>
  <form id="leak-form" novalidate>
    <p><label for="leak-when">When</label><br><input id="leak-when" type="datetime-local"></p>
    <p><label for="leak-kind">What kind of data</label><br><select id="leak-kind"></select></p>
    <p><label for="leak-how">How it leaked</label><br><select id="leak-how"></select></p>
    <p><label for="leak-where">Where it went</label><br><select id="leak-where"></select></p>
    <p><label for="leak-found">How it was found</label><br><select id="leak-found"></select></p>
    <p><label for="leak-reachable">Is it still reachable?</label><br><select id="leak-reachable"></select></p>
    <fieldset><legend>Actions taken</legend><div id="leak-actions"></div></fieldset>
    <p><label for="leak-notes">Notes (up to 500 characters, describe do not paste)</label><br><textarea id="leak-notes" maxlength="500" spellcheck="false"></textarea></p>
    <p><button id="leak-save" type="submit">Save entry</button></p>
  </form>
  <p id="leak-errors" class="small" role="alert"></p>
  <p id="leak-status" class="small" role="status"></p>
  <h3>Entries</h3>
  <div id="leak-table-wrap"></div>
  <p class="no-print">
    <button id="leak-export" type="button">Export JSON</button>
    <button id="leak-print" type="button">Print report</button>
    <button id="leak-clear" type="button">Clear all entries</button>
  </p>
</section>
```

(d) Replace the four script lines at the end of `<body>` with these, in this order:
```html
<script type="application/json" id="embedded-rules">/*__RULES__*/</script>
<script>/*__DETECT__*/</script>
<script>/*__TREE__*/</script>
<script>/*__LEAKLOG__*/</script>
<script>/*__APP__*/</script>
<script>/*__LEAKUI__*/</script>
```

- [ ] **Step 6: Expose rules and extend tabs in `src/app.js`**

(a) Immediately after the line `var rules = loadRules();` add:
```js
  window.PDK = { getRules: function () { return rules; } };
```
(b) In `showTab`, change the array `['check', 'tree']` to `['check', 'tree', 'leak']`.
(c) Directly after the line that binds `$('tab-tree')` click, add:
```js
  $('tab-leak').addEventListener('click', function () { showTab('leak'); });
```

- [ ] **Step 7: Write the UI script**

`src/leaklog-ui.js`:
```js
(function () {
  'use strict';

  var STORE_KEY = 'pdk.leaklog.v1';
  var $ = function (id) { return document.getElementById(id); };
  var entries = load();
  var confirmingClear = false;

  function load() {
    try {
      var v = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(entries)); $('leak-status').textContent = ''; }
    catch (e) { $('leak-status').textContent = 'Could not save in this browser; entries last for this tab only.'; }
  }

  function fillSelect(id, options) {
    var sel = $(id);
    var blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Choose...';
    sel.appendChild(blank);
    options.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o[0];
      opt.textContent = o[1];
      sel.appendChild(opt);
    });
  }

  function localNowForInput() {
    var d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  function renderActions() {
    var box = $('leak-actions');
    LeakLog.ACTIONS.forEach(function (a) {
      var label = document.createElement('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = a[0];
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + a[1]));
      var wrap = document.createElement('div');
      wrap.appendChild(label);
      box.appendChild(wrap);
    });
  }

  function renderTable() {
    var wrap = $('leak-table-wrap');
    wrap.textContent = '';
    if (!entries.length) {
      var p = document.createElement('p');
      p.className = 'small';
      p.textContent = 'No entries yet.';
      wrap.appendChild(p);
      return;
    }
    var table = document.createElement('table');
    table.className = 'leak-table';
    var head = document.createElement('tr');
    LeakLog.COLUMNS.forEach(function (c) {
      var th = document.createElement('th');
      th.scope = 'col';
      th.textContent = c[1];
      head.appendChild(th);
    });
    table.appendChild(head);
    LeakLog.reportRows(entries).forEach(function (row) {
      var tr = document.createElement('tr');
      LeakLog.COLUMNS.forEach(function (c) {
        var td = document.createElement('td');
        td.textContent = row[c[0]];
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    wrap.appendChild(table);
  }

  function readForm() {
    var actions = [];
    $('leak-actions').querySelectorAll('input[type=checkbox]').forEach(function (cb) {
      if (cb.checked) actions.push(cb.value);
    });
    var whenValue = $('leak-when').value;
    return {
      when: whenValue ? new Date(whenValue).toISOString() : '',
      kind: $('leak-kind').value,
      how: $('leak-how').value,
      where: $('leak-where').value,
      found: $('leak-found').value,
      reachable: $('leak-reachable').value,
      actions: actions,
      notes: $('leak-notes').value
    };
  }

  function resetForm() {
    $('leak-form').reset();
    $('leak-when').value = localNowForInput();
  }

  $('leak-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var result = LeakLog.createEntry(readForm(), window.PDK.getRules(), entries);
    var errBox = $('leak-errors');
    if (!result.ok) {
      var msg = result.errors.join(' ');
      if (result.blocked.length) {
        msg += ' Looks like: ' + result.blocked.map(function (b) { return b.label + ' (' + b.severity + ')'; }).join(', ') + '.';
      }
      errBox.textContent = msg;
      return;
    }
    errBox.textContent = '';
    entries.push(result.entry);
    save();
    renderTable();
    resetForm();
    $('leak-status').textContent = 'Saved ' + result.entry.id + '.';
  });

  $('leak-export').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(LeakLog.exportReport(entries, new Date()), null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'leak-report.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('leak-print').addEventListener('click', function () { window.print(); });

  $('leak-clear').addEventListener('click', function () {
    var btn = $('leak-clear');
    if (!confirmingClear) {
      confirmingClear = true;
      btn.textContent = 'Click again to confirm clearing all entries';
      return;
    }
    confirmingClear = false;
    btn.textContent = 'Clear all entries';
    entries = [];
    save();
    renderTable();
    $('leak-status').textContent = 'All entries cleared.';
  });

  fillSelect('leak-kind', LeakLog.DATA_KINDS);
  fillSelect('leak-how', LeakLog.HOW);
  fillSelect('leak-where', LeakLog.WHERE);
  fillSelect('leak-found', LeakLog.FOUND);
  fillSelect('leak-reachable', LeakLog.REACHABLE);
  renderActions();
  $('leak-when').value = localNowForInput();
  renderTable();
})();
```

- [ ] **Step 8: Update the build script**

In `build.cjs`, in the `parts` object, add two entries so it reads:
```js
const parts = {
  RULES: JSON.stringify(JSON.parse(read('rules.json'))).replace(/</g, '\\u003c'),
  DETECT: read('src/detect.js'),
  TREE: read('src/tree.js'),
  LEAKLOG: read('src/leaklog.js'),
  APP: read('src/app.js'),
  LEAKUI: read('src/leaklog-ui.js')
};
```

- [ ] **Step 9: Add static checks**

In `tests/run-checks.cjs`, inside the `if (fs.existsSync(builtPath)) {` block, after the `advisory` check, add:
```js
  check('index.html has the leak log tab', /Leak log/.test(html) && /id="panel-leak"/.test(html));
  check('leak log tells users to describe, not paste', /Describe, do not paste/.test(html));
  check('leak log says it is not legal or compliance advice', /record, not legal or compliance advice/.test(html));
  check('leak log script is inlined', /const LeakLog =/.test(html) && /pdk\.leaklog\.v1/.test(html));
```

- [ ] **Step 10: Build and run every check**

Run: `npm run build && npm run check && npm test`
Expected: build succeeds, all checks PASS (including the four new ones and every existing static offline check), all unit tests pass. You cannot test the page in a browser; say so in your report.

- [ ] **Step 11: Commit**

```bash
git add protect-data-kit/src protect-data-kit/build.cjs protect-data-kit/index.html protect-data-kit/tests
git commit -m "feat: leak log sheet with safe-to-save check and exportable report" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs, facilitator script, and manual verification

**Files:**
- Create: `README.md`, `FACILITATOR.md`

**Interfaces:**
- Consumes: the built `index.html`, `synthetic/` files, `tests/fixtures/false-negative-prose.txt`.
- Produces: the documents the team uses on the day.

- [ ] **Step 1: Write `README.md`**

```markdown
# Protect-Data Kit

Offline tools for thinking about protecting proprietary scientific data when using AI tools:
a paste-checker, a decision tree, and synthetic datasets to practice with.

## Use it

Open `index.html` in a browser (double-click it, or open it from a USB stick or shared drive).
It runs entirely in the page. Nothing you paste is sent anywhere.

The paste-checker is advisory. It flags likely matches; it cannot stop you pasting elsewhere and
does not guarantee that text is safe. The decision tree is guidance, not legal or compliance advice.

## Rebuild and test (team only)

Requires Node 18 or newer. No packages to install.

    npm run build        # regenerate index.html from src/ and rules.json
    npm test             # unit tests
    npm run check        # fixtures + offline static checks
    npm run synthetic    # regenerate synthetic/ (deterministic)

Edit `rules.json` (detectors) or `src/*`, never `index.html` directly.
```

- [ ] **Step 2: Write `FACILITATOR.md`**

```markdown
# Facilitator script (about 5 minutes)

Open `index.html` from disk before the session. Use only the synthetic files.

1. **A flagged example (2 min).** Paste `synthetic/trial_sites.md`. Point out the verdict ("Stop"),
   the highlights, and the findings list. Click "Copy redacted text" and show the placeholders.
   Say: the original text was never changed.
2. **Add a watchlist term (1 min).** Open "Your watchlist", add `Harborview | site`, and watch the
   site name become a watchlist match.
3. **The false negative (1 min).** Paste the text from `tests/fixtures/false-negative-prose.txt`.
   The verdict says "Clear". Say: "Clear means no matches found. It does not mean safe. This sentence
   describes unpublished results, and a pattern checker cannot know that."
4. **The decision tree (1 min).** Walk "Unpublished research or IP" -> "No" -> "Claude.ai chat" ->
   "Don't know". Land on "Only in an approved environment". Note that "Don't know" never counts as yes.

5. **The leak log (1 min).** Open the Leak log tab and record an example using only descriptions. Try pasting a sequence into Notes and show that the save is refused. Say: if something does leak, this is where we record how it happened.

Reminders for the room: the checker is advisory and cannot stop you pasting elsewhere; it does not
read images, PDFs or attachments; the tree is guidance, not legal or compliance advice.
```

- [ ] **Step 3: Run the full automated verification**

Run: `npm run build && npm test && npm run check`
Expected: build succeeds, all tests PASS, "All checks passed."

- [ ] **Step 4: Manual verification in a browser (offline)**

Open `index.html` with `file://` and turn off the network (Wi-Fi off or DevTools Network "Offline"). Confirm each item and record any failure:
1. DevTools Network tab shows zero requests after load and while using every feature.
2. Pasting `synthetic/sequences.fasta`, `synthetic/compounds.smi`, `synthetic/assay_results.csv` and `synthetic/trial_sites.md` each gives a highlight, a findings list and a redacted copy with typed placeholders.
3. Pasting `tests/fixtures/public-text.txt` gives "Clear" and the wording "This is not a guarantee ...".
4. Adding `Harborview | site` to the watchlist flags it, survives a page reload, and "Reset to defaults" removes it.
5. "Export rules" downloads a file; editing it and using "Import rules" changes the watchlist.
6. "Copy redacted text" puts the redacted text on the clipboard.
7. The decision tree reaches each of the four outcomes, each shows the guidance-not-legal-advice line, and "Start over" works.
8. Keyboard only: Tab reaches every control, and the focus ring is visible.
9. Leak log tab: saving an entry with only descriptions works and appears in the table; an entry whose notes contain a pasted sequence or an email is refused without echoing it; entries survive a reload; "Export JSON" downloads a `leak-report` file; "Print report" shows only the table; "Clear all entries" needs a second click.

- [ ] **Step 5: Commit (only if `git init` has been run)**

```bash
git add README.md FACILITATOR.md
git commit -m "docs: README and facilitator script" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage**
- Paste-checker detectors (sequence, SMILES/InChI, assay values, internal IDs, watchlist, PHI, secrets): Tasks 1-3.
- Highlights, severity counts, Clear/Review/Stop, "Clear = no matches found", typed redaction, original unaltered, copy button, localStorage plus export/import in `rules.json` format, blind-spots list, advisory statement: Tasks 1 and 6.
- Decision tree (four questions, conditional questions, four outcomes, "Don't know" never yes, disclaimer, no named regulations): Task 4 and the UI in Task 6.
- Synthetic datasets (four files plus README, SYNTHETIC header, `SYN-` prefix, seeded): Task 5.
- File layout, embedded `rules.json` at build time, imported rules override the embedded copy: Tasks 1, 6.
- Testing (positive and negative cases per detector, synthetic files as positives, public text as zero-flag, headless `run-checks`, offline manual check): Tasks 2-3, 5-7.
- Delivery (facilitator walk-through of one flagged example and one false negative): Task 8.
- Leak log sheet (added after the spec was approved, at the user's request, design approved in session): Task 7.

**Additions beyond the spec (flag for the user):** the leak log sheet (Task 7); `build.cjs`, `package.json`, `tools/generate-synthetic.cjs`, `README.md`, `FACILITATOR.md`, and a `false-negative-prose.txt` fixture. They are needed to meet the spec's "built / seeded / walk-through" requirements.

**Decisions the spec left open:** verdict mapping (any High → Stop; Medium or Watchlist only → Review); a watchlist match alone gives Review, not Stop; the tree outcome table in `src/tree.js`.

**Placeholder scan:** none. Every code step contains full code.

**Type consistency:** `Detect.scan/redact/normalizeRules`, `Match` fields, detector ids, `Tree.nextQuestion/outcome`, and answer values are used identically in Tasks 1-6.
