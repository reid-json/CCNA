# PacketPath — CCNA Study Site

A small, dependency-free study site for the Cisco CCNA 200-301. Progress and settings are saved in the browser.

- **Overview** (`index.html`): learning path, flashcards, quick quiz, stats
- **Study** (`study.html`): pick an exam domain; quick lesson on the left, question on the right, explanation whether you're right or wrong
- **Practice exam** (`exam.html`): 20, 30 or all 48 questions weighted by domain, with a switch to show answers as you go or hide them until the end, flagging, a timer, and a review
- Dark mode on every page (toggle in the header, remembered)

## Run it

Open `index.html` in a browser. No build step.

## Edit it

- Domains, questions, explanations and quick lessons: `data.js` (one place, used by every page)
- Flashcards: `script.js`
- Look and feel: `theme.css` (colors, dark mode), `pages.css` (study/exam pages), `styles.css` (home page)

## Where it's hosted

A copy lives in the portfolio repo at `public/apps/ccna/` and is served at <https://reid-json.net/apps/ccna/index.html>.
After changing files here, copy all `*.html`, `*.css` and `*.js` files into that folder in the [Portfolio](https://github.com/reid-json/Portfolio) repo and push.
