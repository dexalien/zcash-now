const EXPLORER = 'https://testnet.zcashexplorer.app/transactions/';
const $ = (sel, el = document) => el.querySelector(sel);
const STAMP = { pass: 'PASS', fail: 'FAIL', network: 'NETWORK', skipped: 'NO RECEIPT' };

const data = await fetch('data.json', { cache: 'no-store' }).then((r) => r.json());

meta($('#meta'), [
  ['NETWORK', 'testnet · NU7'],
  ['SERVER', data.endpoint],
  ['BLOCK', data.blockHeight ? `#${data.blockHeight.toLocaleString('en')}` : '—'],
  ['LAST RUN', ago(data.generatedAt)],
  ['RUNS LOGGED', String(data.runs)],
]);
const s = data.summary;
$('#totals').innerHTML = `<span class="pass">${s.pass} PASS</span> · <span class="fail">${s.fail} FAIL</span> · <span class="network">${s.network} NETWORK</span> · ${s.skipped} NO RECEIPT`;

data.recipes.forEach((r, i) => $('#recipes').append(ticket(r, i + 1)));

for (const t of data.tools.filter((t) => t.status !== 'works')) {
  const li = document.createElement('li');
  li.dataset.s = t.status === 'broken' ? 'broken' : 'degraded';
  li.innerHTML = '<span class="mark"></span><span><b></b> <span class="note"></span><br><span class="use"></span></span>';
  $('.mark', li).textContent = t.status === 'broken' ? '✗' : '~';
  $('b', li).textContent = t.name;
  $('.note', li).textContent = `— ${t.status.replace('-', ' ')}`;
  $('.use', li).textContent = t.why;
  $('#tools').append(li);
}

for (const b of document.querySelectorAll('.copy[data-copy]')) b.onclick = () => copy(b, $(`#${b.dataset.copy}`).textContent);

function ticket(r, n) {
  const el = $('#ticket-tpl').content.firstElementChild.cloneNode(true);
  const rc = r.receipt;
  const status = rc?.status ?? 'skipped';
  el.dataset.status = status;
  $('.no', el).textContent = `RECIPE #${String(n).padStart(3, '0')} · ${r.id}`;
  $('.cost', el).textContent = r.cost.toUpperCase();
  $('.title', el).textContent = r.task;
  $('.proves', el).textContent = r.proves;
  $('.stamp', el).textContent = STAMP[status];

  const rows = [];
  if (rc?.txid) rows.push(['TXID', txLink(rc.txid), 'txid']);
  if (rc?.blockHeight) rows.push(['BLOCK', `#${rc.blockHeight.toLocaleString('en')}`]);
  if (rc?.toolVersions) {
    const [k, v] = Object.entries(rc.toolVersions)[0];
    rows.push(['TOOL', esc(`${k} ${v}`)]);
  }
  rows.push(['RAN', rc ? `${ago(rc.ranAt)}${rc.carried ? ' <span class="carried">(carried from its last run)</span>' : ''}` : '—']);
  meta($('.lines', el), rows);
  const note = rc?.error ?? (status !== 'pass' ? rc?.detail : null);
  const passDetail = status === 'pass' ? rc?.detail : null;
  for (const [text, cls] of [[passDetail, 'detail'], [note, 'err']]) {
    if (!text) continue;
    const dd = document.createElement('dd');
    dd.className = cls;
    dd.style.gridColumn = '1 / -1';
    dd.style.textAlign = 'left';
    dd.style.fontSize = '12px';
    dd.textContent = (cls === 'err' && status !== 'skipped' ? '✗ ' : '') + text;
    if (cls === 'err' && status === 'skipped') dd.style.color = 'var(--ink-soft)';
    $('.lines', el).append(dd);
  }

  for (const h of r.history) {
    const i = document.createElement('i');
    i.dataset.s = h.status;
    i.title = `${h.status} · ${new Date(h.ranAt).toLocaleString()}${h.blockHeight ? ` · block ${h.blockHeight}` : ''}`;
    $('.history', el).append(i);
  }

  $('.leaks', el).innerHTML = '<b>WHAT LEAKS:</b> ';
  $('.leaks', el).append(r.leaks);
  $('code', el).textContent = r.code;
  $('.copy', el).onclick = (e) => copy(e.currentTarget, r.code);

  barcode($('.barcode', el), rc?.txid ?? r.id);
  $('.barcode-label', el).textContent = rc?.txid ?? (rc?.blockHeight ? `block ${rc.blockHeight}` : r.id);
  return el;
}

function meta(dl, rows) {
  for (const [k, v, cls] of rows) {
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = k;
    dd.innerHTML = v;
    if (cls) dd.className = cls;
    dl.append(dt, dd);
  }
}

function txLink(txid) {
  return `<a href="${EXPLORER}${txid}" target="_blank" rel="noopener noreferrer" title="${txid}">${txid.slice(0, 8)}…${txid.slice(-8)}</a>`;
}

// Decorative barcode: each hex nibble becomes a bar and a gap.
function barcode(el, seed) {
  const hex = /^[0-9a-f]+$/i.test(seed) ? seed : [...seed].map((c) => c.charCodeAt(0).toString(16)).join('');
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
  if (s < 90) return `${Math.round(s)}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

async function copy(btn, text) {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'COPIED';
  } catch {
    btn.textContent = 'SELECT + ⌘C';
  }
  setTimeout(() => (btn.textContent = 'COPY'), 1500);
}
