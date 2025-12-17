// main.js
const { app, BrowserWindow, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");

let mainWin = null;

function createWindow() {
  const isDev = !app.isPackaged;

  mainWin = new BrowserWindow({
    width: 1366,
    height: 768,
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      sandbox: false,
      devTools: isDev,
    },
  });
  mainWin.removeMenu();
  mainWin.loadFile(path.join(__dirname, "index.html"));
  /*mainWin.webContents.openDevTools();*/
}

async function createHiddenPrintWindow(html) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
    },
  });

  // Cargamos el HTML como data URL
  const dataUrl = "data:text/html;charset=utf-8," + encodeURIComponent(html);
  await win.loadURL(dataUrl);

  return win;
}

// --- IPC: listado de impresoras ---
ipcMain.handle("printers:list", async () => {
  const w = BrowserWindow.getFocusedWindow() || mainWin;
  if (!w) return [];
  const printers = await w.webContents.getPrintersAsync();
  // Devolvemos solo lo que necesitamos
  return printers.map((p) => ({
    name: p.name,
    displayName: p.displayName || p.name,
    isDefault: !!p.isDefault,
    status: p.status || 0,
  }));
});

// --- IPC: imprimir silencioso en una impresora concreta ---
ipcMain.handle("ticket:print", async (event, { html, deviceName }) => {
  if (!html) return { ok: false, error: "Falta html" };
  if (!deviceName) return { ok: false, error: "Falta deviceName" };

  let win = null;
  try {
    win = await createHiddenPrintWindow(html);

    const result = await new Promise((resolve) => {
      win.webContents.print(
        {
          silent: true,
          deviceName,
          printBackground: true,
        },
        (success, failureReason) => {
          if (!success) {
            resolve({
              ok: false,
              error: failureReason || "No se pudo imprimir",
            });
          } else {
            resolve({ ok: true });
          }
        }
      );
    });

    return result;
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  } finally {
    if (win) {
      // Cerramos la ventana oculta sí o sí
      try {
        win.close();
      } catch (_) {}
    }
  }
});

function initAutoUpdates() {
  // Solo en app instalada / empaquetada
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;

  autoUpdater.on("error", (err) => {
    console.log("AutoUpdate error:", err);
  });

  autoUpdater.on("update-available", () => {
    console.log("Update available: downloading...");
  });

  autoUpdater.on("update-downloaded", () => {
    console.log("Update downloaded: installing...");
    // Instala y reinicia
    autoUpdater.quitAndInstall();
  });

  // Chequea al iniciar
  autoUpdater.checkForUpdatesAndNotify();
}

app.whenReady().then(() => {
  createWindow();
  initAutoUpdates();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
