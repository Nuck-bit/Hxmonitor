// Reads the hiscores table on hyphonix.gg and reports { name, amount } for each player.
// It doesn't depend on exact class names: it looks for a repeated list/table of rows
// that each contain a $ amount, located at/after the #hiscores anchor.
(function () {
  'use strict';

  const LABELS = new Set([
    'wagered', 'wager', 'wagers', 'prize', 'prizes', 'points', 'total', 'reward',
    'rewards', 'rank', 'user', 'username', 'player', 'players', 'name', 'amount',
    'position', 'level', 'lvl', 'you'
  ]);
  const RANK_RE = /^#?\d{1,3}(?:st|nd|rd|th)?\.?$/i;
  const MONEY_G = () => /\$\s?(\d[\d,]*(?:\.\d+)?)\s?([kKmM])?(?![A-Za-z\d])/g;

  function moneyIn(text) {
    const out = [];
    const re = MONEY_G();
    let m;
    while ((m = re.exec(text))) {
      let v = parseFloat(m[1].replace(/,/g, ''));
      if (m[2]) v *= /k/i.test(m[2]) ? 1e3 : 1e6;
      if (!isNaN(v)) out.push(v);
    }
    return out;
  }

  function pieces(el) {
    const out = [];
    const walker = document.createTreeWalker(el, 4 /* SHOW_TEXT */);
    let n;
    while ((n = walker.nextNode())) {
      const p = n.parentElement;
      if (p && /^(SCRIPT|STYLE|NOSCRIPT)$/.test(p.tagName)) continue;
      const t = n.nodeValue.replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
    }
    return out;
  }

  function textOf(el) {
    return pieces(el).join(' ');
  }

  function pickName(ps) {
    for (const raw of ps) {
      const t = raw
        .replace(MONEY_G(), ' ')
        .replace(/^\s*#?\d{1,3}(?:st|nd|rd|th)?\.?\s+(?=\S)/i, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!t) continue;
      if (RANK_RE.test(t)) continue;
      if (LABELS.has(t.toLowerCase().replace(/:$/, ''))) continue;
      if (!/[\p{L}*]/u.test(t)) continue;
      return t;
    }
    return '';
  }

  function scan() {
    const anchor = document.getElementById('hiscores');
    const groups = new Map();

    for (const el of document.body.querySelectorAll('*')) {
      if (/^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName)) continue;
      const parent = el.parentElement;
      if (!parent) continue;
      const amts = moneyIn(textOf(el));
      if (amts.length === 0 || amts.length > 3) continue;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(el);
    }

    let rows = [];
    for (const [parent, kids] of groups) {
      if (kids.length < 3) continue;
      if (anchor && !(anchor.contains(parent) || (anchor.compareDocumentPosition(parent) & 4))) continue;
      rows.push(...kids);
    }
    if (!rows.length) {
      // Fallback: biggest repeated group anywhere on the page.
      let best = [];
      for (const kids of groups.values()) if (kids.length >= 3 && kids.length > best.length) best = kids;
      rows = best;
    }

    const players = [];
    const seen = new Set();
    for (const el of rows) {
      const amounts = moneyIn(textOf(el));
      if (!amounts.length) continue;
      const amount = Math.max(...amounts);
      let name = pickName(pieces(el));
      if (!name) {
        // Flattened grid layouts: the name may live in a previous sibling cell.
        let sib = el.previousElementSibling;
        for (let i = 0; i < 3 && sib && !name; i++, sib = sib.previousElementSibling) {
          name = pickName(pieces(sib));
        }
      }
      if (!name || seen.has(name)) continue;
      seen.add(name);
      players.push({ name, amount, rank: players.length + 1 });
    }
    return players;
  }

  let last = '';
  function report() {
    let players;
    try { players = scan(); } catch (e) { return; }
    if (!players.length) return;
    const sig = JSON.stringify(players.map(p => [p.name, p.amount]));
    if (sig === last) return;
    last = sig;
    try { chrome.runtime.sendMessage({ type: 'snapshot', players }); } catch (e) { /* extension reloaded */ }
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
    let timer = null;
    const schedule = () => {
      if (timer) return; // throttle (not debounce): the page has a ticking countdown
      timer = setTimeout(() => { timer = null; report(); }, 3000);
    };
    new MutationObserver(schedule).observe(document.documentElement, {
      childList: true, subtree: true, characterData: true
    });
    schedule();
    setInterval(report, 30000);
  }

  if (typeof module !== 'undefined') module.exports = { scan, moneyIn };
})();
