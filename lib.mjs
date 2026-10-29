export function fmt(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Pure logic: which players crossed a new $step since their last alert?
// Does NOT advance a player's baseline when an alert is due; the caller does that
// only after the notification was actually delivered (so failed sends are retried).
export function computeAlerts(players, baselines, step, watch) {
  const alerts = [];
  const next = { ...baselines };
  for (const p of players) {
    if (watch.length && !watch.some(w => p.name.toLowerCase().includes(w))) continue;
    const base = next[p.name];
    if (base === undefined || p.amount < base) {
      next[p.name] = p.amount; // first sighting, or the board reset
      continue;
    }
    const steps = Math.floor((p.amount - base + 1e-9) / step);
    if (steps >= 1) {
      alerts.push({ name: p.name, rank: p.rank, amount: p.amount, steps, newBase: base + steps * step });
    }
  }
  return { alerts, next };
}

export function alertText(a, step) {
  return a.name + ' has gone up ' + fmt(a.steps * step) + '\nNow at ' + fmt(a.amount) + ' (rank #' + a.rank + ').';
}
