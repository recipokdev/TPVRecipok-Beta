// main.js
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

let mainWin = null;
let splashWin = null;

function queueFilePath() {
  return path.join(app.getPath("userData"), "sync-queue.json");
}

function readQueue() {
  try {
    const p = queueFilePath();
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, "utf8")) || [];
  } catch {
    return [];
  }
}

function writeQueue(items) {
  const p = queueFilePath();
  fs.writeFileSync(p, JSON.stringify(items, null, 2), "utf8");
}

function createWindow() {
  const isDev = !app.isPackaged;

  mainWin = new BrowserWindow({
    fullscreen: true,
    kiosk: true,
    autoHideMenuBar: true,
    alwaysOnTop: true,
    width: 1366,
    height: 768,
    show: false,
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      sandbox: false,
      devTools: isDev,
    },
  });

  mainWin.removeMenu();

  // ✅ Bloquear cierre con la X si hay caja abierta o tickets aparcados
  let allowMainClose = false;

  mainWin.on("close", async (e) => {
    if (allowMainClose) return;

    e.preventDefault();

    // Leemos estado desde el renderer
    let guards = { cashOpen: false, parkedCount: 0 };
    try {
      guards = await mainWin.webContents.executeJavaScript(
        "window.__TPV_GUARDS__ && window.__TPV_GUARDS__()"
      );
      guards = guards || { cashOpen: false, parkedCount: 0 };
    } catch (_) {}

    async function showGuardInRenderer(title, text) {
      try {
        // le mandamos evento al renderer para que muestre el modal bonito
        mainWin.webContents.send("tpv:guard", { title, text });

        // pequeña espera para que el usuario lo vea (y no “parezca” que no pasa nada)
        // no bloquea el hilo; solo esperamos aquí antes de devolver
        await new Promise((r) => setTimeout(r, 50));
        return true;
      } catch (_) {
        return false;
      }
    }

    // 1) Caja abierta -> NO cerrar
    if (guards.cashOpen) {
      await showGuardInRenderer(
        "Terminal abierta",
        "No puedes cerrar el programa hasta que cierres la caja."
      );
      return;
    }

    // 2) Tickets aparcados -> NO cerrar
    if ((guards.parkedCount || 0) > 0) {
      await showGuardInRenderer(
        "Tickets aparcados",
        "No puedes cerrar el programa hasta recuperar o eliminar los tickets aparcados."
      );
      return;
    }

    // ✅ Si todo OK, permitir cierre
    allowMainClose = true;
    mainWin.close();
  });

  // Logs útiles si algo falla en producción
  mainWin.webContents.on(
    "did-fail-load",
    (event, errorCode, errorDescription, validatedURL) => {
      console.log("did-fail-load:", {
        errorCode,
        errorDescription,
        validatedURL,
      });
      // Si falla cargar, igualmente mostramos la ventana para ver algo
      if (!mainWin.isVisible()) mainWin.show();
    }
  );

  /*  Uncomment para abrir DevTools o consola siempre
   */
  mainWin.webContents.openDevTools();

  mainWin.webContents.on("render-process-gone", (event, details) => {
    console.log("render-process-gone:", details);
  });

  mainWin.webContents.on(
    "console-message",
    (event, level, message, line, sourceId) => {
      console.log(
        `renderer console [${level}] ${message} (${sourceId}:${line})`
      );
    }
  );

  mainWin.loadFile(path.join(__dirname, "index.html")).catch((e) => {
    console.log("loadFile error:", e);
  });

  // Mostrar cuando esté lista, pero con “plan B”
  let shown = false;
  mainWin.once("ready-to-show", () => {
    shown = true;
    mainWin.show();
  });

  // Plan B: si en 2s no hubo ready-to-show, mostramos igual
  setTimeout(() => {
    if (!shown && mainWin && !mainWin.isDestroyed() && !mainWin.isVisible()) {
      mainWin.show();
    }
  }, 2000);
}

function createSplashWindow() {
  splashWin = new BrowserWindow({
    width: 520,
    height: 260,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    closable: true, // ✅ que el código pueda cerrarlo
    skipTaskbar: true, // ✅ no aparece en la barra
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
  let allowSplashClose = false;

  splashWin.on("close", (e) => {
    if (!allowSplashClose) e.preventDefault();
  });

  // guarda el flag a nivel global
  splashWin.__allowClose = () => {
    allowSplashClose = true;
  };

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
      // permite cerrar desde código
      if (typeof splashWin.__allowClose === "function")
        splashWin.__allowClose();
      splashWin.destroy(); // 👈 cierre forzado (no se queda pegado)
    } catch (_) {}
  }
  splashWin = null;
}

async function runAutoUpdateGate() {
  // En desarrollo no hacemos nada de updates
  if (!app.isPackaged) return { updatedOrReady: true };

  // Creamos splash
  createSplashWindow();
  splashSet("Buscando actualizaciones...", 20);

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

    // Watchdog: si GitHub tarda o se cuelga, abrimos igual
    const watchdog = setTimeout(() => {
      splashSet("Conexión lenta. Abriendo…", 40);
      setTimeout(() => {
        autoUpdater.removeListener("download-progress", onProgress);
        done({ updatedOrReady: true });
      }, 200);
    }, 15000);

    const finishOk = (msg, percent = 60, delay = 200) => {
      clearTimeout(watchdog);
      splashSet(msg, percent);
      setTimeout(() => {
        autoUpdater.removeListener("download-progress", onProgress);
        done({ updatedOrReady: true });
      }, delay);
    };

    autoUpdater.once("error", (err) => {
      console.log("AutoUpdate error:", err);
      clearTimeout(watchdog);
      splashSet("No se pudo comprobar. Abriendo…", 40);
      setTimeout(() => {
        autoUpdater.removeListener("download-progress", onProgress);
        done({ updatedOrReady: true });
      }, 300);
    });

    autoUpdater.once("update-not-available", () => {
      finishOk("Todo al día. Abriendo…", 60, 200);
    });

    autoUpdater.once("update-available", () => {
      clearTimeout(watchdog);
      splashSet("Actualización encontrada. Descargando…", 25);
    });

    const onProgress = (p) => {
      const pct = typeof p.percent === "number" ? p.percent : 0;
      splashSet("Descargando actualización…", pct);
    };
    autoUpdater.on("download-progress", onProgress);

    autoUpdater.once("update-downloaded", () => {
      splashSet("Instalando actualización…", 100);
      setTimeout(() => autoUpdater.quitAndInstall(true, true), 600);
    });

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

// --- IPC: obtener estado de guardias ---
ipcMain.handle("tpv:getGuards", async (event) => {
  try {
    // pide al renderer el estado
    const wc = event.sender;
    const guards = await wc.executeJavaScript(
      "window.__TPV_GUARDS__ && window.__TPV_GUARDS__()"
    );
    return guards || { cashOpen: false, parkedCount: 0 };
  } catch (e) {
    // si falla, por seguridad NO bloqueamos (o si quieres, sí bloqueas)
    return { cashOpen: false, parkedCount: 0 };
  }
});

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

if (process.platform === "linux") {
  // Evita el error del chrome-sandbox en AppImage en algunos Ubuntus
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-setuid-sandbox");
}

app.whenReady().then(async () => {
  await runAutoUpdateGate();

  createWindow(); // ✅ creas la ventana principal
  closeSplash(); // ✅ ahora ya puedes matar el splash sin que la app se cierre

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/*Abrir Cajon*/
function cashDrawerConfigPath() {
  return path.join(app.getPath("userData"), "cashdrawer.json");
}

function readCashDrawerConfig() {
  try {
    const p = cashDrawerConfigPath();
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeCashDrawerConfig(cfg) {
  try {
    fs.writeFileSync(
      cashDrawerConfigPath(),
      JSON.stringify(cfg, null, 2),
      "utf8"
    );
  } catch (_) {}
}

function escposOpenDrawerBuffer(pin = 0, t1 = 25, t2 = 250) {
  const m = pin === 1 ? 1 : 0;
  const a = Math.max(0, Math.min(255, Number(t1) || 25));
  const b = Math.max(0, Math.min(255, Number(t2) || 250));
  return Buffer.from([0x1b, 0x70, m, a, b]);
}

function listCashDrawerCandidatesLinux() {
  const out = new Set();

  // /dev/usb/lp0..lp15
  for (let i = 0; i < 16; i++) {
    const p = `/dev/usb/lp${i}`;
    if (fs.existsSync(p)) out.add(p);
  }

  // /dev/lp0..lp15 (algunas distros)
  for (let i = 0; i < 16; i++) {
    const p = `/dev/lp${i}`;
    if (fs.existsSync(p)) out.add(p);
  }

  return [...out];
}

async function tryWriteToDevice(devPath, buf) {
  return await new Promise((resolve) => {
    fs.open(devPath, "w", (err, fd) => {
      if (err) return resolve({ ok: false, error: err.message });
      fs.write(fd, buf, 0, buf.length, null, (err2) => {
        fs.close(fd, () => {});
        if (err2) return resolve({ ok: false, error: err2.message });
        resolve({ ok: true });
      });
    });
  });
}

ipcMain.handle("tpv:openCashDrawer", async (_event, { deviceName }) => {
  // Windows: deviceName = nombre impresora
  // Linux: deviceName opcional (si viene vacío, autodetecta)

  if (process.platform === "win32") {
    if (!deviceName) return { ok: false, error: "Falta deviceName" };

    const exePath = app.isPackaged
      ? path.join(process.resourcesPath, "assets", "open-drawer.exe")
      : path.join(__dirname, "assets", "open-drawer.exe");

    if (!fs.existsSync(exePath)) {
      return { ok: false, error: `No existe open-drawer.exe en: ${exePath}` };
    }

    const runPin = (pin) =>
      new Promise((resolve) => {
        execFile(
          exePath,
          [deviceName, String(pin)],
          { windowsHide: true },
          (err, stdout, stderr) => {
            if (err) {
              resolve({
                ok: false,
                pin,
                error: (stderr || err.message || String(err)).trim(),
              });
            } else {
              resolve({ ok: true, pin, out: (stdout || "").trim() });
            }
          }
        );
      });

    let r = await runPin(0);
    if (!r.ok) r = await runPin(1);
    return r;
  }

  if (process.platform === "linux") {
    // 1) Si ya guardamos un device válido para este cliente, probarlo primero
    const saved = readCashDrawerConfig();
    const preferred =
      saved?.device && fs.existsSync(saved.device) ? [saved.device] : [];

    // 2) Si el frontend nos pasó un device explícito, lo probamos
    const explicit =
      deviceName &&
      typeof deviceName === "string" &&
      deviceName.startsWith("/dev/")
        ? [deviceName]
        : [];

    // 3) Autodetección /dev/usb/lp*
    const candidates = [
      ...new Set([
        ...explicit,
        ...preferred,
        ...listCashDrawerCandidatesLinux(),
      ]),
    ];

    if (candidates.length === 0) {
      return {
        ok: false,
        error: "No se detectó /dev/usb/lp*. ¿Está conectado el cajón?",
      };
    }

    const tryPin = async (dev, pin) => {
      const buf = escposOpenDrawerBuffer(pin, 25, 250);
      const r = await tryWriteToDevice(dev, buf);
      return { ...r, dev, pin };
    };

    for (const dev of candidates) {
      // prueba pin 0 y luego pin 1
      let r = await tryPin(dev, 0);
      if (!r.ok) r = await tryPin(dev, 1);

      if (r.ok) {
        // Guardar para este cliente/instalación
        writeCashDrawerConfig({
          device: dev,
          lastOkAt: new Date().toISOString(),
        });
        return { ok: true, device: dev, pin: r.pin };
      }

      // si fue permiso denegado, damos pista útil
      if ((r.error || "").toLowerCase().includes("permission denied")) {
        return {
          ok: false,
          error:
            `Permiso denegado al abrir ${dev}. ` +
            `En Ubuntu esto se soluciona instalando el .deb (incluye regla udev).`,
        };
      }
    }

    return {
      ok: false,
      error: `No se pudo abrir el cajón probando: ${candidates.join(", ")}`,
    };
  }

  return { ok: false, error: `Sistema no soportado: ${process.platform}` };
});

/* Cola de sincronización */
ipcMain.handle("queue:enqueue", async (_e, item) => {
  const q = readQueue();
  q.push({
    id: crypto.randomUUID?.() || String(Date.now()) + "_" + Math.random(),
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: "pending",
    ...item,
  });
  writeQueue(q);
  return { ok: true, pending: q.filter((x) => x.status === "pending").length };
});

/* ver contador de items en cola */
ipcMain.handle("queue:count", async () => {
  const q = readQueue();
  const pending = q.filter((x) => x.status === "pending").length;
  const error = q.filter((x) => x.status === "error").length;
  return { pending, error, total: q.length };
});

/* listar items de cola (sin consumir) */
ipcMain.handle("queue:list", async () => {
  const q = readQueue();

  const pending = q
    .filter((x) => x.status === "pending" || x.status === "processing")
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

  const done = q
    .filter((x) => x.status === "done")
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

  const error = q
    .filter((x) => x.status === "error")
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

  return { pending, done, error, total: q.length };
});

/* obtener siguiente item pendiente y marcar resuelto*/
ipcMain.handle("queue:next", async () => {
  const q = readQueue();
  const now = Date.now();

  // 1) Si quedó algo en processing (crash / cierre), lo devolvemos a pending
  for (const it of q) {
    if (it.status === "processing") {
      it.status = "pending";
    }
  }

  // 2) Elegir el primer "pending" cuyo nextRetryAt ya haya pasado (o no exista)
  const idx = q.findIndex((x) => {
    if (x.status !== "pending") return false;
    if (!x.nextRetryAt) return true;
    return new Date(x.nextRetryAt).getTime() <= now;
  });

  if (idx === -1) {
    writeQueue(q);
    return { ok: true, item: null };
  }

  q[idx].status = "processing";
  q[idx].attempts = (q[idx].attempts || 0) + 1;
  q[idx].lastAttemptAt = new Date().toISOString();
  writeQueue(q);

  return { ok: true, item: q[idx] };
});

ipcMain.handle("queue:done", async (_e, { id, remote }) => {
  const q = readQueue();
  const idx = q.findIndex((x) => x.id === id);
  if (idx === -1) return { ok: false, error: "No existe item" };
  q[idx].status = "done";
  q[idx].remote = remote || null;
  writeQueue(q);
  return { ok: true };
});

ipcMain.handle("queue:error", async (_e, { id, error }) => {
  const q = readQueue();
  const idx = q.findIndex((x) => x.id === id);
  if (idx === -1) return { ok: false, error: "No existe item" };

  // reintentos: 1, 2, 5, 10 min
  const att = q[idx].attempts || 1;
  const delayMin = att <= 1 ? 1 : att === 2 ? 2 : att === 3 ? 5 : 10;

  q[idx].status = "pending"; // vuelve a pending para reintentar
  q[idx].lastError = String(error || "Error");
  q[idx].nextRetryAt = new Date(Date.now() + delayMin * 60000).toISOString();

  writeQueue(q);
  return { ok: true, nextRetryAt: q[idx].nextRetryAt };
});
