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
    if (a.agreement === 'dont_know') return 'approved_env';
    if (a.deid === 'fully' && TRUSTED_WHERE.indexOf(a.where) !== -1 && (a.agreement === 'yes' || a.agreement === 'no')) return 'ok_redact';
    return 'approved_env';
  }

  return { QUESTIONS: QUESTIONS, OUTCOMES: OUTCOMES, DISCLAIMER: DISCLAIMER, nextQuestion: nextQuestion, outcome: outcome };
})();

if (typeof module !== 'undefined') module.exports = Tree;
