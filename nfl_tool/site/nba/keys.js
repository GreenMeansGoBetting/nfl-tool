// ---- GMG NBA Suite: Matchup Keys ----
// What matters tonight, pulled out of the League Stats Chart's numbers (the
// owner, 2026-10-30: "HERES ALL THE DATA - then if you click the Matchup keys
// button - HERES WHAT MATTERS TONIGHT"). Every rule lives here, in one place,
// so nothing is counted twice or left out by a second copy; Matchup
// Breakdown's Biggest Edges is to read the same keys next.
//
// Every rule reads ranks of the teams with a number (1 = the most of it).
// An extreme = the top or bottom third (10 of 30). Two-team rules read BOTH
// sides (the site's matchup rule): an Edge needs one side clearly pointing
// one way and the other not pointing back.
//
// nbaMatchupKeys(table, away, home, top?) -> [{type, title, team, topic,
// tiles: [{team, key}], score, lead}], strongest first. `lead` = the
// strongest key of its topic (the cards shown first: one story a subject; the
// 2026-10-30 audit had 7-25 keys a game with the glass told three ways); the
// rest sit under More Keys, never dropped. `top` widens the cut (the audit
// lists near misses at 12).

const KEY_TYPES = {
  edge: "Edge",
  fits: "Fits",
  away: "Takes Away",
  style: "Same Style",
  clash: "Clash",
  trend: "Trend",
  volume: "Few Falling",
  untested: "Not Tested",
};
// [key, topic, both the most, both the least, opposite ends (null: an Edge already says it)]
const KEY_STYLE = [
  ["pace", "pace", "Both Play Fast", "Both Play Slow", "Fast Vs Slow"],
  ["total", "total", "Both Play High-Scoring Games", "Both Play Low-Scoring Games", "Game Totals: Opposite Ends"],
  ["o_rtg", "scoring", "Two Top Offenses", "Two Struggling Offenses", null],
  ["d_rtg", "scoring", "Two Leaky Defenses", "Two Top Defenses", null],
  ["o_3par", "threes", "Both Live Behind The Arc", "Both Avoid Threes", "Three-Point Volume: Opposite Ends"],
  ["o_ftr", "ft", "Both Get To The Line", "Neither Gets To The Line", "Free Throws: Opposite Ends"],
  ["o_paint_share", "paint", "Both Attack The Paint", "Both Stay Out Of The Paint", "Paint Volume: Opposite Ends"],
  ["o_mid_share", "mid", "Both Live In The Mid-Range", "Both Skip The Mid-Range", "Mid-Range Volume: Opposite Ends"],
  ["o_trans_freq", "transition", "Both Run", "Neither Runs", "Transition: Opposite Ends"],
  ["o_tov", "turnovers", "Both Turn It Over", "Both Protect The Ball", null],
  ["o_reb", "glass", "Both Crash The Offensive Glass", "Neither Crashes The Offensive Glass", null],
];
// A team that does a lot of something whose makes rank KEY_GAP+ places worse.
// [volume key, makes key, title]; d_ = its opponents (a cold streak that may turn).
const KEY_GAP = 10;
const KEY_VOLUME = [
  ["o_3par", "o_3pm", "Lots Of Threes, Few Falling", "threes"],
  ["o_paint_share", "o_paint_pct", "Lives In The Paint, Not Finishing", "paint"],
  ["o_mid_share", "o_mid_pct", "Lots Of Mid-Range, Few Falling", "mid"],
  ["d_3par", "d_3pm", "Opponents Shoot Lots Of Threes, Few Falling", "threes"],
];
// [offense key, defense key, name, topic, how-often key the offense must be in the top
// half of]: good-for-each-side ranks (league.js's `way`). A make rate only counts for an
// offense that takes those shots, transition scoring only for one that runs (Matchup
// Breakdown's rule; the audit had "CHA Offense: Transition Scoring" for a team 26th in running).
const KEY_EDGES = [
  ["o_rtg", "d_rtg", "Scoring", "scoring", null],
  ["o_3pm", "d_3pm", "Threes", "threes", null],
  ["o_tov", "d_tov", "Turnovers", "turnovers", null],
  ["o_reb", "d_reb", "Glass", "glass", null],
  ["o_paint_pct", "d_paint_pct", "Paint Finishing", "paint", "o_paint_share"],
  ["o_mid_pct", "d_mid_pct", "Mid-Range Finishing", "mid", "o_mid_share"],
  ["o_trans_ppp", "d_trans_ppp", "Transition Scoring", "transition", "o_trans_freq"],
];
// (Free throws a shot is a how-often number: it reads as Fits / Takes Away below, never twice.)
// How-often pairs [offense key, defense key, topic]: Fits = it does it a lot and this
// defense allows it a lot; Takes Away = this defense allows it least.
const KEY_SHARES = [
  ["o_3par", "d_3par", "Threes", "threes"],
  ["o_ftr", "d_ftr", "Free Throws", "ft"],
  ["o_paint_share", "d_paint_share", "The Paint", "paint"],
  ["o_mid_share", "d_mid_share", "Mid-Range", "mid"],
  ["o_trans_freq", "d_trans_freq", "Transition", "transition"],
];
// A defense weak at something tonight's offense rarely does. [offense key, weak defense keys, topic]
const KEY_UNTESTED = [
  ["o_trans_freq", ["d_trans_freq", "d_trans_ppp"], "Transition D Weak, Not Tested", "transition"],
  ["o_3par", ["d_3par", "d_3pm"], "Three-Point D Weak, Not Tested", "threes"],
  ["o_ftr", ["d_ftr"], "Fouls A Lot, Not Tested", "ft"],
  ["o_paint_share", ["d_paint_share", "d_paint_pct"], "Paint D Weak, Not Tested", "paint"],
  ["o_reb", ["d_reb"], "Defensive Glass Weak, Not Tested", "glass"],
];
// Which way is good for the team (league.js columns): -1 = the least is good.
const KEY_LOW_GOOD = new Set(["o_tov", "d_ppg", "d_rtg", "d_3pm", "d_3par", "d_ftr", "d_paint_share", "d_paint_pct", "d_mid_share", "d_mid_pct", "d_trans_freq", "d_trans_ppp", "d_ball_move"]);
const KEY_TREND_MIN = 6; // combined over / under decisions before a Trend
const KEY_TREND_SHARE = 0.7;

function nbaMatchupKeys(table, away, home, top) {
  const n = Object.values(table).length;
  const T = top || Math.round(n / 3);
  const val = (t, k) => {
    const v = (table[t] || {})[k];
    return Array.isArray(v) ? (v[0] + v[1] ? v[0] / (v[0] + v[1]) : null) : v ?? null;
  };
  const cache = {};
  // most(t, k): 1 = the most of it; least(t, k): 1 = the least. null = no number.
  const ranks = (k) =>
    (cache[k] ||= (() => {
      const vals = Object.keys(table).map((t) => val(t, k)).filter((v) => v !== null);
      return { vals, n: vals.length };
    })());
  const most = (t, k) => {
    const v = val(t, k);
    return v === null ? null : 1 + ranks(k).vals.filter((x) => x > v).length;
  };
  const least = (t, k) => {
    const v = val(t, k);
    return v === null ? null : 1 + ranks(k).vals.filter((x) => x < v).length;
  };
  const good = (t, k) => (KEY_LOW_GOOD.has(k) ? least(t, k) : most(t, k));
  const hi = (r) => r !== null && r <= T; // in the extreme third
  const lo = (r, k) => r !== null && r >= ranks(k).n - T + 1;
  // How far from the middle a rank sits, 0 (middle) to 1 (1st or last).
  const far = (t, k) => {
    const r = most(t, k), m = ranks(k).n;
    return r === null || m < 2 ? 0 : Math.abs(r - (m + 1) / 2) / ((m - 1) / 2);
  };
  const keys = [];
  const add = (type, title, team, tiles, score, topic) => keys.push({ type, title, team, tiles, score, topic });
  const tiles = (pairs) => pairs.map(([team, key]) => ({ team, key }));
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const pair = [away, home];
  const sides = [[away, home], [home, away]]; // [offense, defense]

  // Same Style / Clash: both at the same end, or at opposite ends.
  const clashed = new Set();
  KEY_STYLE.forEach(([k, topic, bothMost, bothLeast, opposite]) => {
    const [a, b] = pair.map((t) => most(t, k));
    const [la, lb] = pair.map((t) => least(t, k));
    const score = mean(pair.map((t) => far(t, k)));
    const ts = tiles(pair.map((t) => [t, k]));
    if (hi(a) && hi(b)) add("style", bothMost, null, ts, score, topic);
    else if (hi(la) && hi(lb)) add("style", bothLeast, null, ts, score, topic);
    else if (opposite && ((hi(a) && hi(lb)) || (hi(la) && hi(b)))) clashed.add(k);
  });
  // Inside Vs Outside replaces the two volume clashes it explains.
  sides.forEach(([o, d]) => {
    if (hi(most(o, "o_3par")) && hi(most(d, "o_paint_share")) && !hi(most(o, "o_paint_share")) && !hi(most(d, "o_3par"))) {
      add("clash", "Inside Vs Outside", null, tiles([[o, "o_3par"], [o, "o_paint_share"], [d, "o_3par"], [d, "o_paint_share"]]),
        mean([far(o, "o_3par"), far(d, "o_paint_share")]), "diet");
      clashed.delete("o_3par");
      clashed.delete("o_paint_share");
    }
  });
  KEY_STYLE.forEach(([k, topic, , , opposite]) => {
    if (clashed.has(k)) add("clash", opposite, null, tiles(pair.map((t) => [t, k])), mean(pair.map((t) => far(t, k))), topic);
  });

  // Trend: the two teams' over / under records together.
  const ou = pair.map((t) => (table[t] || {}).ou).filter(Array.isArray);
  if (ou.length === 2) {
    const over = ou[0][0] + ou[1][0], under = ou[0][1] + ou[1][1];
    const share = over + under ? over / (over + under) : 0.5;
    if (over + under >= KEY_TREND_MIN && (share >= KEY_TREND_SHARE || share <= 1 - KEY_TREND_SHARE))
      add("trend", `${share > 0.5 ? "Overs" : "Unders"} ${over}-${under} Combined`, null, tiles(pair.map((t) => [t, "ou"])), Math.abs(share - 0.5) * 2, "ou");
  }

  // Few Falling: lots of a shot, its makes ranking KEY_GAP+ places worse.
  pair.forEach((t) =>
    KEY_VOLUME.forEach(([vol, made, title, topic]) => {
      const v = most(t, vol), m = most(t, made);
      if (hi(v) && m !== null && m - v >= KEY_GAP) add("volume", title, t, tiles([[t, vol], [t, made]]), mean([far(t, vol), far(t, made)]), topic);
    })
  );

  sides.forEach(([o, d]) => {
    // Edge: one side clearly better (top third), the other not pointing back (bottom half).
    KEY_EDGES.forEach(([ok, dk, name, topic, takes]) => {
      const go = good(o, ok), gd = good(d, dk), m = ranks(ok).n;
      if (go === null || gd === null) return;
      if (takes && !(most(o, takes) !== null && most(o, takes) <= ranks(takes).n / 2)) return;
      const ts = tiles([[o, ok], [d, dk]]);
      const score = mean([far(o, ok), far(d, dk)]);
      if (hi(go) && gd > m / 2) add("edge", `${o} Offense: ${name}`, o, ts, score + (lo(gd, dk) ? 0.5 : 0), topic);
      else if (hi(gd) && go > m / 2) add("edge", `${d} Defense: ${name}`, d, ts, score + (lo(go, ok) ? 0.5 : 0), topic);
    });
    // Fits / Takes Away on how-often numbers: the offense does it a lot.
    KEY_SHARES.forEach(([ok, dk, name, topic]) => {
      if (!hi(most(o, ok))) return;
      const ts = tiles([[o, ok], [d, dk]]);
      if (hi(most(d, dk))) add("fits", `${o} Fits: ${name}`, o, ts, mean([far(o, ok), far(d, dk)]), topic);
      else if (hi(least(d, dk))) add("away", `${d} Takes Away ${name}`, d, ts, mean([far(o, ok), far(d, dk)]), topic);
    });
    // Not Tested: a weak spot (the defense allows the most) the offense rarely goes at.
    KEY_UNTESTED.forEach(([ok, dks, title, topic]) => {
      const weak = dks.filter((dk) => (dk === "d_reb" ? hi(least(d, dk)) : hi(most(d, dk))));
      if (weak.length && hi(least(o, ok)))
        add("untested", `${d} ${title}`, d, tiles([...weak.map((dk) => [d, dk]), [o, ok]]), mean([...weak.map((dk) => far(d, dk)), far(o, ok)]), topic);
    });
  });
  keys.sort((a, b) => b.score - a.score);
  const seen = new Set();
  keys.forEach((k) => {
    k.lead = !seen.has(k.topic);
    seen.add(k.topic);
  });
  return keys.filter((k) => k.lead).concat(keys.filter((k) => !k.lead));
}
