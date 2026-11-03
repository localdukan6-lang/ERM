const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('erp', Object.freeze({
  dashboard: () => ipcRenderer.invoke('dashboard:get'),
  listProducts: q => ipcRenderer.invoke('products:list', q),
  addProduct: data => ipcRenderer.invoke('products:add', data),
  listParties: type => ipcRenderer.invoke('parties:list', type),
  addParty: data => ipcRenderer.invoke('parties:add', data),
  listTransactions: type => ipcRenderer.invoke('transactions:list', type),
  createTransaction: data => ipcRenderer.invoke('transactions:create', data),
  stockReport: () => ipcRenderer.invoke('reports:stock'),
  exportExcel: () => ipcRenderer.invoke('reports:excel'),
  createBackup: () => ipcRenderer.invoke('backup:create'),
  barcodePng: value => ipcRenderer.invoke('barcode:png', value),
  invoicePdf: id => ipcRenderer.invoke('invoice:pdf', id)
}));
