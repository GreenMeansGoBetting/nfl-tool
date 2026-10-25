// GMG NBA Suite: Points. The game sim's page (sim-board.js, loaded after
// this): every game played 10,000 times, each player's points in all of them,
// tonight's plays against every book's ladder (nfl_tool/nba/sim.py, 2026-10-24).
// Best Plays loads this too (its Points rows), so the config sits in
// SIM_MARKETS and SIM_PAGE is a `var` the next file may set again.

var SIM_MARKETS = window.SIM_MARKETS || {};
SIM_MARKETS.points = {
  market: "points",
  stat: "pts",
  unit: "Points",
  short: "PTS",
  rungs: [10, 15, 20, 25, 30, 35, 40],
  ytd: { key: "nba-sim-points", label: "Points Plays" },
};
var SIM_PAGE = SIM_MARKETS.points;
