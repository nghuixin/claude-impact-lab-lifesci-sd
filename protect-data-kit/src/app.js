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
  window.PDK = { getRules: function () { return rules; } };
  var baseRules = Detect.normalizeRules(embedded).rules;

  // #status is only for save, import, reset and export messages (inside <details>).
  // Scan errors go to #scan-errors, which is never touched here.
  function setStatus(msg) { $('status').textContent = msg; }

  function saveRules() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(Detect.storableRules(rules, baseRules)));
      setStatus('');
      return true;
    } catch (e) {
      setStatus('Could not save in this browser; your changes last for this tab only.');
      return false;
    }
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
  var CLEAR_WITH_ERRORS = 'Clear: no matches found, but some rules did not run (see below). This is not a guarantee that the text is safe to share.';

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
      $('scan-errors').textContent = '';
      $('counts').textContent = '';
      $('highlight').textContent = '';
      $('findings').textContent = '';
      $('redacted').value = '';
      return;
    }
    var r = Detect.scan(text, rules);
    var hasErrors = r.errors.length > 0;
    $('verdict').className = r.verdict;
    $('verdict').textContent = (r.verdict === 'Clear' && hasErrors) ? CLEAR_WITH_ERRORS : VERDICT_TEXT[r.verdict];
    $('scan-errors').textContent = hasErrors
      ? 'Some rules did not run, so this result may be incomplete: ' + r.errors.join(' | ')
      : '';
    $('counts').textContent = 'High: ' + r.counts.High + '   Medium: ' + r.counts.Medium + '   Watchlist: ' + r.counts.Watchlist;
    renderHighlights($('highlight'), text, r.matches);
    renderFindings($('findings'), r.matches);
    $('redacted').value = Detect.redact(text, r.matches);
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
        var saved = saveRules(); syncInputs(); run();
        setStatus(saved
          ? 'Imported ' + file.name + '.'
          : 'Imported ' + file.name + ' for this tab only; it could not be saved in this browser.');
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
    ['check', 'tree', 'leak'].forEach(function (t) {
      var selected = t === which;
      $('tab-' + t).setAttribute('aria-selected', String(selected));
      $('panel-' + t).hidden = !selected;
    });
  }
  $('tab-check').addEventListener('click', function () { showTab('check'); });
  $('tab-tree').addEventListener('click', function () { showTab('tree'); });
  $('tab-leak').addEventListener('click', function () { showTab('leak'); });

  // ---- decision tree
  var answers = {};

  // moveFocus is true only after a user action (answer or Start over); the page
  // load render and tab switching must not steal focus.
  function renderTree(moveFocus) {
    var body = $('tree-body');
    body.textContent = '';
    var q = Tree.nextQuestion(answers);
    var target = null;

    if (q) {
      var h = document.createElement('h2');
      h.textContent = Tree.QUESTIONS[q].text;
      h.tabIndex = -1;
      target = h;
      body.appendChild(h);
      var wrap = document.createElement('div');
      wrap.className = 'opts';
      Tree.QUESTIONS[q].options.forEach(function (opt) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = opt[1];
        b.addEventListener('click', function () { answers[q] = opt[0]; renderTree(true); });
        wrap.appendChild(b);
      });
      body.appendChild(wrap);
    } else {
      var o = Tree.OUTCOMES[Tree.outcome(answers)];
      var card = document.createElement('div');
      card.className = 'card';
      card.tabIndex = -1;
      target = card;
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
      rb.addEventListener('click', function () { answers = {}; renderTree(true); });
      restart.appendChild(rb);
      body.appendChild(restart);
    }

    if (moveFocus && target) target.focus();
  }

  syncInputs();
  renderTree();
})();
