const EXPLORER = 'https://testnet.zcashexplorer.app/transactions/';
const $ = (sel, el = document) => el.querySelector(sel);

$('#copy-cmd').onclick = async (e) => {
  const btn = e.currentTarget;
  try {
    await navigator.clipboard.writeText($('#cmd').textContent);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Select ⌘C';
  }
  setTimeout(() => (btn.textContent = 'Copy'), 1600);
};

const data = await fetch('data.json', { cache: 'no-store' }).then((r) => r.json());
await refreshFromRepo(data);
const byId = Object.fromEntries(data.recipes.map((r) => [r.id, r]));

renderProof();
renderTruth();

function renderProof() {
  const send = byId['headless-send']?.receipt;
  const read = byId['read-memo']?.receipt;
  const verify = byId['verify-txid']?.receipt;
  const stamp = $('#stamp');
  const lines = $('#r-lines');

  if (!send?.txid) {
    stamp.textContent = 'NO PROOF YET';
    stamp.className = 'stamp none';
    row(lines, 'STATUS', 'waiting for the first run');
    return;
  }
  const ok = send.status === 'pass' && read?.status !== 'fail' && verify?.status !== 'fail';
  stamp.textContent = ok ? 'PASS' : 'FAIL';
  stamp.className = ok ? 'stamp' : 'stamp fail';

  const pool = read?.detail?.match(/outputs in ([\w, ]+?), after/)?.[1];
  const block = verify?.detail?.match(/height (\d+)/)?.[1] ?? read?.detail?.match(/mined at (\d+)/)?.[1];
  row(lines, 'TXID', `<a href="${EXPLORER}${send.txid}" target="_blank" rel="noopener noreferrer">${send.txid.slice(0, 8)}…${send.txid.slice(-8)} ↗</a>`);
  if (block) row(lines, 'BLOCK', `#${Number(block).toLocaleString('en')}`);
  if (pool) row(lines, 'POOL', pool);
  row(lines, 'MEMO', read?.status === 'pass' ? 'decrypted locally ✓' : '—');
  row(lines, 'ON-CHAIN CHECK', verify?.status === 'pass' ? 'verified over gRPC ✓' : '—');
  row(lines, 'TOOL', `zcash-devtool ${send.toolVersions?.['zcash-devtool'] ?? ''}`);
  row(lines, 'WHEN', ago(send.ranAt));

  barcode($('#barcode'), send.txid);
  $('#r-txid').textContent = send.txid;
}

function renderTruth() {
  const works = data.recipes.filter((r) => r.receipt?.status === 'pass');
  $('#works-meta').textContent = `· checked at block ${data.blockHeight?.toLocaleString('en') ?? '?'}`;
  for (const r of works) {
    const li = document.createElement('li');
    li.innerHTML = '<details><summary><span class="mark">✓</span><span class="t"></span></summary><pre><code></code></pre></details>';
    $('.t', li).textContent = r.task;
    $('code', li).textContent = r.code;
    $('#works').append(li);
  }
  for (const t of data.tools.filter((t) => t.status === 'broken')) {
    const li = document.createElement('li');
    li.innerHTML = '<span><span class="mark">✗</span><b></b></span><span class="why"></span>';
    $('b', li).textContent = t.name;
    $('.why', li).textContent = firstSentence(t.why);
    $('#broken').append(li);
  }
}

function row(dl, k, v) {
  const dt = document.createElement('dt');
  const dd = document.createElement('dd');
  dt.textContent = k;
  dd.innerHTML = v;
  dl.append(dt, dd);
}

function firstSentence(s) {
  return s.split(/(?<=\.)\s/)[0];
}

// Decorative barcode: each hex nibble becomes a bar and a gap.
function barcode(el, hex) {
  for (const ch of hex.slice(0, 64)) {
    const n = parseInt(ch, 16);
    const bar = document.createElement('span');
    bar.style.width = `${1 + (n & 3)}px`;
    bar.style.marginRight = `${1 + (n >> 2)}px`;
    el.append(bar);
  }
}

function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (s < 90) return `${Math.round(s)} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

// The deploy is a snapshot; the runner commits new receipts to main every hour.
// /live/* is proxied by Vercel to the repo, so the visitor only ever talks to
// this host. If it fails, the snapshot built into data.json is still honest.
async function refreshFromRepo(d) {
  try {
    const rec = await fetch('live/receipts.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null));
    if (!rec?.receipts || rec.generatedAt <= d.generatedAt) return;
    Object.assign(d, { generatedAt: rec.generatedAt, blockHeight: rec.blockHeight, summary: rec.summary });
    for (const r of d.recipes) r.receipt = rec.receipts.find((x) => x.recipeId === r.id) ?? r.receipt;
  } catch {}
}
