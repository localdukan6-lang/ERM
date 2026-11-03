const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('erp', Object.freeze({
  dashboard:()=>ipcRenderer.invoke('dashboard:get'),listProducts:q=>ipcRenderer.invoke('products:list',q),addProduct:data=>ipcRenderer.invoke('products:add',data),
  listParties:type=>ipcRenderer.invoke('parties:list',type),addParty:data=>ipcRenderer.invoke('parties:add',data),listTransactions:type=>ipcRenderer.invoke('transactions:list',type),createTransaction:data=>ipcRenderer.invoke('transactions:create',data),
  stockReport:()=>ipcRenderer.invoke('reports:stock'),exportExcel:()=>ipcRenderer.invoke('reports:excel'),createBackup:()=>ipcRenderer.invoke('backup:create'),restoreBackup:()=>ipcRenderer.invoke('backup:restore'),
  barcodePng:value=>ipcRenderer.invoke('barcode:png',value),invoicePdf:id=>ipcRenderer.invoke('invoice:pdf',id),
  listGodowns:()=>ipcRenderer.invoke('godowns:list'),addGodown:data=>ipcRenderer.invoke('godowns:add',data),addRack:data=>ipcRenderer.invoke('racks:add',data),godownStock:id=>ipcRenderer.invoke('godowns:stock',id),
  adjustStock:data=>ipcRenderer.invoke('stock:adjust',data),transferStock:data=>ipcRenderer.invoke('stock:transfer',data),createReturn:data=>ipcRenderer.invoke('returns:create',data),
  createPayment:data=>ipcRenderer.invoke('payments:create',data),listPayments:id=>ipcRenderer.invoke('payments:list',id),outstanding:type=>ipcRenderer.invoke('parties:outstanding',type),ledger:id=>ipcRenderer.invoke('parties:ledger',id),
  createExpense:data=>ipcRenderer.invoke('expenses:create',data),listExpenses:()=>ipcRenderer.invoke('expenses:list')
}));
