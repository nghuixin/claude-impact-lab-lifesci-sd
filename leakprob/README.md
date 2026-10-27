# leakprobe

**Measure how much of your proprietary scientific knowledge an AI model appears to have absorbed — as a score from 0 to 100%.**

Preventive tools such as a paste-checker stop obvious leaks before data is sent. `leakprobe` is the complement: an independent check, run from the outside, of what models have *already* picked up from the queries your organization sent them.

## How it works

1. **Condense.** Read every query your organization sent to AI models (an export from your AI gateway, proxy or chat logs) and distill them into facts: *subject → relation → value*. For example: `SYN-0042 → IC50 against TGT-B → 12.4 nM`. Repeats are merged.
2. **Sharpen.** Keep only facts so specific that no model could have known them before: internal IDs, exact values, sequences, program code names. Facts that appear in public text you supply (papers, patents, press releases) are dropped. Optionally, a *reference model* trained before the queries were made is asked too, and anything it already knows is dropped.
3. **Probe and score.** Ask each model about every sharp fact. Each fact is paired with a **decoy**: a fabricated fact of the same shape that was never shared anywhere. A model cannot know a decoy, so its decoy hit rate measures guessing and answer bias.

```
leak = (real hit rate − decoy hit rate) ÷ (1 − decoy hit rate)
```

Facts are weighted by sharpness, and a paired bootstrap over facts gives a 95% interval.

| Score | Verdict |
|---|---|
| < 10% | No detectable leak |
| 10–30% | Weak evidence of leak |
| 30–60% | Moderate evidence of leak |
| ≥ 60% | Strong evidence of leak |

## Quick start

Requires Python 3.9+. There are no dependencies.

```bash
pip install -e .            # or just run: python -m leakprobe ...
python demo/run_demo.py     # synthetic data, three simulated models
open demo/output/report.html
```

Demo output:

```
59 queries -> 55 sharp facts -> 212 probes (half are decoy controls)

Model                         Leak score    95% interval   Verdict
clean-model                         1.5%      0.0–7.6%   No detectable leak
partial-model                      18.4%      8.6–29.4%   Weak evidence of leak
leaky-model                        48.2%     34.5–61.6%   Moderate evidence of leak
```

The simulated models memorized 0%, 15% and 45% of the sharp facts. The scores recover those rates within their intervals.

## Using it on real models

```bash
export ANTHROPIC_API_KEY=...
leakprobe run queries.jsonl \
  --baseline public/*.txt \
  --model anthropic:<model-name> \
  --model openai:<model-name> \
  --out reports/2026-10
```

### Commands

- `leakprobe extract QUERIES [-o facts.json]` only condenses and sharpens, so you can review the facts first.
- `leakprobe run QUERIES --model SPEC ...` runs the whole pipeline and writes `facts.json`, `results.json` and `report.html`.

### Model specs

- `anthropic:MODEL` calls the Anthropic Messages API. It needs `ANTHROPIC_API_KEY`.
- `openai:MODEL` calls any OpenAI-compatible endpoint. It reads `OPENAI_API_KEY`, and `OPENAI_BASE_URL` for vLLM, Ollama or gateways.
- `mock:NAME:RATE` is a simulated model that memorized `RATE` of the facts. It is for demos and tests.

### Useful options

| Option | Meaning |
|---|---|
| `--probes open,completion,mc` | Probe types. The default is `open,completion`. See the privacy note on `mc` below. |
| `--repeats N` | Ask each probe N times. This is useful for models that sample with randomness. |
| `--reference-model SPEC` | Drop facts that a model trained before the queries already knows. |
| `--extractor-model SPEC` | Use a model you trust (ideally local) to also extract facts from free prose. |
| `--max-facts N` | Probe only the N sharpest facts. |
| `--show-values` | Print fact values in the HTML report. They are hidden by default. |
| `--fail-above PCT` | Exit with code 2 if any score exceeds PCT, for scheduled CI checks. |

### Query log formats

The query log can be in any of these formats:

- `.jsonl` with one record per line. The query text is read from the first of `query`, `prompt`, `text`, `content` or `input`, or from a chat-style `messages` list.
- `.json` holding a list of such records.
- `.txt` with one query per line.

## Privacy and limits — read before running on real data

- **Probing is itself a disclosure.** Open questions reveal the *subject* (for example, a compound ID) to the model provider, but not the value. Multiple-choice probes (`mc`) reveal candidate values, including the true one, so they are off by default. Run probes only through an API covered by zero-retention / no-training terms, or against local models.
- **Evidence, not proof.** A high score shows a model reproduces your specifics far better than chance. It does not prove *how* it learned them. Independent public disclosure or a model's own reasoning are possible explanations.
- **False negatives are possible.** A model can hold information it will not reproduce on request. A low score means "not detected", never "safe".
- **Extraction is domain-specific.** The built-in patterns cover compound and target IDs, assay and DMPK values, mechanisms, program leads and sequences. Unpublished findings written in plain prose need `--extractor-model`.
- **Reports contain proprietary data.** Treat `facts.json`, `results.json` and the reports as confidential.

## Project layout

```
leakprobe/
  condense.py   steps 1–2: load logs, extract and merge facts, sharpness weights
  probes.py     step 3a: probes and matched decoy controls
  models.py     mock, Anthropic and OpenAI-compatible backends (stdlib only)
  score.py      judging answers, leak score, bootstrap interval
  report.py     JSON and self-contained HTML report
  cli.py        command line
demo/           synthetic query log generator and end-to-end demo
tests/          unit and end-to-end tests:  python -m unittest discover -s tests
```

All demo data is synthetic. Compound IDs use the `SYN-` prefix and targets the `TGT-` prefix.
