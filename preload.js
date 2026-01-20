// preload.js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("TPV_PRINT", {
  listPrinters: () => ipcRenderer.invoke("printers:list"),
  printTicket: ({ html, deviceName }) =>
    ipcRenderer.invoke("ticket:print", { html, deviceName }),
  printRaw: ({ bytes, deviceName }) =>
    ipcRenderer.invoke("ticket:printRaw", { bytes, deviceName }),
  openCashDrawer: async (deviceName) => {
    return await ipcRenderer.invoke("tpv:openCashDrawer", { deviceName });
  },
});

contextBridge.exposeInMainWorld("TPV_APP", {
  getGuards: () => ipcRenderer.invoke("tpv:getGuards"),
  attemptQuit: () => ipcRenderer.invoke("tpv:attemptQuit"),
});

contextBridge.exposeInMainWorld("TPV_UI", {
  onGuard: (cb) => ipcRenderer.on("tpv:guard", (_e, payload) => cb(payload)),
});

contextBridge.exposeInMainWorld("TPV_QUEUE", {
  enqueue: (item) => ipcRenderer.invoke("queue:enqueue", item),
  count: () => ipcRenderer.invoke("queue:count"),
  next: () => ipcRenderer.invoke("queue:next"),
  done: (id, remote) => ipcRenderer.invoke("queue:done", { id, remote }),
  error: (id, error) => ipcRenderer.invoke("queue:error", { id, error }),
  list: () => ipcRenderer.invoke("queue:list"), // ✅ NUEVO
});

contextBridge.exposeInMainWorld("TPV_SYS", {
  quit: () => ipcRenderer.invoke("app:quit"),
});

contextBridge.exposeInMainWorld("TPV_SETUP", {
  setupPosPrinter: () => ipcRenderer.invoke("setup:posPrinter"),
  testPosPrinter: () => ipcRenderer.invoke("setup:testPosPrinter"),
});

contextBridge.exposeInMainWorld("TPV_ENV", {
  platform: process.platform, // "linux" / "win32"
});
