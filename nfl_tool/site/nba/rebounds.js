// GMG NBA Suite: Rebounds. The game sim's page (sim-board.js, loaded after
// this): every game played 10,000 times, each board to a player on the floor
// by his rebounds a minute x what tonight's other team gives up at his position, tonight's plays against every
// book's ladder (nfl_tool/nba/sim.py, 2026-10-28). Best Plays loads this too (points.js).

var SIM_MARKETS = window.SIM_MARKETS || {};
SIM_MARKETS.rebounds = {
  market: "rebounds",
  stat: "reb",
  unit: "Rebounds",
  short: "REB",
  rungs: [4, 6, 8, 10, 12, 14],
  ytd: { key: "nba-sim-rebounds", label: "Rebounds Plays" },
};
var SIM_PAGE = SIM_MARKETS.rebounds;
