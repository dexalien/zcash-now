const EXPLORER = 'https://testnet.zcashexplorer.app/transactions/';
const PRINT_MS = 2600;
const $ = (sel, el = document) => el.querySelector(sel);
const printer = $('#printer');

$('#copy-cmd').onclick = async (e) => {
  const btn = e.currentTarget;
  try {
    await navigator.clipboard.writeText($('#cmd').textContent);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Select ⌘C';
  }
  setTimeout(() => (btn.textContent = 'Copy'), 1600);
  print(); // copying the command prints a fresh receipt
};

const data = await fetch('data.json', { cache: 'no-store' }).then((r) => r.json());
await refreshFromRepo(data);
const byId = Object.fromEntries(data.recipes.map((r) => [r.id, r]));

const status = fillTicket();
renderTruth();
print();

// Feeds the ticket out of the slot. Restarting the CSS animation is enough.
function print() {
  printer.classList.remove('printed', 'printing');
  void printer.offsetWidth;
  printer.classList.add('printed', 'printing');
  $('#led').className = 'led';
  clearTimeout(print.t);
  print.t = setTimeout(() => {
    printer.classList.remove('printing');
    $('#led').className = `led ${status}`;
  }, PRINT_MS);
}

function fillTicket() {
  const send = byId['headless-send']?.receipt;
  const read = byId['read-memo']?.receipt;
  const verify = byId['verify-txid']?.receipt;
  const lines = $('#t-lines');
  const stamp = $('#stamp');

  if (!send?.txid) {
    stamp.textContent = 'PENDING';
    stamp.className = 'stamp none';
    $('#t-result').textContent = 'NO PROOF YET';
    row(lines, 'STATUS', 'waiting for first run');
    $('.t-thanks a').remove();
    return '';
  }

  const ok = send.status === 'pass' && read?.status !== 'fail' && verify?.status !== 'fail';
  stamp.textContent = ok ? 'PASS' : 'FAIL';
  stamp.className = ok ? 'stamp' : 'stamp fail';
  $('#t-result').textContent = ok ? 'WORKS TODAY' : 'BROKEN';

  const when = new Date(send.ranAt);
  $('#t-date').textContent = `${when.toISOString().slice(0, 10)}  ${when.toISOString().slice(11, 19)} UTC`;
  $('#t-net').textContent = `NU7 TESTNET · ${data.endpoint.replace(':443', '')}`;

  const pool = read?.detail?.match(/outputs in ([\w, ]+?), after/)?.[1];
  const block = verify?.detail?.match(/height (\d+)/)?.[1] ?? read?.detail?.match(/mined at (\d+)/)?.[1];
  row(lines, 'TXID', `${send.txid.slice(0, 8)}…${send.txid.slice(-8)}`);
  if (block) row(lines, 'BLOCK', `#${Number(block).toLocaleString('en')}`);
  if (pool) row(lines, 'POOL', pool.toUpperCase());
  row(lines, 'MEMO', read?.status === 'pass' ? 'DECRYPTED ✓' : '—');
  row(lines, 'ON-CHAIN', verify?.status === 'pass' ? 'VERIFIED ✓' : '—');
  row(lines, 'TOOL', `zcash-devtool ${send.toolVersions?.['zcash-devtool'] ?? ''}`);
  row(lines, 'PRINTED', ago(send.ranAt));

  barcode($('#barcode'), send.txid);
  $('#t-txid').textContent = send.txid;
  $('#t-verify').href = `${EXPLORER}${send.txid}`;
  return ok ? 'ok' : 'fail';
}

function renderTruth() {
  const works = data.recipes.filter((r) => r.receipt?.status === 'pass');
  $('#works-meta').textContent = `Checked against the chain at block ${data.blockHeight?.toLocaleString('en') ?? '?'}, ${ago(data.generatedAt)}.`;
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
    $('.why', li).textContent = t.why.split(/(?<=\.)\s/)[0];
    $('#broken').append(li);
  }
}

function row(dl, k, v) {
  const dt = document.createElement('dt');
  const dd = document.createElement('dd');
  dt.textContent = k;
  dd.textContent = v;
  dl.append(dt, dd);
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
