<img src="assets/logo.svg" alt="Protect-Data Kit logo: a blue shield with a molecule ring and a check mark" width="96">

# Protect-Data Kit

Offline tools for thinking about protecting proprietary scientific data when using AI tools:
a paste-checker, a decision tree, and synthetic datasets to practice with.

## Use it

Open `index.html` in a browser (double-click it, or open it from a USB stick or shared drive).
It runs entirely in the page. Nothing you paste is sent anywhere.

The paste-checker is advisory. It flags likely matches; it cannot stop you pasting elsewhere and
does not guarantee that text is safe. The decision tree is guidance, not legal or compliance advice.
The Leak log tab records what leaked and how, as descriptions only; never paste the data itself there.

On a shared computer, click Reset to defaults and Clear all entries when you finish. The watchlist and the leak log are kept in the browser and outlive the session.

## Handing it out

Give participants `index.html`, `synthetic/` and `README.md`, plus `assets/` if you want the logo to show at the top of this file (the page itself does not need it) and `tests/fixtures/false-negative-prose.txt` if the facilitator runs step 3 live. Do not hand out `presentation/`, `.superpowers/`, `docs/`, `node_modules/` or `tests/`.

On the demo browser, click Reset to defaults and Clear all entries before the session.

## Rebuild and test (team only)

Requires Node 18 or newer. No packages to install.

    npm run build        # regenerate index.html from src/ and rules.json
    npm test             # unit tests
    npm run check        # fixtures + offline static checks
    npm run synthetic    # regenerate synthetic/ (deterministic)

Edit `rules.json` (detectors) or `src/*`, never `index.html` directly.
