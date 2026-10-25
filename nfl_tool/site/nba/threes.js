// GMG NBA Suite: Threes (threes made). The game sim's page (sim-board.js,
// loaded after this): every game played 10,000 times, each player's threes in
// all of them, tonight's plays against every book's ladder
// (nfl_tool/nba/sim.py, 2026-10-24). Best Plays loads this too (points.js).

var SIM_MARKETS = window.SIM_MARKETS || {};
SIM_MARKETS.threes = {
  market: "threes",
  stat: "fg3m",
  unit: "Threes",
  short: "3PM",
  rungs: [1, 2, 3, 4, 5, 6],
  ytd: { key: "nba-sim-threes", label: "Threes Plays" },
};
var SIM_PAGE = SIM_MARKETS.threes;
