// Token Radar — the model that turns one sealed snapshot into one ranked board.
//
// The job: a protocol's token does not exist yet, so what would it be worth if the protocol's
// record stayed as it is, and what should a reader do to farm it before the token appears?
//
// Every number below is derived from the snapshot's own figures. No protocol is named anywhere in
// this file: the same functions score all 320 rows.
//
//   sector multiple   the market's own mcap / TVL ratio for the protocol's sector, the median over
//                     the live-token protocols in that sector, shrunk toward the whole market's
//                     median by PRIOR_LIVE pseudo-observations so a sector with two comparables
//                     does not invent a multiple. This is the only place a sector group matters.
//   base value        tvl_usd x sector multiple — what a protocol of this size is worth at its
//                     sector's going rate per dollar of TVL.
//   momentum          1 + clamp(change_7d, -40, +80) / 100 x 0.30 — traction the snapshot already
//                     reports, damped so one wild week cannot double a rank.
//   maturity          0.55 + 0.45 x (1 - e^(-age_days / 500)) — how much of the "ran for years with
//                     no token" story is already proven. Unknown age is neutral (0.75).
//   implied value     base x momentum x maturity, in whole dollars. The range around it comes from
//                     the sector's inter-quartile multiples, so a thin sector shows a wide range.
//
// The live-token protocols are never mixed into the board: they already have a market price, so the
// dashboard shows their market cap beside the multiple the model learned from them.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated on the dashboard's model tab. */
export interface ModelConfig {
  momentum_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  prior_live: number;
  min_multiple: number;
  max_multiple: number;
}

export const MODEL: ModelConfig = {
  momentum_weight: 0.3,
  growth_floor: -40,
  growth_cap: 80,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 500,
  prior_live: 6,
  min_multiple: 0.05,
  max_multiple: 2,
};

export const MODEL_VERSION = 'gauge-2.1';

/** How many pre-token protocols below the floor the early radar carries, so the board is 320 rows. */
export const EARLY_ROWS = 280;

/** How many live-token protocols the market tab carries, by market cap. */
export const LIVE_ROWS = 40;

/** One sector's learned multiple. */
export interface SectorStat {
  sector: string;
  live_n: number;
  median_ratio: number;
  applied_multiple: number;
  q1: number;
  q3: number;
}

/** A farm step: the action, what it costs and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  sector: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  listed_at: string | null;
  token_status: 'pre-token';
  cohort: 'watchlist' | 'early';
  stage: string;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  multiple: number;
  momentum: number;
  maturity: number;
  value_per_tvl: number;
  risk: string;
  why_now: string;
  farm_steps: string[];
}

/** The dashboard's row: the board row plus the display-only sector stat, all numbers raw. */
export interface RadarRow extends BoardRow {}

/** A live-token protocol, shown beside the multiple the model learned from it. */
export interface LiveRow {
  slug: string;
  name: string;
  sector: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  ratio: number | null;
}

/** Headline figures for the page's KPI strip. */
export interface RadarStats {
  universe_size: number;
  watchlist_size: number;
  watchlist_covered: number;
  board_size: number;
  early_size: number;
  live_size: number;
  top_implied_usd: number;
  median_implied_usd: number;
  board_implied_usd: number;
  median_age_days: number | null;
}

/** Everything data.js carries: the board, the market tab, the learned multiples and the stats. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  feed?: { sha256: string; bytes: number };
  model: ModelConfig;
  sector_stats: SectorStat[];
  market_median: number;
  stats: RadarStats;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** A quantile of an ascending-sorted array, linearly interpolated. */
export function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/**
 * The sector a category belongs to. DefiLlama's category names are many and granular; the model
 * needs groups with enough live comparables to learn a multiple from. The mapping is by keyword,
 * never by protocol name.
 */
export function sectorOf(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('predict')) return 'Prediction';
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('credit')) return 'Lending';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option') || c.includes('basis')) return 'Derivatives';
  if (c.includes('dex') || c.includes('amm') || c.includes('orderbook')) return 'Dexs';
  if (c.includes('rwa') || c.includes('real world')) return 'RWA';
  if (c.includes('bridge') || c.includes('canonical') || c.includes('cross chain')) return 'Bridge';
  if (c.includes('staking') || c.includes('restak')) return 'Staking';
  if (c.includes('curator') || c.includes('allocator') || c.includes('liquidity manager')) return 'Curators';
  if (c.includes('yield') || c.includes('farm') || c.includes('vault')) return 'Yield';
  if (c.includes('stable')) return 'Stablecoin';
  if (c === 'chain' || c.includes('chain')) return 'Chain';
  if (c.includes('payment')) return 'Payments';
  if (c.includes('insurance')) return 'Insurance';
  if (c.includes('nft')) return 'NFT';
  return 'Other';
}

/** A live-token protocol: it records a token and a market cap for it. */
export function isLiveToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0;
}

/** Whether a protocol's record carries no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

const bySlugIndex = (protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> => new Map(protocols.map((p) => [p.slug, p]));

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The stage label: how much of a track record the protocol already has. */
export function stageOf(age: number | null): string {
  if (age === null) return 'unlisted';
  if (age < 180) return 'emerging';
  if (age < 730) return 'proven';
  return 'veteran';
}

/**
 * The sector table: for each sector, the median mcap / TVL over its live-token protocols, shrunk
 * toward the market-wide median, and the inter-quartile ratios that set the confidence range.
 */
export function sectorTable(snapshot: Snapshot, model: ModelConfig = MODEL): { marketMedian: number; sectors: Map<string, SectorStat> } {
  const ratios: number[] = [];
  const bySector = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (!isLiveToken(p) || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd! / p.tvl_usd;
    if (!(ratio > 0) || !Number.isFinite(ratio)) continue;
    ratios.push(ratio);
    const s = sectorOf(p.category);
    const bucket = bySector.get(s) ?? [];
    bucket.push(ratio);
    bySector.set(s, bucket);
  }
  ratios.sort((a, b) => a - b);
  const marketMedian = quantile(ratios, 0.5);
  const sectors = new Map<string, SectorStat>();
  for (const [sector, list] of bySector) {
    list.sort((a, b) => a - b);
    const median = quantile(list, 0.5);
    const applied = clamp((list.length * median + model.prior_live * marketMedian) / (list.length + model.prior_live), model.min_multiple, model.max_multiple);
    const q1 = list.length >= 4 ? quantile(list, 0.25) : quantile(ratios, 0.25);
    const q3 = list.length >= 4 ? quantile(list, 0.75) : quantile(ratios, 0.75);
    sectors.set(sector, { sector, live_n: list.length, median_ratio: median, applied_multiple: applied, q1: Math.max(model.min_multiple, q1), q3: Math.min(model.max_multiple, q3) });
  }
  const fallback: SectorStat = {
    sector: 'Other',
    live_n: 0,
    median_ratio: marketMedian,
    applied_multiple: clamp(marketMedian, model.min_multiple, model.max_multiple),
    q1: Math.max(model.min_multiple, quantile(ratios, 0.25)),
    q3: Math.min(model.max_multiple, quantile(ratios, 0.75)),
  };
  return { marketMedian, sectors: new Map([...sectors, ['Other', sectors.get('Other') ?? fallback]]) };
}

/** The momentum and maturity multipliers one protocol gets under `model`. */
export function factors(protocol: SnapshotProtocol, asOf: string, model: ModelConfig = MODEL): { momentum: number; maturity: number; age: number | null; growthPct: number } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = clamp(finite(protocol.change_7d, 0), model.growth_floor, model.growth_cap);
  const momentum = 1 + (growthPct / 100) * model.momentum_weight;
  const ageForModel = age ?? 365;
  const maturity = model.maturity_floor + model.maturity_range * (1 - Math.exp(-Math.max(0, ageForModel) / model.maturity_days));
  return { momentum, maturity, age, growthPct };
}

/** The implied value, in whole dollars, and the range its sector's comparables imply. */
export function impliedFor(p: SnapshotProtocol, asOf: string, sector: SectorStat, model: ModelConfig = MODEL): { implied: number; low: number; high: number; momentum: number; maturity: number; multiple: number; age: number | null } {
  const { momentum, maturity, age } = factors(p, asOf, model);
  const multiple = sector.applied_multiple;
  const raw = p.tvl_usd * multiple * momentum * maturity;
  return {
    implied: Math.max(1, Math.round(raw)),
    low: Math.max(1, Math.round(p.tvl_usd * sector.q1 * momentum * maturity)),
    high: Math.max(1, Math.round(p.tvl_usd * sector.q3 * momentum * maturity)),
    momentum,
    maturity,
    multiple,
    age,
  };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  if (tvl >= 20_000_000) return 75;
  return 50;
}

/** How long to hold, from the protocol's stage: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The sector's one core action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, sector: string, capital: number, chain: string): string {
  const name = p.name;
  switch (sector) {
    case 'Lending':
      return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a quarter of it back against the position and keep both sides open so the protocol sees a real borrower.`;
    case 'Dexs':
      return `Provide $${capital} as a two-sided position in ${name}'s deepest pool on ${chain} and stake the LP token in its gauge if it has one.`;
    case 'Derivatives':
      return `Deposit $${capital} of USDC as margin on ${name}, open one small hedge and keep the account funded through two weekly volume snapshots.`;
    case 'Yield':
      return `Deposit $${capital} into ${name}'s flagship vault on ${chain} and leave the receipt token in the same wallet.`;
    case 'RWA':
      return `Mint or subscribe $${capital} of ${name}'s yield asset on ${chain} and hold the receipt token in the farming wallet.`;
    case 'Bridge':
      return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds once inside its app so the bridge records a round trip.`;
    case 'Staking':
      return `Stake $${capital} of the chain's native asset through ${name} and keep the liquid receipt token rather than the underlying.`;
    case 'Curators':
      return `Deposit $${capital} into a vault ${name} curates on ${chain} and leave the vault shares in the farming wallet.`;
    case 'Prediction':
      return `Fund $${capital} and place one position on each of two different markets on ${name}.`;
    case 'Stablecoin':
      return `Mint $${capital} of ${name}'s stable asset against collateral on ${chain} and hold it through the window.`;
    case 'Chain':
      return `Bridge $${capital} onto ${chain} through its own bridge and use one app on it so the chain sees an active address.`;
    case 'Payments':
      return `Route $${capital} of payments through ${name} and keep the receiving wallet active for a full month.`;
    case 'Insurance':
      return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active through the window.`;
    default:
      return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
  }
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, derived from the
 * protocol's own record (sector, chains, TVL, age). No name is special-cased.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, sector: string): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  return [
    {
      text: `Use a fresh wallet that holds only the farming float, keep its seed phrase offline, and never reuse a wallet that already claimed another airdrop.`,
      cost: 'about $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: `Send $${capital} of USDC to that wallet on ${chain} and keep about $20 of the chain's gas token beside it so the position never gets stuck.`,
      cost: `$${capital} of capital plus a $20 gas buffer`,
      time: '10 minutes',
    },
    {
      text: actionFor(p, sector, capital, chain),
      cost: `$${capital} deposited and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Add to the position once a week for four weeks instead of all at once, so the activity is spread across several snapshots.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week for 4 weeks',
    },
    {
      text: `Hold the position for at least ${hold} days without withdrawing or moving wallets; a transfer out can reset an activity record.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Watch only ${p.name}'s own announcements for a points or token programme and claim from the page it publishes, never from a link in a message.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes a month',
    },
    {
      text: `Write the wallet address, every deposit and its date in a farm log so the position can be repeated, sized up or unwound later.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** A one-line risk note, from the sector and the width of its comparables. */
export function riskFor(p: SnapshotProtocol, sector: SectorStat, live: boolean): string {
  if (live) return 'Its token already trades, so this is a market value, not a forecast.';
  const spread = sector.q3 / Math.max(0.0001, sector.q1);
  if (sector.live_n === 0) return 'No live protocol in this sector records a market cap, so the multiple is the market median and the range is wide.';
  if (spread > 8) return `Only ${sector.live_n} live comparable${sector.live_n === 1 ? '' : 's'} in this sector and their multiples are wide apart, so treat the range as soft.`;
  if (sector.live_n < 3) return `The multiple rests on ${sector.live_n} live comparable${sector.live_n === 1 ? '' : 's'}; the range widens if that one is unusual.`;
  return `The multiple is the median of ${sector.live_n} live comparables; the main risk is that ${p.name}'s TVL leaves before a token arrives.`;
}

/** A one-line reason this protocol is interesting now, from the snapshot's own growth and age. */
export function whyNow(p: SnapshotProtocol, age: number | null): string {
  const ch = p.change_7d;
  const growth = ch === null ? 'Its seven-day change is unreported' : ch >= 15 ? `TVL is up ${ch.toFixed(1)}% in seven days` : ch <= -10 ? `TVL is down ${Math.abs(ch).toFixed(1)}% in seven days` : `TVL is roughly flat over seven days (${ch > 0 ? '+' : ''}${ch.toFixed(1)}%)`;
  const time = age === null ? 'and DefiLlama records no listing date for it' : age >= 730 ? `and it has run ${(age / 365).toFixed(1)} years with no token recorded` : age >= 180 ? `and it has run ${Math.round(age / 30)} months with no token recorded` : `and it was first listed ${age} days ago`;
  return `${growth}, ${time}.`;
}

/**
 * The protocols the board ranks, strongest first with ranks 1..n: every watchlist slug, then the
 * pre-token protocols below the floor with the highest implied value.
 */
export function buildBoard(snapshot: Snapshot, model: ModelConfig = MODEL): { board: BoardRow[]; sectors: SectorStat[]; marketMedian: number } {
  const index = bySlugIndex(snapshot.protocols);
  const { marketMedian, sectors } = sectorTable(snapshot, model);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const sector = sectors.get(sectorOf(p.category)) ?? sectors.get('Other')!;
    return { p, sector, ...impliedFor(p, snapshot.as_of, sector, model) };
  });
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .map((p) => {
      const sector = sectors.get(sectorOf(p.category)) ?? sectors.get('Other')!;
      return { p, sector, ...impliedFor(p, snapshot.as_of, sector, model) };
    })
    .sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1))
    .slice(0, EARLY_ROWS);
  scored.push(...early);
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board = scored.map((s, i) => {
    const sector = s.sector;
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      sector: sector.sector,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      age_days: s.age,
      listed_at: s.p.listed_at,
      token_status: 'pre-token' as const,
      cohort: snapshot.watchlist.includes(s.p.slug) ? ('watchlist' as const) : ('early' as const),
      stage: stageOf(s.age),
      implied_value_usd: s.implied,
      implied_low_usd: s.low,
      implied_high_usd: s.high,
      multiple: s.multiple,
      momentum: s.momentum,
      maturity: s.maturity,
      value_per_tvl: s.implied / s.p.tvl_usd,
      risk: riskFor(s.p, sector, false),
      why_now: whyNow(s.p, s.age),
      farm_steps: farmSteps(s.p, s.age, sector.sector).map(stepText),
    };
  });
  return { board, sectors: [...sectors.values()].sort((a, b) => b.applied_multiple - a.applied_multiple || a.sector.localeCompare(b.sector)), marketMedian };
}

/** The live-token protocols, by market cap, with the ratio the model learns from. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => isLiveToken(p) && p.tvl_usd > 0 && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      sector: sectorOf(p.category),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? p.mcap_usd / p.tvl_usd : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConfig = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, sectors, marketMedian } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const implied = board.map((r) => r.implied_value_usd).sort((a, b) => a - b);
  const ages = board.map((r) => r.age_days).filter((a): a is number => a !== null).sort((a, b) => a - b);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model,
    sector_stats: sectors,
    market_median: marketMedian,
    stats: {
      universe_size: snapshot.protocols.length,
      watchlist_size: snapshot.watchlist.length,
      watchlist_covered: snapshot.watchlist.filter((s) => board.some((r) => r.slug === s)).length,
      board_size: board.length,
      early_size: board.filter((r) => r.cohort === 'early').length,
      live_size: live.length,
      top_implied_usd: board[0]?.implied_value_usd ?? 0,
      median_implied_usd: quantile(implied, 0.5),
      board_implied_usd: implied.reduce((a, b) => a + b, 0),
      median_age_days: ages.length ? quantile(ages, 0.5) : null,
    },
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value past the gate's cap`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
