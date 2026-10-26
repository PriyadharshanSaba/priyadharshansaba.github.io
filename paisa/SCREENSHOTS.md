# Screenshots for /paisa/

The page has four placeholder frames. Capture these, save them in `paisa/shots/`,
and replace each `<div class="placeholder">…</div>` in `paisa/index.html` with the
`<img>` line given below.

## Before you capture: hide your real numbers

Paisa shows real bank data. Turn on **Private mode** first (the eye in the header,
or Settings → Private mode): every amount becomes `₹****`, and people, payees and
account numbers become `****`. **Goal names stay visible in Private mode**, so
check you are fine showing the goals on screen, or rename them for the capture.
Also check the browser's address bar and status bar don't show anything private.

## Phone frames: 390 × 844 CSS px

Chrome DevTools → device toolbar → "iPhone 14" (390 × 844), or a real iPhone.
Capture at 2× or 3× (780 × 1688 or 1170 × 2532 px); the frame scales it down.
Export as `.webp` and keep each file under about 250 KB (the home-page thumbnails
are `.webp` too). Capture the top of the page; the frame crops from the top.

| # | Screen | Route | What should be in view | File |
|---|---|---|---|---|
| 1 | This month | `/` | Hero number against the monthly target and "Where it went" | `shots/month.webp` |
| 2 | Review | `/review` | At least one payment card with its tag chips (the "Teach it once" queue) | `shots/review.webp` |
| 3 | Worth | `/worth` | Hero total, the needs bar with its numbered legend, the roadmap below | `shots/worth.webp` |
| 4 | Goals | `/goals` | Two or three goal cards with their progress bars | `shots/goals.webp` |

## The `<img>` lines

```html
<img src="shots/month.webp" alt="This month: spending against the monthly target" width="390" height="844" loading="lazy" />
<img src="shots/review.webp" alt="Review: tagging a payment the app did not recognise" width="390" height="844" loading="lazy" />
<img src="shots/worth.webp" alt="Worth: what I have, what it is for, and when policies pay out" width="390" height="844" loading="lazy" />
<img src="shots/goals.webp" alt="Goals: savings goals with progress" width="390" height="844" loading="lazy" />
```

This file is under `/paisa/`, so GitHub Pages will serve it publicly. Delete it once
the screenshots are in.
