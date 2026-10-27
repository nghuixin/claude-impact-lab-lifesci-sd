(function () {
  'use strict';

  var STORE_KEY = 'pdk.leaklog.v1';
  var $ = function (id) { return document.getElementById(id); };
  var loaded = load();
  var entries = loaded.entries;
  var skipped = loaded.dropped;
  var confirmingClear = false;

  function load() {
    try {
      return LeakLog.sanitizeEntries(JSON.parse(localStorage.getItem(STORE_KEY) || '[]'));
    } catch (e) { return { entries: [], dropped: 0 }; }
  }

  // Returns false when the browser refuses the write; callers report that to the user.
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(entries)); return true; }
    catch (e) { return false; }
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
    var errBox = $('leak-errors');
    var result;
    try {
      result = LeakLog.createEntry(readForm(), window.PDK.getRules(), entries);
    } catch (e) {
      errBox.textContent = 'The safety check could not run in this browser, so nothing was saved.';
      return;
    }
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
    var stored = save();
    renderTable();
    resetForm();
    $('leak-status').textContent = stored
      ? 'Saved ' + result.entry.id + '.'
      : 'Could not save in this browser. This entry exists only until you close or reload this tab, so export it now.';
  });

  $('leak-export').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(LeakLog.exportReport(entries, new Date()), null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    var url = URL.createObjectURL(blob);
    a.href = url;
    a.download = 'leak-report.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
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
    var cleared = save();
    renderTable();
    $('leak-status').textContent = cleared
      ? 'All entries cleared.'
      : 'Could not save the change in this browser; the entries come back on reload.';
  });

  fillSelect('leak-kind', LeakLog.DATA_KINDS);
  fillSelect('leak-how', LeakLog.HOW);
  fillSelect('leak-where', LeakLog.WHERE);
  fillSelect('leak-found', LeakLog.FOUND);
  fillSelect('leak-reachable', LeakLog.REACHABLE);
  renderActions();
  $('leak-when').value = localNowForInput();
  renderTable();
  if (skipped > 0) $('leak-status').textContent = 'Skipped ' + skipped + ' unreadable stored entries.';
})();
