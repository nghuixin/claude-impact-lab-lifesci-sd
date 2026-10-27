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
