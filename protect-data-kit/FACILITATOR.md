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
