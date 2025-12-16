// preload.js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("TPV_PRINT", {
  listPrinters: () => ipcRenderer.invoke("printers:list"),
  printTicket: ({ html, deviceName }) =>
    ipcRenderer.invoke("ticket:print", { html, deviceName }),
});
