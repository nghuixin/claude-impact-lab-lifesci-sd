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
