// preload.js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("TPV_PRINT", {
  listPrinters: () => ipcRenderer.invoke("printers:list"),
  printTicket: ({ html, deviceName }) =>
    ipcRenderer.invoke("ticket:print", { html, deviceName }),
});

contextBridge.exposeInMainWorld("TPV_APP", {
  getGuards: () => ipcRenderer.invoke("tpv:getGuards"),
});

contextBridge.exposeInMainWorld("TPV_UI", {
  onGuard: (cb) => ipcRenderer.on("tpv:guard", (_e, payload) => cb(payload)),
});
