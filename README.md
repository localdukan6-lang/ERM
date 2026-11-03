# Textile & Garments ERP (offline desktop starter)

Windows desktop starter built with Electron, Node.js and local SQLite. The app does not require a server or Internet connection at runtime. Database location is Electron's per-user application data folder (`textile-erp.sqlite`); it is deliberately not stored beside the installed program.

## Run on Windows

1. Install Node.js LTS and Git (only needed to install/build the app).
2. In this folder run:

   ```powershell
   npm install
   npm start
   ```

   `better-sqlite3` is a native module; npm's `postinstall` rebuilds it for the installed Electron version. Internet may be needed for the initial npm dependency download. Once installed, normal app use is offline.

3. Build a Windows installer:

   ```powershell
   npm run dist:win
   ```

   Installer output is written to `release/`.

## Implemented in this starter

- Desktop Electron window with isolated renderer and restricted preload IPC.
- Local SQLite database and schema creation on first launch.
- Product variants with size, colour, article, barcode, HSN, GST rate and prices.
- Customer/supplier contact records.
- Basic purchase and sales posting with atomic stock updates and movement history.
- Stock/dashboard views, transaction history, PDF invoice export, stock XLSX export, Code 128 barcode label printing and manual SQLite backup.
- USB barcode scanners that emulate keyboard input (HID mode).

## Not yet implemented: do not use as a complete production ERP

This starter is not the complete requirements document implementation. It does not yet include GST tax calculation/compliant tax invoices, payment allocation and accounting ledgers, customer/supplier outstanding calculations, returns, godowns/racks/transfers, carton packing, stock counts/adjustments, user login/permissions/audit UI, automatic backup/restore, dashboard profit/fast-moving reports, or a full invoice/label designer. PDF output is a basic invoice and must be reviewed/customized. Validate tax and accounting behavior with a qualified professional before business use. Use backups and test on sample data before production.

## Data safety

The app creates data under Electron `app.getPath('userData')`. Use **Create Backup** to choose a destination. Keep backups on a different drive and test restoring them separately; this version has backup creation but no in-app restore workflow. Never delete the database while the app is running.
