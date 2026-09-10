// nflverse team abbreviation -> display name.
const TEAM_NAMES = {
  ARI: "Arizona Cardinals",
  ATL: "Atlanta Falcons",
  BAL: "Baltimore Ravens",
  BUF: "Buffalo Bills",
  CAR: "Carolina Panthers",
  CHI: "Chicago Bears",
  CIN: "Cincinnati Bengals",
  CLE: "Cleveland Browns",
  DAL: "Dallas Cowboys",
  DEN: "Denver Broncos",
  DET: "Detroit Lions",
  GB: "Green Bay Packers",
  HOU: "Houston Texans",
  IND: "Indianapolis Colts",
  JAX: "Jacksonville Jaguars",
  KC: "Kansas City Chiefs",
  LA: "Los Angeles Rams",
  LAC: "Los Angeles Chargers",
  LV: "Las Vegas Raiders",
  MIA: "Miami Dolphins",
  MIN: "Minnesota Vikings",
  NE: "New England Patriots",
  NO: "New Orleans Saints",
  NYG: "New York Giants",
  NYJ: "New York Jets",
  PHI: "Philadelphia Eagles",
  PIT: "Pittsburgh Steelers",
  SEA: "Seattle Seahawks",
  SF: "San Francisco 49ers",
  TB: "Tampa Bay Buccaneers",
  TEN: "Tennessee Titans",
  WAS: "Washington Commanders",
};

// Official primary team color, used to tint each side's header cells so
// columns are identifiable by team rather than a fixed generic color.
const TEAM_COLORS = {
  ARI: "#97233F",
  ATL: "#A71930",
  BAL: "#241773",
  BUF: "#00338D",
  CAR: "#0085CA",
  CHI: "#0B162A",
  CIN: "#FB4F14",
  CLE: "#FF3C00",
  DAL: "#041E42",
  DEN: "#FB4F14",
  DET: "#0076B6",
  GB: "#203731",
  HOU: "#03202F",
  IND: "#002C5F",
  JAX: "#006778",
  KC: "#E31837",
  LA: "#003594",
  LAC: "#0080C6",
  LV: "#A5ACAF",
  MIA: "#008E97",
  MIN: "#4F2683",
  NE: "#002244",
  NO: "#D3BC8D",
  NYG: "#0B2265",
  NYJ: "#125740",
  PHI: "#004C54",
  PIT: "#FFB612",
  SEA: "#69BE28",
  SF: "#AA0000",
  TB: "#D50A0A",
  TEN: "#4B92DB",
  WAS: "#FFB612",
};

// ESPN's team-logo CDN uses its own lowercase abbreviations, which match
// ours except for these two.
const ESPN_LOGO_ABBR = { LA: "lar", WAS: "wsh" };

function teamLogoUrl(team) {
  const code = ESPN_LOGO_ABBR[team] || (team || "").toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${code}.png`;
}

// Small inline logo for cells that otherwise show only a bare team code
// (ADV columns, header labels) -- same CDN/URL as the schedule scroller
// and odds bar already use, just sized down to sit inline with text.
function teamLogoMini(team, size = 16) {
  if (!team) return "";
  return `<img src="${teamLogoUrl(team)}" class="team-logo-mini" alt="${team}" loading="lazy" width="${size}" height="${size}">`;
}
