<!-- SYNTHETIC, not real data -->
# Synthetic datasets

SYNTHETIC, not real data. Every value in these files is invented. Compound IDs use the `SYN-` prefix so they cannot be mistaken for real programs. Nothing here is adapted from a real or published sequence, structure or study.

## Files
- `assay_results.csv`: fake compounds, targets and IC50/Ki values.
- `sequences.fasta`: random nucleotide and protein sequences.
- `compounds.smi`: made-up structure strings.
- `trial_sites.md`: fake sites and participants with fake identifiers (to try the PHI checks).

## Try them in a Claude session
Use only these files, never your own data. Sample prompts:
- "Summarize the assay table and tell me which targets look most potent."
- "Group the compounds in compounds.smi by substituent pattern."
- "What fields in trial_sites.md would be identifying? How would you de-identify this file?"
- "Write a short README for the sequences in sequences.fasta."

Then paste a file into the paste-checker (`index.html`) to see what it flags and how redaction looks.
