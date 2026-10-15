---
paths:
  - "nfl_tool/site/style.css"
  - "nfl_tool/site/common.js"
  - "nfl_tool/site/teams.js"
  - "nfl_tool/site/sync.js"
  - "nfl_tool/site/book-odds.js"
---
# The site's look, phone layout and summary cards

Stories behind these rules: `docs/history.md`, "Styles".

## One font: Sofia Sans (2026-10-15)

- **Every word and number on every sport's pages is Sofia Sans** (the owner: "the new font style
  moving forward for both letters and numbers"). `--font-body` = Sofia Sans Semi Condensed,
  `--font-display` = Sofia Sans Condensed (style.css tokens). Never name a font family in a rule:
  use `var(--font-body)` / `var(--font-display)`. The login page (`page()` in _middleware.js)
  names it directly.
- **Never a second font for numbers.** A digits-only Inter was tried first and the owner hated
  the mismatch between letters and numbers.
- Each page's Google Fonts link loads 400-700 only (Support adds 900 for the hub's Black look).
  The old 800 weight made condensed text look "mushed"; rules asking for 800 draw at 700.
- Tables line digits up in columns (`table { font-variant-numeric: tabular-nums }`).
- Save image embeds the fonts from that same link (`summaryFontCSS`, NHL `embeddedFontCSS`), so a
  new font only needs the link and the tokens.

## Member Settings: the gear (sync.js, 2026-10-15)

- A gear just left of the account chip on every page (local testing: the gear alone) opens
  Settings: **Odds format** (American default, Decimal, Percent), **Colors** (Green / Red =
  the site's own, Blue / Orange for red-green color blindness, Blue / Red, Teal / Pink, Pick my
  own: good / middle / bad pickers) and **My Books** (moved here from the account chip and its
  own popup; "Edit my books" in a price list opens this). Saved in `nfl-tool.settings.v1`
  (synced; My Books keeps `nfl-tool.my-books.v1`). Book changes redraw price lists at once; odds
  and colors reload the page when the window closes (a synced change from another device
  reloads once too).
- **Every price shown goes through `showOdds(n)`** (n = American, number or "+150" text):
  `boOdds`, NHL `odds`, NBA `odds`, Icebreaker `american` and the NFL display spots call it.
  `fmtOddsSigned` / `fmtOdds` stay American because their text is SAVED (Possible Plays `odds`,
  parsed for units); a saved play is converted only where it is shown. A new place that shows a
  price must use `showOdds`.
- **Every red-to-green shade goes through `scaleHsla(hue, s, l, a)`** (hue 0 red, 60 yellow,
  120+ green) or the tier tokens. With the standard set it returns the same `hsla()` text as
  before (pixel-identical); another set mixes its bad / middle / good colors and a style tag
  (`#gmg-color-set`) repaints `--good/--mid/--bad` (+ `-rgb`, `-text`) for both themes. The
  middle stays the site's yellow in every preset: a gray middle made the "check" highlights look
  dead. The brand accent green never changes.
- Never mention a state for bet links (the owner: the "Links open for New Jersey" note confused
  members, and the links opened fine in their own state).
- Tests: `tests/test_settings_site.py`.

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

## One stylesheet per sport (2026-10-13)

- `style.css`: the tokens, the site-wide look and every NFL page. It holds no `.nba-*`, `.nhl-*`,
  `.shots-*` or `.crease-*` rule (a test fails if one comes back).
- `suite.css`: the layout the NBA and NHL pages share (`.nba-*`: the owner-only guard, boxes,
  tiles, banners). Loaded after style.css by every NBA and NHL page, never by an NFL page.
- `nhl/nhl.css`: everything hockey-only, loaded last by the NHL pages. Each has its own phone
  block at its end.
- Why: the deploy tests only the sport a push is about, and a hockey style in the shared file
  made every hockey change count as "everything". A new sport or suite page gets its own file.
- The move was checked by comparing every element's computed style on every NBA and NHL page,
  desktop and phone, against the old single file: no differences. Later files win ties, so one
  phone rule had to be restated in nhl.css (`.shots-allows`, four tiles across).

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
- **Two safeguards keep cards readable** (added 2026-10-11 after `tools/check_site.py` found TD
  cards with spilling labels and one shrunk to 0.85):
  - `fitWideSummaryCard` backs off its zoom when anything is squeezed. Besides a hand-kept list
    of selectors, it watches **every one-line text label that fits at normal size**, so growing a
    card can never make a label spill out of its box, whatever class it has.
  - `fitSummaryCard` adds `.sc-tight` to a card that would otherwise be shrunk below
    `SUMMARY_TIGHT_BELOW` (0.92): padding and gaps are trimmed first (rules per card in style.css,
    `.td-card.sc-tight ...`, `.gs-card.sc-tight ...`), then it shrinks only as far as still
    needed. Nothing is hidden. A new card type should define its own `.sc-tight` rules.
- The check flags a card scaled below 0.85 and any cut-off text; run it after changing a card.
