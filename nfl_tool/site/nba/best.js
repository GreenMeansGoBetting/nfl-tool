// GMG NBA Suite: Best Plays (2026-10-25, the owner: "build a best plays page in
// the nba ... Keep the consistency present in those individual categories, but
// sort the best plays by edge, aggregating from these two categories"). Every
// Points, Threes, Rebounds and Assists play in one Player View list, biggest edge first, drawn by
// the same sim-board.js (loaded after this, after points.js, threes.js, rebounds.js and assists.js).
// A new market is its page's config added to `markets`.

var SIM_PAGE = {
  markets: [SIM_MARKETS.points, SIM_MARKETS.threes, SIM_MARKETS.rebounds, SIM_MARKETS.assists],
  ytd: { key: "nba-sim-best" },
};
