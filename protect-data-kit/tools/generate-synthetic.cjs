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
