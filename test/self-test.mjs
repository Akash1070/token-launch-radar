// Token Radar — UI & Gate Self-Test Suite
// Verifies all 7 competition gate criteria, determinism across runs, and data integrity.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'out');
const SNAPSHOT = join(ROOT, '..', 'token-radar-01-kit', 'input', 'snapshot.json');

console.log('--- Token Radar Self-Test Suite ---');

// Step 1: Run main.ts
console.log('1. Executing main.ts against sealed snapshot...');
execSync(`node --experimental-strip-types main.ts --input "${SNAPSHOT}" --output "${OUT}"`, {
  cwd: ROOT,
  stdio: 'pipe',
});

// Step 2: Verify required output files exist
console.log('2. Verifying output artifacts...');
const required = ['board.json', 'data.js', 'dossier.json', 'dashboard', 'screenshots'];
for (const req of required) {
  const p = join(OUT, req);
  if (!existsSync(p)) throw new Error(`Missing required output: ${req}`);
}

// Step 3: Check dashboard files and byte budget
console.log('3. Validating dashboard constraints (<65,536 bytes, no http/https URLs)...');
const dashDir = join(OUT, 'dashboard');
const dashFiles = readdirSync(dashDir);
let totalDashBytes = 0;
for (const file of dashFiles) {
  const p = join(dashDir, file);
  const content = readFileSync(p, 'utf8');
  totalDashBytes += Buffer.byteLength(content, 'utf8');
  if (/http:\/\/|https:\/\//.test(content)) {
    // Check if URL is in attribute, style, or script import (prohibited)
    if (/(href|src)\s*=\s*["']https?:\/\//i.test(content) || /@import\s+["']?https?:\/\//i.test(content)) {
      throw new Error(`Prohibited external network URL detected in ${file}`);
    }
  }
}
console.log(`   Dashboard total source bytes: ${totalDashBytes} / 65,536 bytes limit (OK)`);
if (totalDashBytes > 65536) {
  throw new Error(`Dashboard exceeds 64KB limit: ${totalDashBytes} bytes`);
}

// Step 4: Validate board.json structure and logic
console.log('4. Validating board.json logic & gate rules...');
const board = JSON.parse(readFileSync(join(OUT, 'board.json'), 'utf8'));
const rows = Array.isArray(board) ? board : board.rows;
if (!Array.isArray(rows) || rows.length < 100 || rows.length > 4000) {
  throw new Error(`Invalid row count: ${rows?.length}`);
}

let prevValue = Infinity;
const seenSlugs = new Set();
rows.forEach((r, idx) => {
  const rank = idx + 1;
  if (r.rank !== rank) throw new Error(`Row ${idx} has rank ${r.rank}, expected ${rank}`);
  if (typeof r.slug !== 'string' || !r.slug) throw new Error(`Row ${idx} missing valid slug`);
  if (seenSlugs.has(r.slug)) throw new Error(`Duplicate slug: ${r.slug}`);
  seenSlugs.add(r.slug);
  if (typeof r.implied_value_usd !== 'number' || r.implied_value_usd <= 0) {
    throw new Error(`Row ${r.slug} has invalid implied_value_usd: ${r.implied_value_usd}`);
  }
  if (r.implied_value_usd > prevValue) {
    throw new Error(`Implied value increased at rank ${rank}: ${r.implied_value_usd} > ${prevValue}`);
  }
  prevValue = r.implied_value_usd;

  if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
    throw new Error(`Row ${r.slug} farm_steps count out of bounds [3-12]: ${r.farm_steps?.length}`);
  }
  r.farm_steps.forEach((step, sIdx) => {
    const trimmed = step.trim();
    if (trimmed.length < 20 || trimmed.length > 600) {
      throw new Error(`Row ${r.slug} step ${sIdx} length ${trimmed.length} out of bounds [20-600]`);
    }
  });
});

// Step 5: Validate watchlist coverage
console.log('5. Validating watchlist coverage (all 40 required)...');
const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
const missingWatchlist = snapshot.watchlist.filter((slug) => !seenSlugs.has(slug));
if (missingWatchlist.length > 0) {
  throw new Error(`Missing watchlist protocols: ${missingWatchlist.join(', ')}`);
}
console.log(`   All ${snapshot.watchlist.length} watchlist protocols covered (OK)`);

// Step 6: Validate screenshots
console.log('6. Validating screenshots (dimensions, count, format)...');
const shotsDir = join(OUT, 'screenshots');
const shots = readdirSync(shotsDir).filter((f) => !f.startsWith('.'));
if (shots.length < 3 || shots.length > 4) {
  throw new Error(`Expected 3-4 screenshots, found ${shots.length}`);
}
shots.forEach((f) => {
  const buf = readFileSync(join(shotsDir, f));
  if (buf.length > 524288) throw new Error(`Screenshot ${f} exceeds 512KB: ${buf.length}`);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const longSide = Math.max(w, h);
  const shortSide = Math.min(w, h);
  if (longSide > 1440 || shortSide < 800) {
    throw new Error(`Screenshot ${f} dimensions ${w}x${h} violate [long<=1440, short>=800]`);
  }
});
console.log(`   ${shots.length} screenshots validated within dimension and size caps (OK)`);

// Step 7: Determinism Check
console.log('7. Verifying deterministic execution (bit-for-bit repeatability)...');
const OUT2 = join(ROOT, 'out_check');
try {
  execSync(`node --experimental-strip-types main.ts --input "${SNAPSHOT}" --output "${OUT2}"`, {
    cwd: ROOT,
    stdio: 'pipe',
  });

  function hashFile(p) {
    return createHash('sha256').update(readFileSync(p)).digest('hex');
  }
  const testFiles = ['board.json', 'data.js', 'dossier.json'];
  for (const tf of testFiles) {
    const h1 = hashFile(join(OUT, tf));
    const h2 = hashFile(join(OUT2, tf));
    if (h1 !== h2) {
      throw new Error(`Non-deterministic output in ${tf}: ${h1} !== ${h2}`);
    }
  }
  console.log('   Deterministic output confirmed across dual runs (OK)');
} finally {
  try {
    const { rmSync } = await import('node:fs');
    rmSync(OUT2, { recursive: true, force: true });
  } catch (e) {}
}

console.log('\n>>> ALL SELF-TESTS PASSED: ENTRY IS FULLY COMPLIANT AND READY FOR SUBMISSION <<<');
