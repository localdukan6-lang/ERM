# Textile & Garments ERP — offline Windows starter

Electron/Node.js desktop application using a local SQLite database. This repository is under active development; it is **not yet a complete or production-certified ERP**.

## Run on Windows

Install Node.js LTS, clone this repository, then run `npm install` and `npm start` in PowerShell. Build an NSIS installer with `npm run dist:win`. Initial dependency download/build may need Internet; normal app usage is local/offline.

## Current implemented scope

- Product variants, size/colour, barcode lookup and barcode label printing.
- Customer/supplier contact records.
- Basic purchases and sales that update product stock.
- Basic invoice PDF, stock Excel export and manual SQLite backup.
- Added operational services for multiple godowns/racks, godown balances, stock transfers, stock adjustments, purchase/sales returns against original documents, invoice payment allocation, party outstanding/ledger data, expenses and backup restore with a pre-restore safety copy.
- Electron renderer isolation and allowlisted IPC.

## Important gaps and limitations

This is still not the complete requirement set. GST tax calculation and compliant invoice formats, double-entry accounting, fully integrated payment/return accounting, login/user permissions and audit UI, dashboard profit and product movement analysis, carton/packing workflows, comprehensive reports/export, automatic scheduled backups, extensive validation, automated tests, and Windows hardware acceptance tests remain to be completed. The current UI does not expose every added service yet. Do not use this as a production accounting/tax system without further implementation, testing, backups, and professional review.

Returns update inventory and outstanding calculations but do not yet create a full GST credit note/refund journal. The starter schema's opening balance semantics are simplified. Restore should be tested on sample copies before any business data is used.
