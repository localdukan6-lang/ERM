const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');

function requiredText(value, label, max = 160) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new Error(`${label} is required (maximum ${max} characters).`);
  return text;
}
function nonNegativeMoney(value, label) {
  const n = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${label} must be a valid non-negative amount.`);
  return n;
}
function openDatabase(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, article_number TEXT NOT NULL DEFAULT '',
      product_code TEXT NOT NULL DEFAULT '', barcode TEXT NOT NULL UNIQUE,
      size TEXT NOT NULL DEFAULT '', colour TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
      brand TEXT NOT NULL DEFAULT '', hsn TEXT NOT NULL DEFAULT '', gst_rate REAL NOT NULL DEFAULT 0 CHECK(gst_rate >= 0 AND gst_rate <= 100),
      purchase_price_paise INTEGER NOT NULL DEFAULT 0 CHECK(purchase_price_paise >= 0),
      wholesale_price_paise INTEGER NOT NULL DEFAULT 0 CHECK(wholesale_price_paise >= 0),
      retail_price_paise INTEGER NOT NULL DEFAULT 0 CHECK(retail_price_paise >= 0),
      mrp_paise INTEGER NOT NULL DEFAULT 0 CHECK(mrp_paise >= 0),
      minimum_stock INTEGER NOT NULL DEFAULT 0 CHECK(minimum_stock >= 0), stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS parties (
      id INTEGER PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('customer','supplier','both')),
      name TEXT NOT NULL, shop_name TEXT NOT NULL DEFAULT '', mobile TEXT NOT NULL DEFAULT '',
      gstin TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '', opening_balance_paise INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY, document_number TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('purchase','sale')),
      party_id INTEGER REFERENCES parties(id), invoice_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      total_paise INTEGER NOT NULL CHECK(total_paise >= 0), paid_paise INTEGER NOT NULL DEFAULT 0 CHECK(paid_paise >= 0),
      status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN ('posted','void')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS transaction_lines (
      id INTEGER PRIMARY KEY, transaction_id INTEGER NOT NULL REFERENCES transactions(id),
      product_id INTEGER NOT NULL REFERENCES products(id), barcode TEXT NOT NULL, product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity > 0), unit_price_paise INTEGER NOT NULL,
      line_total_paise INTEGER NOT NULL CHECK(line_total_paise >= 0), gst_rate REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id),
      transaction_id INTEGER REFERENCES transactions(id), type TEXT NOT NULL,
      quantity_delta INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_products_search ON products(name, article_number, barcode);
    CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(invoice_date, type);
    CREATE INDEX IF NOT EXISTS idx_lines_product ON transaction_lines(product_id);
    CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements(product_id);
  `);

  const listProducts = q => db.prepare(`SELECT * FROM products WHERE name LIKE ? OR article_number LIKE ? OR barcode LIKE ? ORDER BY name COLLATE NOCASE LIMIT 500`).all(`%${q}%`, `%${q}%`, `%${q}%`);
  const addProduct = input => {
    const name = requiredText(input?.name, 'Product name');
    const barcode = requiredText(input?.barcode, 'Barcode', 80);
    const stock = Number(input.openingStock || 0);
    if (!Number.isSafeInteger(stock) || stock < 0) throw new Error('Opening stock must be a non-negative whole number.');
    const insert = db.transaction(() => {
      const r = db.prepare(`INSERT INTO products(name,article_number,product_code,barcode,size,colour,category,brand,hsn,gst_rate,purchase_price_paise,wholesale_price_paise,retail_price_paise,mrp_paise,minimum_stock,stock) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        name, String(input.articleNumber || '').trim(), String(input.productCode || '').trim(), barcode,
        String(input.size || '').trim(), String(input.colour || '').trim(), String(input.category || '').trim(),
        String(input.brand || '').trim(), String(input.hsn || '').trim(), Number(input.gstRate || 0),
        nonNegativeMoney(input.purchasePrice || 0, 'Purchase price'), nonNegativeMoney(input.wholesalePrice || input.salePrice || 0, 'Wholesale price'),
        nonNegativeMoney(input.retailPrice || input.salePrice || 0, 'Retail price'), nonNegativeMoney(input.mrp || 0, 'MRP'),
        Math.max(0, Number(input.minimumStock || 0)), stock
      );
      if (stock) db.prepare(`INSERT INTO stock_movements(product_id,type,quantity_delta) VALUES(?,'opening',?)`).run(r.lastInsertRowid, stock);
      return { id: Number(r.lastInsertRowid) };
    });
    return insert();
  };
  const listParties = type => type === 'all'
    ? db.prepare('SELECT * FROM parties ORDER BY name COLLATE NOCASE').all()
    : db.prepare('SELECT * FROM parties WHERE type IN (?,\'both\') ORDER BY name COLLATE NOCASE').all(type);
  const addParty = input => {
    const type = ['customer','supplier','both'].includes(input?.type) ? input.type : 'customer';
    const r = db.prepare(`INSERT INTO parties(type,name,shop_name,mobile,gstin,address,city,state,opening_balance_paise) VALUES(?,?,?,?,?,?,?,?,?)`).run(
      type, requiredText(input?.name, 'Party name'), String(input.shopName || '').trim(), String(input.mobile || '').trim(),
      String(input.gstin || '').trim(), String(input.address || '').trim(), String(input.city || '').trim(),
      String(input.state || '').trim(), nonNegativeMoney(input.openingBalance || 0, 'Opening balance')
    );
    return { id: Number(r.lastInsertRowid) };
  };
  const createTransaction = input => {
    const type = input?.type;
    if (!['sale','purchase'].includes(type)) throw new Error('Choose sale or purchase.');
    if (!Array.isArray(input.lines) || !input.lines.length) throw new Error('Add at least one product.');
    const grouped = new Map();
    for (const line of input.lines) {
      const barcode = requiredText(line.barcode, 'Barcode', 80);
      const quantity = Number(line.quantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Quantity must be a positive whole number.');
      grouped.set(barcode, (grouped.get(barcode) || 0) + quantity);
    }
    return db.transaction(() => {
      const products = [];
      for (const [barcode, quantity] of grouped) {
        const product = db.prepare('SELECT * FROM products WHERE barcode=?').get(barcode);
        if (!product) throw new Error(`Unknown barcode: ${barcode}`);
        if (type === 'sale' && product.stock < quantity) throw new Error(`Not enough stock for ${product.name}. Available: ${product.stock}`);
        const override = input.lines.find(x => x.barcode === barcode)?.unitPrice;
        const price = override === undefined || override === ''
          ? (type === 'purchase' ? product.purchase_price_paise : product.wholesale_price_paise)
          : nonNegativeMoney(override, 'Unit price');
        products.push({ product, quantity, price });
      }
      const total = products.reduce((sum, item) => sum + item.price * item.quantity, 0);
      if (!Number.isSafeInteger(total)) throw new Error('Total amount is too large.');
      const paid = nonNegativeMoney(input.paidAmount || 0, 'Paid amount');
      if (paid > total) throw new Error('Paid amount cannot exceed the invoice total in this version.');
      const prefix = type === 'sale' ? 'SAL' : 'PUR';
      const doc = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
      const header = db.prepare('INSERT INTO transactions(document_number,type,party_id,invoice_date,total_paise,paid_paise) VALUES(?,?,?,?,?,?)').run(
        doc, type, input.partyId ? Number(input.partyId) : null, String(input.invoiceDate || new Date().toISOString().slice(0,10)), total, paid
      );
      const txId = Number(header.lastInsertRowid);
      for (const { product, quantity, price } of products) {
        const lineTotal = price * quantity;
        db.prepare('INSERT INTO transaction_lines(transaction_id,product_id,barcode,product_name,quantity,unit_price_paise,line_total_paise,gst_rate) VALUES(?,?,?,?,?,?,?,?)').run(txId, product.id, product.barcode, product.name, quantity, price, lineTotal, product.gst_rate);
        const delta = type === 'purchase' ? quantity : -quantity;
        db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(delta, product.id);
        db.prepare('INSERT INTO stock_movements(product_id,transaction_id,type,quantity_delta) VALUES(?,?,?,?)').run(product.id, txId, type, delta);
      }
      return { id: txId, documentNumber: doc, totalPaise: total };
    })();
  };
  const listTransactions = type => {
    const where = type === 'all' ? '' : 'WHERE t.type=?';
    const stmt = db.prepare(`SELECT t.*,p.name AS party_name FROM transactions t LEFT JOIN parties p ON p.id=t.party_id ${where} ORDER BY t.id DESC LIMIT 500`);
    return type === 'all' ? stmt.all() : stmt.all(type);
  };
  const stockReport = () => db.prepare('SELECT name,article_number,barcode,size,colour,stock,minimum_stock,wholesale_price_paise AS sale_price_paise FROM products ORDER BY name COLLATE NOCASE').all();
  const dashboard = () => ({
    todaySales: db.prepare("SELECT COALESCE(SUM(total_paise),0) AS n FROM transactions WHERE type='sale' AND status='posted' AND date(invoice_date)=date('now','localtime')").get().n,
    todayPurchases: db.prepare("SELECT COALESCE(SUM(total_paise),0) AS n FROM transactions WHERE type='purchase' AND status='posted' AND date(invoice_date)=date('now','localtime')").get().n,
    products: db.prepare('SELECT COUNT(*) AS n FROM products').get().n,
    stock: db.prepare('SELECT COALESCE(SUM(stock),0) AS n FROM products').get().n,
    lowStock: db.prepare('SELECT COUNT(*) AS n FROM products WHERE stock<=minimum_stock').get().n,
    customers: db.prepare("SELECT COUNT(*) AS n FROM parties WHERE type IN ('customer','both')").get().n,
    suppliers: db.prepare("SELECT COUNT(*) AS n FROM parties WHERE type IN ('supplier','both')").get().n
  });
  const getInvoice = id => {
    const header = db.prepare('SELECT t.*,p.name AS party_name,p.address AS party_address,p.gstin AS party_gstin FROM transactions t LEFT JOIN parties p ON p.id=t.party_id WHERE t.id=?').get(id);
    if (!header) return null;
    header.lines = db.prepare('SELECT * FROM transaction_lines WHERE transaction_id=?').all(id);
    return header;
  };
  return { db, backup: dest => db.backup(dest), listProducts, addProduct, listParties, addParty, createTransaction, listTransactions, stockReport, dashboard, getInvoice };
}
module.exports = { openDatabase };
