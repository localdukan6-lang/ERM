const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const ExcelJS = require('exceljs');
const bwipjs = require('bwip-js');
const { openDatabase } = require('./database');
const { attach } = require('./extended');

let db;
let modules;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1120, minHeight: 720,
    title: 'Textile & Garments ERP',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}
function initializeDatabase() {
  db = openDatabase(path.join(app.getPath('userData'), 'textile-erp.sqlite'));
  modules = attach(db);
}
function registerIpc() {
  ipcMain.handle('dashboard:get', () => db.dashboard());
  ipcMain.handle('products:list', (_e, q = '') => db.listProducts(String(q).slice(0,100)));
  ipcMain.handle('products:add', (_e, data) => modules.addProduct(data));
  ipcMain.handle('parties:list', (_e, type = 'all') => db.listParties(String(type)));
  ipcMain.handle('parties:add', (_e, data) => db.addParty(data));
  ipcMain.handle('transactions:list', (_e, type = 'all') => db.listTransactions(String(type)));
  ipcMain.handle('transactions:create', (_e, data) => db.createTransaction(data));
  ipcMain.handle('reports:stock', () => db.stockReport());
  ipcMain.handle('godowns:list', () => modules.listGodowns());
  ipcMain.handle('godowns:add', (_e, data) => modules.addGodown(data));
  ipcMain.handle('racks:add', (_e, data) => modules.addRack(data));
  ipcMain.handle('godowns:stock', (_e, id) => modules.listGodownStock(id));
  ipcMain.handle('stock:adjust', (_e, data) => modules.createAdjustment(data));
  ipcMain.handle('stock:transfer', (_e, data) => modules.createTransfer(data));
  ipcMain.handle('returns:create', (_e, data) => modules.createReturn(data));
  ipcMain.handle('payments:create', (_e, data) => modules.createPayment(data));
  ipcMain.handle('payments:list', (_e, id) => modules.listPayments(id));
  ipcMain.handle('parties:outstanding', (_e, type) => modules.outstandingReport(type || 'all'));
  ipcMain.handle('parties:ledger', (_e, id) => modules.partyLedger(id));
  ipcMain.handle('expenses:create', (_e, data) => modules.createExpense(data));
  ipcMain.handle('expenses:list', () => modules.listExpenses());
  ipcMain.handle('barcode:png', async (_e, value) => {
    const text = String(value || '').trim();
    if (!text || text.length > 80) throw new Error('Invalid barcode value');
    const png = await bwipjs.toBuffer({ bcid:'code128', text, scale:3, height:12, includetext:true });
    return `data:image/png;base64,${png.toString('base64')}`;
  });
  ipcMain.handle('backup:create', async () => {
    const result = await dialog.showSaveDialog({ title:'Save ERP backup', defaultPath:`textile-erp-${new Date().toISOString().slice(0,10)}.sqlite`, filters:[{name:'SQLite database',extensions:['sqlite','db']}] });
    if (result.canceled || !result.filePath) return {canceled:true};
    await db.backup(result.filePath);
    return {canceled:false,filePath:result.filePath};
  });
  ipcMain.handle('backup:restore', async () => {
    const result = await dialog.showOpenDialog({ title:'Restore ERP backup', properties:['openFile'], filters:[{name:'SQLite database',extensions:['sqlite','db']}] });
    if (result.canceled || !result.filePaths[0]) return {canceled:true};
    const safety = path.join(app.getPath('userData'), `before-restore-${Date.now()}.sqlite`);
    await db.backup(safety);
    modules.restoreFrom(result.filePaths[0]);
    initializeDatabase();
    return {canceled:false,safetyBackup:safety};
  });
  ipcMain.handle('reports:excel', async () => {
    const result = await dialog.showSaveDialog({ title:'Export stock to Excel', defaultPath:'stock-report.xlsx', filters:[{name:'Excel workbook',extensions:['xlsx']}] });
    if (result.canceled || !result.filePath) return {canceled:true};
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Current Stock');
    sheet.columns = [{header:'Product',key:'name',width:28},{header:'Article',key:'article_number',width:18},{header:'Barcode',key:'barcode',width:22},{header:'Size',key:'size',width:12},{header:'Colour',key:'colour',width:16},{header:'Stock',key:'stock',width:12},{header:'Sale Price',key:'sale_price',width:14}];
    db.stockReport().forEach(row => sheet.addRow({...row,sale_price:row.sale_price_paise/100})); sheet.getRow(1).font={bold:true};
    await workbook.xlsx.writeFile(result.filePath); return {canceled:false,filePath:result.filePath};
  });
  ipcMain.handle('invoice:pdf', async (_e, transactionId) => {
    const invoice = db.getInvoice(Number(transactionId)); if (!invoice) throw new Error('Invoice not found');
    const safe = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const rows = invoice.lines.map(line=>`<tr><td>${safe(line.product_name)}</td><td>${safe(line.barcode)}</td><td>${line.quantity}</td><td>₹${(line.unit_price_paise/100).toFixed(2)}</td><td>₹${(line.line_total_paise/100).toFixed(2)}</td></tr>`).join('');
    const html = `<!doctype html><html><meta charset="utf-8"><style>body{font:14px Arial;margin:32px;color:#172033}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{border-bottom:1px solid #ccd2dc;padding:10px;text-align:left}.total{text-align:right;font-size:20px;margin-top:24px}</style><h1>Textile & Garments ERP</h1><p>Invoice: ${safe(invoice.document_number)} | Date: ${safe(invoice.created_at)}</p><p>Party: ${safe(invoice.party_name||'Walk-in Customer')}</p><table><thead><tr><th>Product</th><th>Barcode</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table><div class="total">Total: ₹${(invoice.total_paise/100).toFixed(2)}</div></html>`;
    const win = new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}});
    try { await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`); const pdf=await win.webContents.printToPDF({printBackground:true,pageSize:'A4'}); const save=await dialog.showSaveDialog({defaultPath:`${invoice.document_number}.pdf`,filters:[{name:'PDF',extensions:['pdf']}]}); if(save.canceled||!save.filePath)return {canceled:true}; fs.writeFileSync(save.filePath,pdf); return {canceled:false,filePath:save.filePath}; } finally { if(!win.isDestroyed())win.destroy(); }
  });
}
app.whenReady().then(()=>{ initializeDatabase(); registerIpc(); createWindow(); app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();}); });
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
