// main.js
const { app, BrowserWindow, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");

let mainWin = null;
let splashWin = null;

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
}

function createSplashWindow() {
  splashWin = new BrowserWindow({
    width: 520,
    height: 260,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    closable: false, // evita que el usuario lo cierre durante update
    show: false,
    alwaysOnTop: true,
    center: true,
    backgroundColor: "#111827",
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
    },
  });

  splashWin.removeMenu();

  // HTML inline sencillo con barra de progreso
  const html = `
  <!doctype html>
  <html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>TPV Recipok</title>
    <style>
      body{
        margin:0;
        font-family: Arial, Helvetica, sans-serif;
        background:#111827;
        color:#e5e7eb;
        display:flex;
        align-items:center;
        justify-content:center;
        height:100vh;
      }
      .box{
        width: 86%;
      }
      .title{
        font-size: 18px;
        font-weight: 700;
        margin-bottom: 10px;
      }
      .status{
        font-size: 14px;
        opacity: 0.9;
        margin-bottom: 16px;
        min-height: 18px;
      }
      .bar{
        width:100%;
        height:14px;
        background:#1f2937;
        border-radius:999px;
        overflow:hidden;
        border:1px solid rgba(255,255,255,0.08);
      }
      .fill{
        height:100%;
        width:0%;
        background:#22c55e;
        border-radius:999px;
        transition: width .2s ease;
      }
      .pct{
        margin-top: 10px;
        font-size: 13px;
        opacity: 0.85;
      }
      .hint{
        margin-top: 14px;
        font-size: 12px;
        opacity: 0.6;
      }
    </style>
  </head>
  <body>
    <div class="box">
      <div class="title">TPV Recipok</div>
      <div class="status" id="status">Buscando actualizaciones...</div>
      <div class="bar"><div class="fill" id="fill"></div></div>
      <div class="pct" id="pct">0%</div>
      <div class="hint">No cierres esta ventana.</div>

      <script>
        const set = (text, percent) => {
          const s = document.getElementById("status");
          const f = document.getElementById("fill");
          const p = document.getElementById("pct");
          if (typeof text === "string") s.textContent = text;
          if (typeof percent === "number") {
            const clamped = Math.max(0, Math.min(100, percent));
            f.style.width = clamped + "%";
            p.textContent = clamped.toFixed(0) + "%";
          }
        };

        // Recibimos mensajes desde el proceso principal
        window.addEventListener("message", (ev) => {
          if (!ev || !ev.data) return;
          const { text, percent } = ev.data;
          set(text, percent);
        });
      </script>
    </div>
  </body>
  </html>
  `;

  const dataUrl = "data:text/html;charset=utf-8," + encodeURIComponent(html);
  splashWin.loadURL(dataUrl);

  splashWin.once("ready-to-show", () => {
    splashWin.show();
  });

  return splashWin;
}

function splashSet(text, percent) {
  if (!splashWin || splashWin.isDestroyed()) return;
  splashWin.webContents
    .executeJavaScript(
      `window.postMessage(${JSON.stringify({ text, percent })}, "*");`
    )
    .catch(() => {});
}

function closeSplash() {
  if (splashWin && !splashWin.isDestroyed()) {
    try {
      splashWin.close();
    } catch (_) {}
  }
  splashWin = null;
}

async function runAutoUpdateGate() {
  // En desarrollo no hacemos nada de updates
  if (!app.isPackaged) return { updatedOrReady: true };

  // Creamos splash
  createSplashWindow();
  splashSet("Buscando actualizaciones...", 0);

  // Configuración
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  return await new Promise((resolve) => {
    let finished = false;
    const done = (result) => {
      if (finished) return;
      finished = true;
      resolve(result);
    };

    autoUpdater.once("error", (err) => {
      console.log("AutoUpdate error:", err);
      splashSet("No se pudo comprobar actualizaciones. Abriendo la app…", 0);
      setTimeout(() => done({ updatedOrReady: true }), 900);
    });

    autoUpdater.once("update-not-available", () => {
      splashSet("No hay actualizaciones. Abriendo…", 100);
      setTimeout(() => done({ updatedOrReady: true }), 600);
    });

    autoUpdater.once("update-available", () => {
      splashSet("Actualización encontrada. Descargando…", 0);
    });

    autoUpdater.on("download-progress", (p) => {
      // p.percent suele venir bien
      const pct = typeof p.percent === "number" ? p.percent : 0;
      splashSet("Descargando actualización…", pct);
    });

    autoUpdater.once("update-downloaded", () => {
      splashSet("Instalando actualización…", 100);

      // Instalación y relanzado automático
      setTimeout(() => {
        // quitAndInstall(isSilent, isForceRunAfter)
        autoUpdater.quitAndInstall(true, true);
        // no llamamos done porque la app se cerrará
      }, 600);
    });

    // IMPORTANTE: no usar checkForUpdatesAndNotify (muestra UI)
    autoUpdater.checkForUpdates();
  });
}

async function createHiddenPrintWindow(html) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
    },
  });

  const dataUrl = "data:text/html;charset=utf-8," + encodeURIComponent(html);
  await win.loadURL(dataUrl);
  return win;
}

// --- IPC: listado de impresoras ---
ipcMain.handle("printers:list", async () => {
  const w = BrowserWindow.getFocusedWindow() || mainWin;
  if (!w) return [];
  const printers = await w.webContents.getPrintersAsync();
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
        { silent: true, deviceName, printBackground: true },
        (success, failureReason) => {
          if (!success)
            resolve({
              ok: false,
              error: failureReason || "No se pudo imprimir",
            });
          else resolve({ ok: true });
        }
      );
    });

    return result;
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  } finally {
    if (win) {
      try {
        win.close();
      } catch (_) {}
    }
  }
});

app.whenReady().then(async () => {
  // 1) Gate de actualización (con splash y barra)
  await runAutoUpdateGate();

  // 2) Abrir app normal
  closeSplash();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
