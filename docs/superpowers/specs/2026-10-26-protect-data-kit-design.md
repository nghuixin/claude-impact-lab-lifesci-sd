# Protect-Data Kit: Event-Day Design

Date: 2026-10-26
Status: Draft for user review
Sub-project: 1 of a larger effort (see "Roadmap")

## Problem

Life sciences participants at the Oct 26 session need practical help with one question: how do we protect proprietary scientific data when using Claude? The full answer has several parts (enforcement on Claude Code, an API proxy, transcript audit, guidance for Claude.ai chat). This sub-project covers the pieces participants use during the session itself.

## Roadmap

Decided build order is event-day first:

1. **Event-day kit (this spec):** paste-checker, decision tree, synthetic datasets, leak log sheet.
2. Claude Code adapter: `UserPromptSubmit` and `PreToolUse` hooks, deny rules for confidential paths.
3. Audit: scan Claude Code transcripts and proxy logs after the fact and report. Detects exposure; cannot undo it. It also emits leak reports in the `leak-report` v1 shape defined by the leak log sheet (how it leaked, where it went, how it was found), so manual and automatic reports match.
4. API adapter: local proxy that scans outgoing requests. Claude Code can also point at it via `ANTHROPIC_BASE_URL`.

Later sub-projects reuse `rules.json` from this one. Each gets its own spec and plan.

## Scope

In scope: four standalone, offline pieces delivered as local files. No backend, no network calls, no analytics, no hosting.

Out of scope: enforcement tooling (roadmap items 2-4), compliance or legal claims, statements about Anthropic data handling or plan terms, detection in images/PDFs/attachments, a local LLM classifier.

## Components

### 1. Paste-checker (`index.html`, tab 1)

Participant pastes text. The page highlights likely proprietary content, explains each match, and offers a redacted copy. It never uploads anything. It is advisory: it cannot stop pasting elsewhere, and the page states this.

**Detectors.** Each rule has an id, label, pattern or function, severity, and a one-line reason shown beside the highlight.

| Detector | Catches | Severity | Notes |
|---|---|---|---|
| Nucleotide/protein sequence | Long runs of ACGTU or amino-acid letters, FASTA or raw | High | Minimum length about 20 residues to avoid flagging ordinary words |
| SMILES / InChI | Chemical structure strings | High | Heuristic: requires ring/bond characters and a minimum length |
| Assay/result values | IC50, EC50, Ki, Kd, % inhibition, p-values, numeric tables with units | Medium | Flags the pattern, not every number |
| Internal ID formats | Participant-defined patterns, e.g. `ABC-12345` | Medium | Empty until the participant adds a format |
| Watchlist terms | Codenames, targets, programs, site or partner names | Watchlist | Case-insensitive, whole-word, editable |
| PHI/PII | Names with dates, MRNs, DOBs, SSNs, emails, phone numbers | High | Own tier; different obligation |
| Secrets | API keys, tokens | High | Common real mistake |

**Behavior.**
- Inline highlights plus counts by severity.
- Overall verdict: **Clear / Review / Stop**. "Clear" means "no matches found", never "safe".
- **Redact** replaces each match with a typed placeholder (`[SEQUENCE]`, `[WATCHLIST:program]`). Redacted text appears in a separate box with a copy button. The original is never altered.
- Watchlist and ID formats persist only in browser local storage on that machine. Export/import as JSON using the `rules.json` format.
- A visible "known blind spots" list: unpublished results in prose, images/screenshots, attachments, anything not on the watchlist.

### 2. Decision tree (`index.html`, tab 2)

At most four questions, one at a time:

1. **What is it?** Public/published; internal but not sensitive; unpublished research or IP; patient or participant data; credentials.
2. **Is it de-identified or abstracted?** (patient data and IP only) Yes, fully / Partly / No.
3. **Where is it going?** Claude.ai chat / Claude Code on my machine / App calling the API / Third-party tool or vendor / Not sure.
4. **Is there an agreement in place?** (IP and patient data only) Yes, my organization approved this tool for this data / No / Don't know.

**Outcomes**, each one sentence plus a next step:
- **OK as is:** public or non-sensitive content.
- **OK after redacting:** use the paste-checker, then re-run the tree on the redacted text.
- **Only in an approved environment:** needs an environment your organization has cleared; ask your security or compliance contact.
- **Don't share:** credentials, or patient data with no agreement. Rotate any credential already pasted.

"Don't know" about an agreement is never treated as yes; it routes to "Only in an approved environment". Every outcome carries a line that this is guidance, not legal or compliance advice. Wording stays generic: no named regulations or plan terms.

### 3. Synthetic datasets (`synthetic/`)

- `assay_results.csv`: about 20 rows of fake compound IDs, targets, IC50 values.
- `sequences.fasta`: random plausible-looking nucleotide and protein sequences.
- `compounds.smi`: made-up SMILES.
- `trial_sites.md`: fake sites and coordinators, with fake PHI-shaped fields to trigger the PHI detector.
- `README.md`: how to use the files in a Claude session, with sample prompts (e.g. "summarize this assay table").

Safeguards: every file starts with a "SYNTHETIC, not real data" header; compound IDs use the `SYN-` prefix; everything is generated from random seeds, never adapted from a real or published sequence, structure or study.

### 4. Leak log sheet (`index.html`, tab 3)

Added after the first approval, at the user's request: if any data is leaked, record it and how it was leaked.

**Principle:** the log never stores the leaked data itself, only descriptions. A log that held the sensitive content would be a second leak.

**Fields** (one entry per incident): when (auto-filled, editable); what kind of data (IP, patient or participant data, credentials, internal, other); how it leaked (pasted into a chat or prompt, uploaded a file, shared a link, sent a screenshot, a tool read it from a prompt/file/folder, sent through an app or API, other); where it went (the decision tree's destinations); how it was found (paste-checker, self, colleague, later audit); still reachable (yes, no, don't know); actions taken (deleted the conversation or file, rotated the credential, told the security or compliance contact, other); notes (free text, 500 characters).

**Safeguards:** the notes field says "Describe, do not paste", and notes are run through the same detectors before saving. A match blocks the save and shows what kind of content it looks like, without echoing the matched text. No names of individuals are requested (roles are fine). Entries live only in browser local storage and are sent nowhere.

**Outputs:** JSON export in a documented `leak-report` v1 shape (`{ format, version, generated, entries }`), and a printable report table. Out of scope: automatic detection of leaks (that is the later audit sub-project), severity scoring, and any statement about legal notification duties. The page says it is a record, not legal or compliance advice.

## File layout

```
protect-data-kit/
  index.html            paste-checker + decision tree + leak log (tabs, single file, no dependencies)
  rules.json            detector rules and defaults (format reused by later tools)
  synthetic/            four data files + README.md
  tests/
    fixtures/           positive (synthetic files) and negative (public text) cases
    run-checks          headless run of all detectors against the fixtures
```

`index.html` embeds a copy of `rules.json` at build time so it works from disk. An imported rules file overrides the embedded copy.

## Delivery

Participants open `index.html` locally (zip, shared drive, or USB). Nothing is hosted. No participant data is collected. Participants use only the synthetic files, never their own data, when trying the files in a Claude session. The facilitator walks through one flagged example and one false negative (unpublished results in prose that the checker misses), to teach the limits.

## Testing

- Each detector has positive and negative cases in the fixtures.
- Synthetic datasets are the positive inputs and must trigger flags.
- A set of plain public text must produce zero flags.
- `run-checks` runs headlessly over all fixtures before the event and fails on any mismatch.
- Manual check: open `index.html` from disk with the network disabled and confirm every feature works and no requests are made.

## Risks and limits

- The leak log depends on people choosing to record incidents; it is a record, not a detector. Notes are checked by the same pattern detectors, so unlisted sensitive content in prose can still be typed into it.

- Pattern detection misses what it was not told about; the page says so.
- SMILES and short sequences will produce false positives and false negatives; severity labels and the "Review" verdict are meant to keep a human in the loop.
- The paste-checker is advisory and cannot enforce anything on Claude.ai chat.

## Decisions on record

- Detection is watchlist plus patterns, all local. Using Claude to classify before sending is rejected for the pre-send path because the check itself would send the data out.
- Workspace is not a git repo, so this spec is saved but not committed.
