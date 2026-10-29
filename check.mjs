import fs from 'node:fs';
import { computeAlerts, alertText } from './lib.mjs';

const STEP = Math.max(1, Number(process.env.STEP) || 50);
const WATCH = (process.env.WATCH || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const TOPIC = (process.env.NTFY_TOPIC || '').trim();
const NTFY_BASE = process.env.NTFY_BASE || 'https://ntfy.sh';
const STATE_FILE = process.env.STATE_FILE || 'state.json';
const MAX_FAILS_BEFORE_WARNING = 12; // about an hour of failed runs

if (!/^[A-Za-z0-9_-]{1,64}$/.test(TOPIC)) {
  console.error('NTFY_TOPIC secret is missing or invalid. ntfy topics may only contain letters, numbers, "_" and "-" (no spaces).');
  process.exit(1);
}

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return { baselines: s.baselines || {}, failures: s.failures || 0 };
  } catch (e) {
    return { baselines: {}, failures: 0 };
  }
}
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

async function sendNtfy(text, title = 'Hyphonix leaderboard') {
  const res = await fetch(NTFY_BASE + '/' + TOPIC, {
    method: 'POST',
    headers: { Title: title, Priority: 'high', Tags: 'moneybag' },
    body: text
  });
  if (!res.ok) throw new Error('ntfy responded ' + res.status);
}

async function readPlayers() {
  if (process.env.HX_FIXTURE) return JSON.parse(fs.readFileSync(process.env.HX_FIXTURE, 'utf8'));

  const { chromium } = await import('playwright');
  const src = fs.readFileSync(new URL('./scan.js', import.meta.url), 'utf8');
  const runScan = s => {
    const module = { exports: {} };
    new Function('module', s)(module);
    return module.exports.scan();
  };
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      bypassCSP: true,
      viewport: { width: 1366, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    });
    const page = await ctx.newPage();
    await page.goto('https://hyphonix.gg/#hiscores', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const deadline = Date.now() + 60000;
    let players = [];
    let lastSig = null;
    while (Date.now() < deadline) {
      players = await page.evaluate(runScan, src);
      if (players.length) {
        const sig = JSON.stringify(players.map(p => [p.name, p.amount]));
        if (sig === lastSig) break; // two identical reads in a row = fully rendered
        lastSig = sig;
      }
      await page.waitForTimeout(3000);
    }
    return players;
  } finally {
    await browser.close();
  }
}

const state = loadState();
let exitCode = 0;

try {
  if (process.env.TEST === 'true') {
    await sendNtfy('Test alert\nThe Hyphonix monitor is running on GitHub.', 'Hyphonix leaderboard');
    console.log('Test notification sent.');
  }

  const players = await readPlayers();
  if (!players.length) throw new Error('No players could be read from the hiscores.');
  console.log('Read ' + players.length + ' players: ' + players.slice(0, 5).map(p => p.name + ' $' + p.amount).join(', ') + (players.length > 5 ? ', ...' : ''));
  state.failures = 0;

  const { alerts, next } = computeAlerts(players, state.baselines, STEP, WATCH);
  state.baselines = next;

  for (const a of alerts) {
    try {
      await sendNtfy(alertText(a, STEP));
      state.baselines[a.name] = a.newBase; // advance only after a successful send
      console.log('Alert sent for ' + a.name);
    } catch (e) {
      console.error('Could not send alert for ' + a.name + ' (will retry next run): ' + e.message);
      exitCode = 1;
    }
  }
} catch (e) {
  console.error('Run failed: ' + e.message);
  state.failures += 1;
  exitCode = 1;
  if (state.failures === MAX_FAILS_BEFORE_WARNING) {
    try {
      await sendNtfy('The monitor has been unable to read the leaderboard for about an hour. The site may have changed.', 'Hyphonix monitor problem');
    } catch (err) { /* nothing more we can do */ }
  }
}

saveState(state);
process.exit(exitCode);
