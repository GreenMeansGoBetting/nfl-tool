---
paths:
  - "nfl_tool/site/style.css"
  - "nfl_tool/site/common.js"
  - "nfl_tool/site/teams.js"
---
# The site's look, phone layout and summary cards

Stories behind these rules: `docs/history.md`, "Styles".

## One look across the whole site (the summary-card look)

It lives in the "Facelift v2" block of `style.css`. New UI should reuse these patterns rather
than add a new look.

- Every `.data-table` is rounded tiles with 3px gaps, not hairline grid lines.
- Colored values are shaded boxes (tint plus a matching 1px edge) in the bold display font.
- Headers are small uppercase muted labels.
- Team banners are team-color tints with a 4px team-color left edge (`teamBannerHeader`).
- Rush lanes are big tiles like the pass zones.
- Pick Tracker buttons match the Summary card's My Picks strip.
- Tier cells are **filled** (tint plus a soft edge), never outline-only, in both themes.
- Group headers inside tables (Production, Turnovers & Pressure, Run Defense, Team Grades...) are
  solid bars with an accent left edge and a small gap above (`group-gap` spacer rows).
- Schedule strip (top of every page): finished games show each team's score under its logo
  (winner bold), not the date.
- Every color comes from the theme tokens at the top of style.css so dark and light both hold.
- `teams.js`: team names, colors and logo URLs.

## Phone layout

- style.css has four `@media (max-width: 760px)` blocks: two small early ones (`.two-col`,
  `.box-score-grid`), the main phone block, and a last one at the very end of the file.
  **Put new phone-only rules in the last block** so they win over everything above and desktop
  stays pixel-identical.
- Nothing is hidden on phones: wide sections scroll sideways inside their own box with the first
  (name) column pinned, side-by-side columns stack, Target Zones cards go two across, and the tab
  menu tightens (edge fade under 380px).
- New wide tables/grids should live inside `.stat-columns > section` (or get
  `min-width: 0; overflow-x: auto` in a phone block) so they don't widen the page on phones.
- Phones also get: `html, body { overflow-x: clip }`; a compact topbar (acct name hidden, Update
  Odds icon-only), since the live logged-in topbar is wider than the local copy's; and
  `wrapWideTablesForPhone` (common.js), which wraps any table wider than its box in `.m-scroll` so
  only that table scrolls, not its whole section.
- Test phone layout with the acct chip and `is-owner` class added, or the topbar overflow won't
  show up locally.

## Summary cards (shared helpers in common.js)

- Summary cards are 1160×980. `fitSummaryCard()` scales the content down if it overflows, and a
  scale near 1 is the goal.
- The cards are fixed 1160px images; on phones `zoomSummaryCardForPhone` (same 760px breakpoint)
  shrinks the card to fit, and `saveSummaryImage` lifts the zoom while capturing, so saved PNGs
  are identical on every device.
- Save image uses html-to-image with `includeQueryParams: true`. Without it, ESPN logo URLs that
  differ only by query string collapse to one image. Fonts are inlined by `summaryFontCSS`.
- **Hide the picks column on any Summary card:** a toolbar button `#summary-rail-btn` ("Hide Prop
  Picks" / "Hide My Picks" / "Hide TD Odds") drops the right rail; the card gets `.sc-no-rail`,
  and `fitWideSummaryCard` zooms `.sc-main` to the biggest size that still fits (max
  `SUMMARY_WIDE_ZOOM_MAX` 1.6), then the usual shrink-only fit. html-to-image keeps the zoom, so
  saved images come out big too. Per-device view pref per card (`SUMMARY_RAIL_KEYS`), not synced.
  On Game Previews the picks are a bottom strip, so the button just hides that strip.
- The Props card has spare height so it grows a lot; the Game and TD cards are already
  height-bound, so making them bigger needs less content or a different layout.
- `fitWideSummaryCard` backs off when a label would be cut: its "squeezed" check watches specific
  selectors, so add a new card's label classes to it (`.g2-proof-label`, `.g2-key-title`,
  `.g2-line-big`, `.tdt-head`, `.tdt-v`, `.tgt-v` are already there).
