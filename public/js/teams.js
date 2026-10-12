// Club colours keyed by Premier League abbreviation: [primary, alternate].
const CLUB_COLORS = {
  ARS: ['#EF0107', '#063672'],
  AVL: ['#95BFE5', '#670E36'],
  BOU: ['#DA291C', '#111111'],
  BRE: ['#E30613', '#FBB800'],
  BHA: ['#0057B8', '#FFCD00'],
  BUR: ['#8A1E4A', '#99D6EA'],
  CHE: ['#034694', '#DBA111'],
  CRY: ['#1B458F', '#C4122E'],
  EVE: ['#003399', '#F2F2F2'],
  FUL: ['#F2F2F2', '#CC0000'],
  IPS: ['#3A64A3', '#DE2C37'],
  LEE: ['#FFCD00', '#1D428A'],
  LEI: ['#003090', '#FDBE11'],
  LIV: ['#C8102E', '#00B2A9'],
  LUT: ['#F78F1E', '#002D62'],
  MCI: ['#6CABDD', '#1C2C5B'],
  MUN: ['#DA291C', '#FBE122'],
  NEW: ['#F2F2F2', '#41B6E6'],
  NFO: ['#DD0000', '#F2F2F2'],
  SHU: ['#EE2737', '#0D171A'],
  SOU: ['#D71920', '#130C0E'],
  SUN: ['#EB172B', '#211E1F'],
  TOT: ['#F2F2F2', '#132257'],
  WHU: ['#7A263A', '#1BB1E7'],
  WOL: ['#FDB913', '#231F20'],
};

const FALLBACK = [['#3DDC97', '#1B998B'], ['#FF6B6B', '#FFD93D']];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function distance(a, b) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

/** Pick contrasting colours for a fixture: away switches to its alternate kit on a clash. */
export function fixtureColors(homeAbbr, awayAbbr) {
  const home = (CLUB_COLORS[homeAbbr] || FALLBACK[0])[0];
  const awayPair = CLUB_COLORS[awayAbbr] || FALLBACK[1];
  let away = awayPair[0];
  if (distance(home, away) < 120) away = awayPair[1];
  if (distance(home, away) < 120) away = FALLBACK[1][0];
  return { home, away };
}

/** Clubs used for the offline demo simulator. */
export const DEMO_CLUBS = [
  { abbr: 'ARS', name: 'Arsenal', rating: 88 },
  { abbr: 'AVL', name: 'Aston Villa', rating: 80 },
  { abbr: 'BOU', name: 'Bournemouth', rating: 74 },
  { abbr: 'BRE', name: 'Brentford', rating: 73 },
  { abbr: 'BHA', name: 'Brighton', rating: 77 },
  { abbr: 'BUR', name: 'Burnley', rating: 66 },
  { abbr: 'CHE', name: 'Chelsea', rating: 83 },
  { abbr: 'CRY', name: 'Crystal Palace', rating: 75 },
  { abbr: 'EVE', name: 'Everton', rating: 71 },
  { abbr: 'FUL', name: 'Fulham', rating: 73 },
  { abbr: 'LEE', name: 'Leeds United', rating: 68 },
  { abbr: 'LIV', name: 'Liverpool', rating: 89 },
  { abbr: 'MCI', name: 'Manchester City', rating: 87 },
  { abbr: 'MUN', name: 'Manchester United', rating: 77 },
  { abbr: 'NEW', name: 'Newcastle United', rating: 81 },
  { abbr: 'NFO', name: "Nott'm Forest", rating: 76 },
  { abbr: 'SUN', name: 'Sunderland', rating: 67 },
  { abbr: 'TOT', name: 'Tottenham Hotspur', rating: 79 },
  { abbr: 'WHU', name: 'West Ham United', rating: 72 },
  { abbr: 'WOL', name: 'Wolves', rating: 69 },
];
