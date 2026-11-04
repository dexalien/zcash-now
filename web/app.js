const EXPLORER = 'https://testnet.zcashexplorer.app/transactions/';
const PRINT_MS = 2600;
const POLL_MS = 60_000;
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
let live = await refreshFromRepo(data);
const status = fillTicket();
renderBoard();
print();

// The board keeps itself current: re-read the receipts every minute.
setInterval(async () => {
  const before = data.generatedAt;
  live = await refreshFromRepo(data);
  renderBoard(data.generatedAt !== before);
}, POLL_MS);
setInterval(renderTick, 15_000);

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

function receipt(id) {
  return data.recipes.find((r) => r.id === id)?.receipt;
}

function fillTicket() {
  const send = receipt('headless-send');
  const read = receipt('read-memo');
  const verify = receipt('verify-txid');
  const lines = $('#t-lines');
  const seal = $('#seal');

  if (!send?.txid) {
    seal.remove();
    $('#t-result').textContent = 'NO PROOF YET';
    row(lines, 'STATUS', 'waiting for first run');
    $('.t-thanks a').remove();
    return '';
  }

  const ok = send.status === 'pass' && read?.status !== 'fail' && verify?.status !== 'fail';
  $('.seal-pass', seal).textContent = ok ? 'PASS' : 'FAIL';
  if (!ok) seal.classList.add('fail');
  $('#t-result').textContent = ok ? 'WORKS TODAY' : 'BROKEN';

  const when = new Date(send.ranAt).toISOString();
  $('#t-date').textContent = `${when.slice(0, 10)}  ${when.slice(11, 19)} UTC`;
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
  $('#seal-block').textContent = block ? `BLOCK ${block}` : when.slice(0, 10);

  barcode($('#barcode'), send.txid);
  $('#t-txid').textContent = send.txid;
  $('#t-verify').href = `${EXPLORER}${send.txid}`;
  return ok ? 'ok' : 'fail';
}

function renderBoard(changed = false) {
  const rows = $('#rows');
  const open = new Set([...rows.querySelectorAll('details[open]')].map((d) => d.dataset.id));
  rows.replaceChildren();

  for (const r of data.recipes.filter((r) => r.receipt?.status === 'pass')) {
    const li = document.createElement('li');
    li.className = 'ok';
    if (changed) li.classList.add('flash');
    li.innerHTML = '<details><summary class="row"><span class="mark">✓</span><span class="what"></span><span class="tag pass"></span></summary><pre><code></code></pre></details>';
    $('details', li).dataset.id = r.id;
    $('details', li).open = open.has(r.id);
    $('.what', li).textContent = r.task;
    const h = r.receipt.blockHeight;
    $('.tag', li).textContent = h ? `PASS · #${h.toLocaleString('en')}` : 'PASS';
    $('code', li).textContent = r.code;
    rows.append(li);
  }

  const divider = document.createElement('li');
  divider.className = 'divider';
  divider.textContent = "DON'T USE ON NU7";
  rows.append(divider);

  for (const t of data.tools.filter((t) => t.status === 'broken')) {
    const li = document.createElement('li');
    li.className = 'bad';
    li.innerHTML = '<div class="row"><span class="mark">✗</span><span class="what"><b></b><small></small></span><span class="tag broken">BROKEN</span></div>';
    $('b', li).textContent = t.name;
    $('small', li).textContent = t.why.split(/(?<=\.)\s/)[0];
    rows.append(li);
  }
  renderTick();
}

function renderTick() {
  $('#tick').textContent = `block #${data.blockHeight?.toLocaleString('en') ?? '?'} · ${ago(data.generatedAt)}`;
  // Receipts older than two scheduled runs are not "live" any more; say so.
  const stale = Date.now() - new Date(data.generatedAt) > 2.5 * 3600_000;
  $('#live').classList.toggle('stale', stale || !live);
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
// this host. Returns whether the live source answered.
async function refreshFromRepo(d) {
  try {
    const rec = await fetch('live/receipts.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null));
    if (!rec?.receipts) return false;
    if (rec.generatedAt > d.generatedAt) {
      Object.assign(d, { generatedAt: rec.generatedAt, blockHeight: rec.blockHeight, summary: rec.summary });
      for (const r of d.recipes) r.receipt = rec.receipts.find((x) => x.recipeId === r.id) ?? r.receipt;
    }
    return true;
  } catch {
    return false;
  }
}
