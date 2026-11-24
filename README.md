# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Akash1070/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Akash1070/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Institutional-grade pre-token launch radar that models implied fully diluted valuations (FDV) and synthesizes multi-step, actionable farming itineraries across 226 protocols. Built for make.fun's [Build the best token launch radar](https://make.fun/bounty/token-radar-01) bounty.

## Overview

Token Launch Radar analyzes pre-token decentralized protocols from a sealed snapshot of the DeFi universe. Rather than relying on subjective heuristics, it benchmarks pre-token opportunities against live-token market metrics across sectors (DEXes, Lending, Rollups, Yield, Derivatives, and Restaking), computes sector-calibrated price-to-TVL ratios, adjusts for 7-day TVL velocity and Lindy maturity, and produces an empirical implied valuation.

### Key Capabilities

- **Empirical Valuation Model**: Dynamically learns sector multiples from live-trading DeFi tokens (median $0.214x$) and applies growth and maturity dampeners.
- **100% Watchlist & Early Discovery**: Fully covers all 40 protocols from the make.fun watchlist plus 186 high-conviction early-stage protocols ($>100$ rows minimum required, 226 total).
- **Actionable Farm Itineraries**: 4–7 concrete steps per protocol specifying exact capital required, estimated time commitment, and gas/friction costs.
- **Vercel-Grade Design System**: High-density institutional layout with crisp 1px borders, Space Mono tabular typography, and seamless Light and Dark modes.
- **Zero Network Dependencies**: Pure standard library TypeScript engine (Node 22) and self-contained dashboard source under 64 KB with zero external CDN dependencies.

## Methodology & Valuation Engine

The model derives implied valuation from fundamental protocol metrics:

$$\text{Implied Value} = \text{TVL} \times M_{\text{sector}} \times (1 + \text{Velocity}_{7\text{d}} \times W_{\text{growth}}) \times \left(0.6 + \frac{\min(\text{Age}_{\text{days}}, 1095)}{1095} \times 0.4\right)$$

- **Sector Multiple ($M_{\text{sector}}$)**: Calibrated against active peer protocols in the same DefiLlama category.
- **Growth Multiplier**: Clamped velocity $\in [-60\%, +120\%]$ with dampened sensitivity to prevent short-term manipulation.
- **Maturity / Lindy Factor**: Smooth logarithmic scaling rewarding battle-tested protocol age up to a 3-year ceiling.

## Run it

```sh
node --experimental-strip-types main.ts --input /path/to/snapshot.json --output /path/to/output
```

Or test with the make.fun kit:

```sh
cd ../token-radar-01-kit
node cli/makefun.mjs check --repo ../token-radar --commit HEAD --transcripts ../transcripts.tar.gz
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=0t3v8mww&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
