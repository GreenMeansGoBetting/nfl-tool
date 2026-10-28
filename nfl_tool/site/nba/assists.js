// GMG NBA Suite: Assists. The game sim's page (sim-board.js, loaded after
// this): every game played 10,000 times, each assisted make to a teammate on
// the floor by his assists a minute, tonight's plays against every
// book's ladder (nfl_tool/nba/sim.py, 2026-10-28). Best Plays loads this too (points.js).

var SIM_MARKETS = window.SIM_MARKETS || {};
SIM_MARKETS.assists = {
  market: "assists",
  stat: "ast",
  unit: "Assists",
  short: "AST",
  rungs: [2, 4, 6, 8, 10, 12],
  ytd: { key: "nba-sim-assists", label: "Assists Plays" },
};
var SIM_PAGE = SIM_MARKETS.assists;
