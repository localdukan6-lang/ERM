const crypto = require('node:crypto');

const money = (value, label = 'Amount') => {
  const n = Math.round(Number(value || 0) * 100);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${label} must be a non-negative amount.`);
  return n;
};
const text = (value, label, max = 160) => {
  const result = String(value ?? '').trim();
  if (!result || result.length > max) throw new Error(`${label} is required (maximum ${max} characters).`);
  return result;
};
const positiveInt = (value, label = 'Quantity') => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${label} must be a positive whole number.`);
  return n;
};
const documentNo = prefix => `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

function attach(base) {
  const db = base.db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS godowns (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, address TEXT NOT NULL DEFAULT '', is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS racks (
      id INTEGER PRIMARY KEY, godown_id INTEGER NOT NULL REFERENCES godowns(id), code TEXT NOT NULL,
      shelf TEXT NOT NULL DEFAULT '', UNIQUE(godown_id, code, shelf)
    );
    CREATE TABLE IF NOT EXISTS godown_stock (
      godown_id INTEGER NOT NULL REFERENCES godowns(id), product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0), PRIMARY KEY(godown_id, product_id)
    );
    CREATE TABLE IF NOT EXISTS warehouse_movements (
      id INTEGER PRIMARY KEY, godown_id INTEGER NOT NULL REFERENCES godowns(id), product_id INTEGER NOT NULL REFERENCES products(id),
      quantity_delta INTEGER NOT NULL, movement_type TEXT NOT NULL, source_id INTEGER, note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY, document_number TEXT NOT NULL UNIQUE, party_id INTEGER NOT NULL REFERENCES parties(id),
      direction TEXT NOT NULL CHECK(direction IN ('receipt','supplier_payment')), amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
      payment_date TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'cash', reference TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS payment_allocations (
      id INTEGER PRIMARY KEY, payment_id INTEGER NOT NULL REFERENCES payments(id), transaction_id INTEGER NOT NULL REFERENCES transactions(id),
      amount_paise INTEGER NOT NULL CHECK(amount_paise > 0), UNIQUE(payment_id, transaction_id)
    );
    CREATE TABLE IF NOT EXISTS returns (
      id INTEGER PRIMARY KEY, document_number TEXT NOT NULL UNIQUE, type TEXT NOT NULL CHECK(type IN ('sales_return','purchase_return')),
      original_transaction_id INTEGER NOT NULL REFERENCES transactions(id), party_id INTEGER REFERENCES parties(id),
      godown_id INTEGER NOT NULL REFERENCES godowns(id), reason TEXT NOT NULL DEFAULT '', total_paise INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS return_lines (
      id INTEGER PRIMARY KEY, return_id INTEGER NOT NULL REFERENCES returns(id), product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL CHECK(quantity > 0), unit_price_paise INTEGER NOT NULL, line_total_paise INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stock_adjustments (
      id INTEGER PRIMARY KEY, document_number TEXT NOT NULL UNIQUE, godown_id INTEGER NOT NULL REFERENCES godowns(id),
      reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS stock_transfers (
      id INTEGER PRIMARY KEY, document_number TEXT NOT NULL UNIQUE, from_godown_id INTEGER NOT NULL REFERENCES godowns(id),
      to_godown_id INTEGER NOT NULL REFERENCES godowns(id), note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK(from_godown_id <> to_godown_id)
    );
    CREATE TABLE IF NOT EXISTS stock_documents_lines (
      id INTEGER PRIMARY KEY, document_type TEXT NOT NULL CHECK(document_type IN ('adjustment','transfer')),
      document_id INTEGER NOT NULL, product_id INTEGER NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL CHECK(quantity > 0)
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY, document_number TEXT NOT NULL UNIQUE, expense_date TEXT NOT NULL,
      category TEXT NOT NULL, amount_paise INTEGER NOT NULL CHECK(amount_paise > 0), payment_mode TEXT NOT NULL DEFAULT 'cash',
      note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_payments_party_date ON payments(party_id, payment_date);
    CREATE INDEX IF NOT EXISTS idx_returns_transaction ON returns(original_transaction_id);
    CREATE INDEX IF NOT EXISTS idx_warehouse_movements_product ON warehouse_movements(product_id, godown_id);
  `);

  db.prepare("INSERT OR IGNORE INTO godowns(name,address) VALUES('Main Warehouse','')").run();
  const defaultGodownId = db.prepare("SELECT id FROM godowns WHERE name='Main Warehouse'").get().id;
  // Existing starter stock is assigned to the default warehouse once, preserving prior data.
  db.prepare(`INSERT OR IGNORE INTO godown_stock(godown_id,product_id,quantity)
    SELECT ?, id, stock FROM products`).run(defaultGodownId);
  db.prepare(`INSERT INTO warehouse_movements(godown_id,product_id,quantity_delta,movement_type,note)
    SELECT ?, p.id, p.stock, 'opening', 'Migrated existing local stock'
    FROM products p WHERE p.stock > 0 AND NOT EXISTS (
      SELECT 1 FROM warehouse_movements w WHERE w.product_id=p.id AND w.godown_id=?
    )`).run(defaultGodownId, defaultGodownId);

  function addProduct(input) {
    const result = base.addProduct(input);
    const row = db.prepare('SELECT stock FROM products WHERE id=?').get(result.id);
    const godownId = Number(input.godownId || defaultGodownId);
    if (!db.prepare('SELECT id FROM godowns WHERE id=? AND is_active=1').get(godownId)) throw new Error('Selected godown does not exist.');
    db.prepare('INSERT INTO godown_stock(godown_id,product_id,quantity) VALUES(?,?,?) ON CONFLICT(godown_id,product_id) DO UPDATE SET quantity=excluded.quantity')
      .run(godownId, result.id, row.stock);
    if (row.stock > 0) db.prepare('INSERT INTO warehouse_movements(godown_id,product_id,quantity_delta,movement_type,note) VALUES(?,?,?,\'opening\',\'Opening stock\')').run(godownId, result.id, row.stock);
    return result;
  }
  function listGodowns() {
    return db.prepare('SELECT g.*, (SELECT COUNT(*) FROM racks r WHERE r.godown_id=g.id) AS rack_count FROM godowns g ORDER BY g.name').all();
  }
  function addGodown(input) {
    return { id: Number(db.prepare('INSERT INTO godowns(name,address) VALUES(?,?)').run(text(input.name, 'Godown name'), String(input.address || '').trim()).lastInsertRowid) };
  }
  function addRack(input) {
    const godownId = positiveInt(input.godownId, 'Godown');
    return { id: Number(db.prepare('INSERT INTO racks(godown_id,code,shelf) VALUES(?,?,?)').run(godownId, text(input.code, 'Rack code', 50), String(input.shelf || '').trim()).lastInsertRowid) };
  }
  function listGodownStock(godownId) {
    const where = godownId ? 'WHERE g.id=?' : '';
    return godownId
      ? db.prepare(`SELECT g.name AS godown,p.id AS product_id,p.name,p.article_number,p.barcode,p.size,p.colour,s.quantity FROM godown_stock s JOIN godowns g ON g.id=s.godown_id JOIN products p ON p.id=s.product_id ${where} ORDER BY g.name,p.name`).all(Number(godownId))
      : db.prepare(`SELECT g.name AS godown,p.id AS product_id,p.name,p.article_number,p.barcode,p.size,p.colour,s.quantity FROM godown_stock s JOIN godowns g ON g.id=s.godown_id JOIN products p ON p.id=s.product_id ORDER BY g.name,p.name`).all();
  }
  function createAdjustment(input) {
    const godownId = positiveInt(input.godownId, 'Godown');
    const reason = text(input.reason, 'Adjustment reason', 250);
    if (!Array.isArray(input.lines) || !input.lines.length) throw new Error('Add at least one product.');
    return db.transaction(() => {
      const gid = db.prepare('SELECT id FROM godowns WHERE id=? AND is_active=1').get(godownId);
      if (!gid) throw new Error('Godown not found.');
      const doc = documentNo('ADJ');
      const header = db.prepare('INSERT INTO stock_adjustments(document_number,godown_id,reason) VALUES(?,?,?)').run(doc,godownId,reason);
      const id = Number(header.lastInsertRowid);
      for (const line of input.lines) {
        const product = db.prepare('SELECT id,stock,name FROM products WHERE barcode=?').get(text(line.barcode,'Barcode',80));
        if (!product) throw new Error(`Unknown barcode: ${line.barcode}`);
        const delta = Number(line.quantityDelta);
        if (!Number.isSafeInteger(delta) || delta === 0) throw new Error('Adjustment quantity must be a non-zero whole number.');
        const current = db.prepare('SELECT quantity FROM godown_stock WHERE godown_id=? AND product_id=?').get(godownId,product.id)?.quantity || 0;
        if (current + delta < 0 || product.stock + delta < 0) throw new Error(`Adjustment would make ${product.name} stock negative.`);
        db.prepare('INSERT INTO godown_stock(godown_id,product_id,quantity) VALUES(?,?,?) ON CONFLICT(godown_id,product_id) DO UPDATE SET quantity=quantity+excluded.quantity').run(godownId,product.id,delta);
        db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(delta,product.id);
        db.prepare('INSERT INTO stock_movements(product_id,type,quantity_delta) VALUES(?,?,?)').run(product.id,'adjustment',delta);
        db.prepare('INSERT INTO warehouse_movements(godown_id,product_id,quantity_delta,movement_type,source_id,note) VALUES(?,?,?,?,?,?)').run(godownId,product.id,delta,'adjustment',id,reason);
        db.prepare("INSERT INTO stock_documents_lines(document_type,document_id,product_id,quantity) VALUES('adjustment',?,?,?)").run(id,product.id,Math.abs(delta));
      }
      return {id, documentNumber:doc};
    })();
  }
  function createTransfer(input) {
    const from = positiveInt(input.fromGodownId, 'Source godown');
    const to = positiveInt(input.toGodownId, 'Destination godown');
    if (from === to) throw new Error('Choose two different godowns.');
    if (!Array.isArray(input.lines) || !input.lines.length) throw new Error('Add at least one product.');
    return db.transaction(() => {
      if (!db.prepare('SELECT id FROM godowns WHERE id=? AND is_active=1').get(from) || !db.prepare('SELECT id FROM godowns WHERE id=? AND is_active=1').get(to)) throw new Error('Godown not found.');
      const doc = documentNo('TRF');
      const id = Number(db.prepare('INSERT INTO stock_transfers(document_number,from_godown_id,to_godown_id,note) VALUES(?,?,?,?)').run(from,to,String(input.note||'').trim()).lastInsertRowid);
      for (const line of input.lines) {
        const product = db.prepare('SELECT id,name FROM products WHERE barcode=?').get(text(line.barcode,'Barcode',80));
        if (!product) throw new Error(`Unknown barcode: ${line.barcode}`);
        const qty = positiveInt(line.quantity);
        const source = db.prepare('SELECT quantity FROM godown_stock WHERE godown_id=? AND product_id=?').get(from,product.id)?.quantity || 0;
        if (source < qty) throw new Error(`Insufficient ${product.name} stock in source godown. Available: ${source}`);
        db.prepare('UPDATE godown_stock SET quantity=quantity-? WHERE godown_id=? AND product_id=?').run(qty,from,product.id);
        db.prepare('INSERT INTO godown_stock(godown_id,product_id,quantity) VALUES(?,?,?) ON CONFLICT(godown_id,product_id) DO UPDATE SET quantity=quantity+excluded.quantity').run(to,product.id,qty);
        db.prepare('INSERT INTO warehouse_movements(godown_id,product_id,quantity_delta,movement_type,source_id,note) VALUES(?,?,?,\'transfer_out\',?,?)').run(from,product.id,-qty,id,String(input.note||''));
        db.prepare('INSERT INTO warehouse_movements(godown_id,product_id,quantity_delta,movement_type,source_id,note) VALUES(?,?,?,\'transfer_in\',?,?)').run(to,product.id,qty,id,String(input.note||''));
        db.prepare("INSERT INTO stock_documents_lines(document_type,document_id,product_id,quantity) VALUES('transfer',?,?,?)").run(id,product.id,qty);
      }
      return {id,documentNumber:doc};
    })();
  }
  function createReturn(input) {
    const originalId = positiveInt(input.transactionId, 'Original transaction');
    const godownId = positiveInt(input.godownId || defaultGodownId, 'Godown');
    if (!Array.isArray(input.lines) || !input.lines.length) throw new Error('Add at least one return line.');
    return db.transaction(() => {
      const original = db.prepare('SELECT * FROM transactions WHERE id=? AND status=\'posted\'').get(originalId);
      if (!original) throw new Error('Original posted transaction not found.');
      const expected = input.type === 'sales_return' ? 'sale' : 'purchase';
      if (original.type !== expected) throw new Error('Return type does not match the original transaction.');
      const returnType = input.type;
      if (!['sales_return','purchase_return'].includes(returnType)) throw new Error('Invalid return type.');
      const doc = documentNo(returnType === 'sales_return' ? 'SRET' : 'PRET');
      const id = Number(db.prepare('INSERT INTO returns(document_number,type,original_transaction_id,party_id,godown_id,reason,total_paise) VALUES(?,?,?,?,?,?,0)').run(doc,returnType,originalId,original.party_id,godownId,String(input.reason||'').trim()).lastInsertRowid);
      let total = 0;
      for (const line of input.lines) {
        const product = db.prepare('SELECT * FROM products WHERE barcode=?').get(text(line.barcode,'Barcode',80));
        if (!product) throw new Error(`Unknown barcode: ${line.barcode}`);
        const originalLine = db.prepare('SELECT COALESCE(SUM(quantity),0) AS quantity, MIN(unit_price_paise) AS price FROM transaction_lines WHERE transaction_id=? AND product_id=?').get(originalId,product.id);
        const prior = db.prepare('SELECT COALESCE(SUM(rl.quantity),0) AS quantity FROM return_lines rl JOIN returns r ON r.id=rl.return_id WHERE r.original_transaction_id=? AND rl.product_id=?').get(originalId,product.id).quantity;
        const qty = positiveInt(line.quantity);
        if (originalLine.quantity - prior < qty) throw new Error(`Return quantity exceeds remaining purchased/sold quantity for ${product.name}.`);
        if (returnType === 'purchase_return' && product.stock < qty) throw new Error(`Insufficient total stock to return ${product.name} to supplier.`);
        const price = Number(originalLine.price || 0);
        const lineTotal = price * qty; total += lineTotal;
        db.prepare('INSERT INTO return_lines(return_id,product_id,quantity,unit_price_paise,line_total_paise) VALUES(?,?,?,?,?)').run(id,product.id,qty,price,lineTotal);
        const delta = returnType === 'sales_return' ? qty : -qty;
        const current = db.prepare('SELECT quantity FROM godown_stock WHERE godown_id=? AND product_id=?').get(godownId,product.id)?.quantity || 0;
        if (current + delta < 0) throw new Error(`Insufficient stock in selected godown for ${product.name}.`);
        db.prepare('INSERT INTO godown_stock(godown_id,product_id,quantity) VALUES(?,?,?) ON CONFLICT(godown_id,product_id) DO UPDATE SET quantity=quantity+excluded.quantity').run(godownId,product.id,delta);
        db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(delta,product.id);
        db.prepare('INSERT INTO stock_movements(product_id,type,quantity_delta) VALUES(?,?,?)').run(product.id,returnType,delta);
        db.prepare('INSERT INTO warehouse_movements(godown_id,product_id,quantity_delta,movement_type,source_id,note) VALUES(?,?,?,?,?,?)').run(godownId,product.id,delta,returnType,id,String(input.reason||''));
      }
      db.prepare('UPDATE returns SET total_paise=? WHERE id=?').run(total,id);
      return {id,documentNumber:doc,totalPaise:total};
    })();
  }
  function createPayment(input) {
    const partyId = positiveInt(input.partyId, 'Party');
    const amount = money(input.amount, 'Payment amount');
    if (!amount) throw new Error('Payment amount must be greater than zero.');
    const direction = input.direction;
    if (!['receipt','supplier_payment'].includes(direction)) throw new Error('Invalid payment direction.');
    if (!Array.isArray(input.allocations) || !input.allocations.length) throw new Error('Allocate payment to at least one invoice.');
    return db.transaction(() => {
      const party = db.prepare('SELECT * FROM parties WHERE id=?').get(partyId);
      if (!party) throw new Error('Party not found.');
      const doc = documentNo(direction === 'receipt' ? 'REC' : 'PAY');
      const id = Number(db.prepare('INSERT INTO payments(document_number,party_id,direction,amount_paise,payment_date,mode,reference,note) VALUES(?,?,?,?,?,?,?,?)').run(doc,partyId,direction,amount,String(input.paymentDate||new Date().toISOString().slice(0,10)),String(input.mode||'cash'),String(input.reference||''),String(input.note||'')).lastInsertRowid);
      let allocated = 0;
      for (const item of input.allocations) {
        const txId = positiveInt(item.transactionId, 'Invoice');
        const amountPart = money(item.amount, 'Allocation');
        const transaction = db.prepare('SELECT * FROM transactions WHERE id=? AND party_id=? AND status=\'posted\'').get(txId,partyId);
        const expectedType = direction === 'receipt' ? 'sale' : 'purchase';
        if (!transaction || transaction.type !== expectedType) throw new Error('Selected invoice does not belong to this party/payment type.');
        if (transaction.paid_paise + amountPart > transaction.total_paise) throw new Error(`Allocation exceeds outstanding on ${transaction.document_number}.`);
        db.prepare('UPDATE transactions SET paid_paise=paid_paise+? WHERE id=?').run(amountPart,txId);
        db.prepare('INSERT INTO payment_allocations(payment_id,transaction_id,amount_paise) VALUES(?,?,?)').run(id,txId,amountPart);
        allocated += amountPart;
      }
      if (allocated !== amount) throw new Error('Payment amount must equal the total allocated amount.');
      return {id,documentNumber:doc,amountPaise:amount};
    })();
  }
  function outstandingReport(type = 'all') {
    const parties = db.prepare(`SELECT p.id,p.name,p.type,p.opening_balance_paise,
      COALESCE((SELECT SUM(t.total_paise) FROM transactions t WHERE t.party_id=p.id AND t.status='posted' AND t.type='sale'),0) AS sales_paise,
      COALESCE((SELECT SUM(t.total_paise) FROM transactions t WHERE t.party_id=p.id AND t.status='posted' AND t.type='purchase'),0) AS purchases_paise,
      COALESCE((SELECT SUM(r.total_paise) FROM returns r WHERE r.party_id=p.id AND r.type='sales_return'),0) AS sales_returns_paise,
      COALESCE((SELECT SUM(r.total_paise) FROM returns r WHERE r.party_id=p.id AND r.type='purchase_return'),0) AS purchase_returns_paise,
      COALESCE((SELECT SUM(amount_paise) FROM payments x WHERE x.party_id=p.id AND x.direction='receipt'),0) AS receipts_paise,
      COALESCE((SELECT SUM(amount_paise) FROM payments x WHERE x.party_id=p.id AND x.direction='supplier_payment'),0) AS supplier_payments_paise
      FROM parties p ORDER BY p.name COLLATE NOCASE`).all();
    return parties.filter(p => type === 'all' || p.type === type || p.type === 'both').map(p => {
      const customerDue = p.opening_balance_paise + p.sales_paise - p.sales_returns_paise - p.receipts_paise;
      const supplierDue = p.opening_balance_paise + p.purchases_paise - p.purchase_returns_paise - p.supplier_payments_paise;
      return {...p, customer_due_paise: customerDue, supplier_due_paise: supplierDue};
    });
  }
  function partyLedger(partyId) {
    const party = db.prepare('SELECT id,name,type,opening_balance_paise FROM parties WHERE id=?').get(positiveInt(partyId,'Party'));
    if (!party) throw new Error('Party not found.');
    const transactions = db.prepare('SELECT id,document_number,type,invoice_date,total_paise,paid_paise FROM transactions WHERE party_id=? AND status=\'posted\' ORDER BY invoice_date,id').all(partyId);
    const payments = db.prepare('SELECT document_number,direction,amount_paise,payment_date,mode FROM payments WHERE party_id=? ORDER BY payment_date,id').all(partyId);
    const returns = db.prepare('SELECT document_number,type,total_paise,created_at FROM returns WHERE party_id=? ORDER BY id').all(partyId);
    return {party,transactions,payments,returns};
  }
  function createExpense(input) {
    const amount = money(input.amount,'Expense amount');
    if (!amount) throw new Error('Expense amount must be greater than zero.');
    const doc = documentNo('EXP');
    const id = Number(db.prepare('INSERT INTO expenses(document_number,expense_date,category,amount_paise,payment_mode,note) VALUES(?,?,?,?,?,?)').run(doc,String(input.date||new Date().toISOString().slice(0,10)),text(input.category,'Expense category'),amount,String(input.mode||'cash'),String(input.note||'')).lastInsertRowid);
    return {id,documentNumber:doc};
  }
  function listExpenses() { return db.prepare('SELECT * FROM expenses ORDER BY expense_date DESC,id DESC LIMIT 500').all(); }
  function listPayments(partyId) {
    return partyId ? db.prepare('SELECT p.*,x.name AS party_name FROM payments p JOIN parties x ON x.id=p.party_id WHERE p.party_id=? ORDER BY p.payment_date DESC,p.id DESC LIMIT 500').all(Number(partyId)) : db.prepare('SELECT p.*,x.name AS party_name FROM payments p JOIN parties x ON x.id=p.party_id ORDER BY p.payment_date DESC,p.id DESC LIMIT 500').all();
  }
  function restoreFrom(file) {
    const check = require('better-sqlite3');
    const temp = new check(file, { readonly: true, fileMustExist: true });
    try {
      const integrity = temp.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') throw new Error('Backup database failed integrity check.');
      const tables = temp.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='products'").get();
      if (!tables) throw new Error('Selected file is not a Textile ERP database backup.');
    } finally { temp.close(); }
    db.close();
    require('node:fs').copyFileSync(file, db.name);
    return true;
  }
  return { defaultGodownId, addProduct, listGodowns, addGodown, addRack, listGodownStock, createAdjustment, createTransfer, createReturn, createPayment, outstandingReport, partyLedger, createExpense, listExpenses, listPayments, restoreFrom };
}
module.exports = { attach };
