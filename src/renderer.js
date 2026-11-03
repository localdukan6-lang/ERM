const $ = selector => document.querySelector(selector);
const money = paise => `₹${(Number(paise || 0) / 100).toFixed(2)}`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const notice = $('#notice');
let cart = [];
function tell(text, error = false) { notice.textContent = text; notice.className = `notice ${error ? 'error' : ''}`; setTimeout(() => notice.classList.add('hidden'), 5000); }
function formObject(form) { return Object.fromEntries(new FormData(form).entries()); }
function page(name) {
  document.querySelectorAll('.page').forEach(el => el.classList.toggle('hidden', el.id !== `page-${name}`));
  document.querySelectorAll('.nav').forEach(el => el.classList.toggle('active', el.dataset.page === name));
  $('#pageTitle').textContent = ({dashboard:'Dashboard',products:'Products & Barcode',parties:'Customers / Suppliers',billing:'Purchase / Sales',transactions:'Transactions',stock:'Stock Report'})[name];
  if (name === 'products') loadProducts(); if (name === 'parties') loadParties(); if (name === 'transactions') loadTransactions(); if (name === 'stock') loadStock();
}
async function loadDashboard() {
  const d = await window.erp.dashboard();
  const cards = [['Today Sales',money(d.todaySales)],['Today Purchase',money(d.todayPurchases)],['Product Variants',d.products],['Stock Pieces',d.stock],['Low Stock Items',d.lowStock],['Customers',d.customers],['Suppliers',d.suppliers]];
  $('#dashboardCards').innerHTML = cards.map(([label,value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`).join('');
}
async function loadProducts(q = '') {
  const rows = await window.erp.listProducts(q);
  $('#productsTable').innerHTML = rows.map(p => `<tr><td><b>${esc(p.name)}</b><small>${esc(p.article_number)}</small></td><td>${esc(p.barcode)}</td><td>${esc(p.size)} / ${esc(p.colour)}</td><td>${p.stock}</td><td>${money(p.wholesale_price_paise)}</td><td><button class="tiny label" data-barcode="${esc(p.barcode)}">Print label</button></td></tr>`).join('');
  document.querySelectorAll('.label').forEach(b => b.onclick = () => printLabel(b.dataset.barcode));
}
async function printLabel(value) {
  try { const image = await window.erp.barcodePng(value); const w = window.open('', '_blank', 'width=420,height=300'); if (!w) throw new Error('Allow the print window in the app.'); w.document.write(`<html><body style="font:14px Arial;text-align:center;padding:20px"><img src="${image}" style="max-width:100%"><script>window.onload=()=>window.print()<\/script></body></html>`); w.document.close(); } catch(e) { tell(e.message, true); }
}
async function loadParties() {
  const rows = await window.erp.listParties();
  $('#partiesTable').innerHTML = rows.map(p => `<tr><td>${esc(p.type)}</td><td><b>${esc(p.name)}</b><small>${esc(p.shop_name)}</small></td><td>${esc(p.mobile)}</td><td>${esc(p.gstin)}</td><td>${esc(p.city)}</td></tr>`).join('');
  const type = $('#billType').value;
  const allowed = await window.erp.listParties(type === 'sale' ? 'customer' : 'supplier');
  $('#partySelect').innerHTML = '<option value="">Walk-in / none</option>' + allowed.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
}
async function loadTransactions() {
  const rows = await window.erp.listTransactions($('#transactionFilter').value);
  $('#transactionsTable').innerHTML = rows.map(t => `<tr><td>${esc(t.document_number)}</td><td>${esc(t.invoice_date)}</td><td>${t.type}</td><td>${esc(t.party_name || '—')}</td><td>${money(t.total_paise)}</td><td>${money(t.paid_paise)}</td><td><button class="tiny pdf" data-id="${t.id}">Save PDF</button></td></tr>`).join('');
  document.querySelectorAll('.pdf').forEach(b => b.onclick = async () => { try { const r = await window.erp.invoicePdf(Number(b.dataset.id)); if (!r.canceled) tell(`PDF saved: ${r.filePath}`); } catch(e) { tell(e.message, true); } });
}
async function loadStock() {
  const rows = await window.erp.stockReport();
  $('#stockTable').innerHTML = rows.map(p => `<tr class="${p.stock <= p.minimum_stock ? 'low' : ''}"><td>${esc(p.name)}</td><td>${esc(p.article_number)}</td><td>${esc(p.barcode)}</td><td>${esc(p.size)}</td><td>${esc(p.colour)}</td><td>${p.stock}</td><td>${p.minimum_stock}</td><td>${money(p.sale_price_paise)}</td></tr>`).join('');
}
function renderCart() {
  $('#cartTable').innerHTML = cart.map((p,i) => `<tr><td>${esc(p.name)}<small>${esc(p.barcode)}</small></td><td>${p.quantity}</td><td>${money(p.pricePaise)}</td><td>${money(p.quantity*p.pricePaise)}</td><td><button type="button" class="tiny remove" data-i="${i}">Remove</button></td></tr>`).join('');
  $('#billTotal').textContent = money(cart.reduce((sum,p) => sum+p.quantity*p.pricePaise,0));
  document.querySelectorAll('.remove').forEach(b => b.onclick = () => { cart.splice(Number(b.dataset.i),1); renderCart(); });
}
async function addScan() {
  const barcode = $('#scanInput').value.trim(), quantity = Number($('#scanQty').value);
  if (!barcode) return;
  if (!Number.isSafeInteger(quantity) || quantity < 1) return tell('Enter a whole quantity greater than zero.', true);
  try {
    const product = await window.erp.listProducts(barcode);
    const p = product.find(item => item.barcode === barcode);
    if (!p) throw new Error(`Barcode not found: ${barcode}`);
    const type = $('#billType').value;
    const existing = cart.find(item => item.barcode === barcode);
    const price = type === 'purchase' ? p.purchase_price_paise : p.wholesale_price_paise;
    if (existing) existing.quantity += quantity; else cart.push({barcode:p.barcode,name:p.name,quantity,pricePaise:price});
    renderCart(); $('#scanInput').value=''; $('#scanQty').value='1'; $('#scanInput').focus();
  } catch(e) { tell(e.message, true); }
}
document.querySelectorAll('.nav').forEach(b => b.addEventListener('click', () => page(b.dataset.page)));
$('#productForm').addEventListener('submit', async e => { e.preventDefault(); try { await window.erp.addProduct(formObject(e.currentTarget)); e.currentTarget.reset(); tell('Product saved.'); await loadProducts(); await loadDashboard(); } catch(err) { tell(err.message, true); } });
$('#generateBarcode').onclick = () => { const f = $('#productForm'); if (!f.elements.barcode.value) f.elements.barcode.value = `TG${Date.now()}`; };
$('#productSearch').addEventListener('input', e => loadProducts(e.target.value));
$('#partyForm').addEventListener('submit', async e => { e.preventDefault(); try { await window.erp.addParty(formObject(e.currentTarget)); e.currentTarget.reset(); tell('Party saved.'); await loadParties(); await loadDashboard(); } catch(err) { tell(err.message,true); } });
$('#billType').addEventListener('change', () => { cart=[]; renderCart(); loadParties(); });
$('#addLine').onclick = addScan; $('#scanInput').addEventListener('keydown', e => { if(e.key==='Enter'){e.preventDefault();addScan();} });
$('#billingForm').addEventListener('submit', async e => { e.preventDefault(); if(!cart.length) return tell('Add at least one product.',true); try { const f=formObject(e.currentTarget); const result=await window.erp.createTransaction({type:f.type,partyId:f.partyId,paidAmount:f.paidAmount,lines:cart.map(x=>({barcode:x.barcode,quantity:x.quantity}))}); cart=[]; renderCart(); e.currentTarget.elements.paidAmount.value='0'; tell(`Posted ${result.documentNumber}. Total ${money(result.totalPaise)}.`); await Promise.all([loadDashboard(),loadTransactions(),loadStock()]); } catch(err) { tell(err.message,true); } });
$('#transactionFilter').onchange = loadTransactions; $('#stockRefresh').onclick = loadStock;
$('#backupBtn').onclick = async () => { try { const r=await window.erp.createBackup(); if(!r.canceled) tell(`Backup saved: ${r.filePath}`); } catch(e) { tell(e.message,true); } };
$('#excelBtn').onclick = async () => { try { const r=await window.erp.exportExcel(); if(!r.canceled) tell(`Excel saved: ${r.filePath}`); } catch(e) { tell(e.message,true); } };
Promise.all([loadDashboard(),loadProducts()]).catch(e => tell(e.message,true));
