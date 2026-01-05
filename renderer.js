// ===== Datos de ejemplo (fallback offline) =====
const demoCategories = [
  { id: "bebidas", name: "Bebidas", color: "#007bff" },
  { id: "bolleria", name: "Bollería", color: "#e67e22" },
  { id: "salados", name: "Salados", color: "#e74c3c" },
  { id: "varios", name: "Varios", color: "#16a085" },
];

const demoProducts = [
  { id: 1, name: "Coca Cola", price: 1.5, category: "bebidas" },
  { id: 2, name: "Agua", price: 1.0, category: "bebidas" },
  { id: 3, name: "Croissant", price: 1.2, category: "bolleria" },
  { id: 4, name: "Napolitana", price: 1.4, category: "bolleria" },
  { id: 5, name: "Empanadilla", price: 1.8, category: "salados" },
  { id: 6, name: "Bocadillo jamón", price: 3.0, category: "salados" },
  { id: 7, name: "Varios 1", price: 2.0, category: "varios" },
  { id: 8, name: "Varios 2", price: 2.5, category: "varios" },
];
// ===== Bootstrap de config global (evita modo demo por undefined) =====
window.RECIPOK_API = window.RECIPOK_API || {
  baseUrl: "", // ej: https://plus.recipok.com/SLUG/api/3
  apiKey: "", // token
  defaultCodClienteTPV: "1",
};

window.TPV_CONFIG = window.TPV_CONFIG || {
  // OBLIGATORIO: URL absoluta a tu clients.json (o al endpoint que lo devuelva)
  resolverUrl: "", // ej: https://tu-dominio.com/clients.json
};

// Estas son las que usará la app realmente (las podremos sobrescribir con la API)
let categories = []; // familias (incluye raíz + hijas)
let products = [];

// Mapa codimpuesto -> porcentaje real de IVA
let taxRatesByCode = {};

// Para saber si ya hemos pintado la UI principal
let mainUiRendered = false;

// Filtro actual
let selectedCategory = null; // id de familia simple
let activeFamilyParentId = null; // id de familia padre (para subfamilias)
let activeSubfamilyId = null; // id de subfamilia activa (hija)
let cart = [];
let searchTerm = "";

let lastTicket = null; // guardará el último ticket/factura creada para poder imprimirla

let parkedTickets = []; // cada item: { id, createdAt, items, total }
let parkedCounter = 0;
// Índice del ticket aparcado actualmente cargado en el carrito
let currentParkedTicketIndex = null;

// ===== TPVs, agentes y caja =====
let terminals = [];
let currentTerminal = null; // { id, name }

let agents = []; // todos los agentes únicos
let agentsByTerminal = {}; // { idTPV: [agentesDeEseTPV] }
let currentAgent = null; // { id, codagente, name }

let cashSession = {
  open: false,
  openedAt: null,

  // Apertura
  openingTotal: 0,
  openingBreakdown: [],

  // Cierre
  closingTotal: 0,
  closingBreakdown: [],

  // Estado actual de la caja
  currentCashBreakdown: [],

  // Totales de la sesión
  cashSalesTotal: 0, // Ingresos en efectivo
  cashMovementsTotal: 0,
  totalSales: 0,

  // 👇 NUEVO: resumen por forma de pago
  paymentsByMethod: {}, // { CONT: { code, label, total, count }, BIZUM: {...}, ... }
};

let cashDialogMode = "open"; // "open" (apertura) o "close" (cierre)
let terminalOverlayMode = "session"; // "session" (elegir tpv/agent para abrir caja) o "agentSwitch"

let apiBaseUrl = ""; // base de la API para montar URLs de imágenes
let filesBaseUrl = ""; // base sin /api/3 para los ficheros (MyFiles, etc.)

let qwertyMode = "text"; // "text" | "email"

let TPV_STATE = {
  locked: false, // cuenta desactivada (clients.json active:false)
  offline: false, // sin conexión / sin config / ping falló
};

// Estado para bloquear cierres
window.__TPV_GUARDS__ = () => {
  const cashOpen = !!(cashSession && cashSession.open);
  const parkedCount = Array.isArray(parkedTickets) ? parkedTickets.length : 0;

  return {
    cashOpen,
    parkedCount,
  };
};

// ===== Referencias básicas =====
const searchInput = document.getElementById("searchInput");
const searchClearBtn = document.getElementById("searchClearBtn");
const searchKeyboardBtn = document.getElementById("searchKeyboardBtn");

// Terminal / caja
const terminalNameEl = document.getElementById("terminalName");
const agentNameEl = document.getElementById("agentName");
const userNameEl = document.getElementById("userName");

// Overlay selección de terminal / agente
const terminalOverlay = document.getElementById("terminalOverlay");
const terminalSelect = document.getElementById("terminalSelect");
const terminalOkBtn = document.getElementById("terminalOkBtn");
const terminalExitBtn = document.getElementById("terminalExitBtn");
const terminalErrorEl = document.getElementById("terminalError");
const terminalSelectWrapper = document.getElementById("terminalSelectWrapper");
const agentSelectWrapper = document.getElementById("agentSelectWrapper");
const agentButtonsOverlay = document.getElementById("agentButtonsOverlay");

// Barra de agentes en la pantalla principal
const mainAgentBar = document.getElementById("mainAgentBar");

// Apertura / cierre de caja
const cashOpenOverlay = document.getElementById("cashOpenOverlay");
const cashOpenTerminalName = document.getElementById("cashOpenTerminalName");
const cashOpenTotalEl = document.getElementById("cashOpenTotal");
const cashHeaderBtn = document.getElementById("cashHeaderBtn");
const cashHeaderLabel = document.getElementById("cashHeaderLabel");

// Resumen de caja (label principal + resumen extendido de cierre)
const cashSummaryMainLabel = document.getElementById("cashSummaryMainLabel");
const cashCloseSummary = document.getElementById("cashCloseSummary");
const sumOpeningEl = document.getElementById("sumOpening");
const sumCashIncomeEl = document.getElementById("sumCashIncome");
const sumMovementsEl = document.getElementById("sumMovements");
const sumExpectedCashEl = document.getElementById("sumExpectedCash");
const sumCountedCashEl = document.getElementById("sumCountedCash");
const sumTotalSalesEl = document.getElementById("sumTotalSales");

// Cliente actual (input del carrito)
const cartClientInput = document.querySelector(".cart-client-input");

const emailOverlay = document.getElementById("emailOverlay");
const emailInput = document.getElementById("emailInput");
const emailOkBtn = document.getElementById("emailOkBtn");
const emailCancelBtn = document.getElementById("emailCancelBtn");
const emailError = document.getElementById("emailError");
const emailKeyboardBtn = document.getElementById("emailKeyboardBtn");
// ===== Funciones auxiliares =====
function isFalseFlag(v) {
  return v === false || v === 0 || v === "0" || v === "false";
}

// Extrae el % de IVA desde el código de impuesto.
// Primero mira la tabla de impuestos que hemos cargado de FacturaScripts.
// Si no lo encuentra, intenta deducirlo de los dígitos del código (fallback).
function extractTaxRateFromCode(codimpuesto) {
  if (!codimpuesto) return 0;

  const code = String(codimpuesto).trim();

  // 1) Mirar en el mapa cargado desde /impuestos
  if (Object.prototype.hasOwnProperty.call(taxRatesByCode, code)) {
    return taxRatesByCode[code];
  }

  // 2) Fallback: intentar sacar un número de dentro del código (ej. IVA21 -> 21)
  const m = code.match(/(\d+)/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  return isNaN(n) ? 0 : n;
}

// Devuelve el % de IVA de un producto o línea,
// usando primero product.taxRate y, si no, codimpuesto.
function getTaxRateForProduct(product) {
  if (!product) return 0;
  if (typeof product.taxRate === "number") return product.taxRate;
  if (product.codimpuesto) return extractTaxRateFromCode(product.codimpuesto);
  return 0;
}

function refreshLoggedUserUI() {
  if (!userNameEl) return;
  const u = (getLoginUser() || "").trim();
  userNameEl.textContent = u ? u : "---";
}

function updateCashButtonLabel() {
  if (!cashHeaderLabel) return;

  if (TPV_STATE.locked) {
    cashHeaderLabel.textContent = "Bloqueado";
    return;
  }

  if (TPV_STATE.offline) {
    cashHeaderLabel.textContent = "Conectar";
    return;
  }

  cashHeaderLabel.textContent = cashSession.open ? "Cerrar caja" : "Abrir caja";
}

// ===== Helpers DOM para subcategorías =====
function getSubcategoriesContainer() {
  const wrapper = document.querySelector(".categories-wrapper");
  if (!wrapper) return null;

  let sub = document.getElementById("subcategories");
  if (!sub) {
    sub = document.createElement("div");
    sub.id = "subcategories";
    sub.className = "categories subcategories-container";
    wrapper.appendChild(sub);
  }
  return sub;
}

// ===== Categorías (familias) =====
function renderCategories() {
  const container = document.getElementById("categories");
  if (!container) return;

  const sub = getSubcategoriesContainer();

  container.innerHTML = "";
  if (sub) {
    sub.innerHTML = "";
    sub.style.display = "none";
  }

  // Familias raíz (madre == null)
  const rootFamilies = categories.filter((c) => !c.parentId);

  rootFamilies.forEach((cat) => {
    const btn = document.createElement("button");
    btn.className = "category-btn";
    btn.dataset.cat = cat.id;

    const isActiveParent = activeFamilyParentId === cat.id;
    const hasChildren = categories.some((c) => c.parentId === cat.id);

    if (isActiveParent) {
      // Estamos dentro de este padre -> se convierte en "Volver"
      btn.textContent = "Volver";
      btn.classList.add("category-btn-back");
    } else {
      btn.textContent = cat.name;
    }

    btn.onclick = () => {
      // Si estábamos ya dentro del padre -> salir
      if (isActiveParent) {
        activeFamilyParentId = null;
        activeSubfamilyId = null;
        selectedCategory = null;
        renderCategories();
        renderProducts();
        return;
      }

      const children = categories.filter((c) => c.parentId === cat.id);

      if (children.length) {
        // Padre con hijas -> entramos en modo familia con subfamilias
        activeFamilyParentId = cat.id;
        activeSubfamilyId = null;
        selectedCategory = null;
        renderCategories();
        renderProducts();
      } else {
        // Familia sin hijas -> filtro simple
        if (selectedCategory === cat.id) {
          selectedCategory = null; // quitar filtro
        } else {
          selectedCategory = cat.id; // aplicar filtro
        }
        activeFamilyParentId = null;
        activeSubfamilyId = null;
        renderCategories();
        renderProducts();
      }
    };

    // <<< NUEVO: marcar familia raíz activa cuando actúa como filtro simple
    if (!hasChildren && selectedCategory === cat.id) {
      btn.classList.add("active");
    }

    container.appendChild(btn);
  });

  // Subfamilias visibles solo si hay padre activo
  if (sub && activeFamilyParentId) {
    const children = categories.filter(
      (c) => c.parentId === activeFamilyParentId
    );

    if (children.length) {
      sub.style.display = "flex";

      const inner = document.createElement("div");
      inner.className = "subcategories-inner";

      children.forEach((child) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "category-btn subcategory-btn";
        b.dataset.cat = child.id;
        b.textContent = child.name;

        if (activeSubfamilyId === child.id) {
          b.classList.add("active");
        }

        b.onclick = () => {
          if (activeSubfamilyId === child.id) {
            // Si ya está activa -> volvemos a "todas las subfamilias"
            activeSubfamilyId = null;
          } else {
            activeSubfamilyId = child.id;
          }
          renderCategories();
          renderProducts();
        };

        inner.appendChild(b);
      });

      sub.appendChild(inner);
    } else {
      sub.style.display = "none";
    }
  }
}

// ===== Productos =====
function renderProducts() {
  const grid = document.getElementById("productsGrid");
  if (!grid) return;
  grid.innerHTML = "";

  const term = searchTerm.trim().toLowerCase();
  let filtered = [...products];

  // Filtro por familia / subfamilia
  if (activeFamilyParentId) {
    // Estamos en un padre (Accesorios, etc.)
    if (activeSubfamilyId) {
      // Solo una subfamilia
      filtered = filtered.filter((p) => p.category === activeSubfamilyId);
    } else {
      // Todas las subfamilias + el propio padre
      const allowedIds = new Set();
      allowedIds.add(activeFamilyParentId);
      categories.forEach((c) => {
        if (c.parentId === activeFamilyParentId) {
          allowedIds.add(c.id);
        }
      });
      filtered = filtered.filter((p) => allowedIds.has(p.category));
    }
  } else if (selectedCategory) {
    // Filtro sencillo por una familia
    filtered = filtered.filter((p) => p.category === selectedCategory);
  }

  // Filtro por buscador
  if (term) {
    filtered = filtered.filter((p) => {
      const n1 = (p.name || "").toLowerCase();
      const n2 = (p.secondaryName || "").toLowerCase();
      return n1.includes(term) || n2.includes(term);
    });
  }

  filtered.forEach((p) => {
    const tile = document.createElement("div");

    // clase según si tiene imagen o no
    tile.className = "product-tile" + (p.imageUrl ? "" : " no-img");

    // Precio mostrado al público = precio neto * (1 + IVA)
    const taxRate = getTaxRateForProduct(p);
    const priceGross = (p.price || 0) * (1 + taxRate / 100);

    tile.innerHTML = `
    <div class="product-img-wrapper">
      ${p.imageUrl ? `<img src="${p.imageUrl}" class="product-img">` : ""}
    </div>

    <div class="product-overlay-top">
      <div class="product-name">${p.name}</div>
      ${
        p.secondaryName
          ? `<div class="product-secondary">${p.secondaryName}</div>`
          : ""
      }
    </div>

    <div class="product-footer">
      <div class="product-price">${priceGross.toFixed(2)} €</div>
    </div>
  `;

    tile.onclick = () => addToCart(p);
    grid.appendChild(tile);
  });
}

function renderMainUI() {
  if (mainUiRendered) return;
  renderCategories();
  renderProducts();
  mainUiRendered = true;
}

// ===== Buscador =====
if (searchInput) {
  searchInput.addEventListener("input", () => {
    searchTerm = searchInput.value || "";
    renderProducts();
  });
}

if (searchClearBtn) {
  searchClearBtn.onclick = () => {
    searchInput.value = "";
    searchTerm = "";
    renderProducts();
  };
}

// ===== Carrito =====
function addToCart(product, quantity = 1) {
  const existing = cart.find((c) => c.id === product.id);
  const taxRate = getTaxRateForProduct(product);
  const priceNet = product.price || 0;
  const priceGross = priceNet * (1 + taxRate / 100);

  if (existing) {
    existing.qty += quantity;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      secondaryName: product.secondaryName || "",
      price: priceNet, // neto original
      taxRate,
      grossPrice: priceGross, // bruto original (ya lo usas)
      codimpuesto: product.codimpuesto || null,
      qty: quantity,

      // ✅ NUEVO (para editar precio SOLO en esta venta)
      originalNetPrice: priceNet,
      originalGrossPrice: priceGross,
      grossPriceOverride: null, // si no es null, manda sobre grossPrice
    });
  }
  renderCart();
}

function updateCartItemQuantity(productId, newQty) {
  const item = cart.find((c) => c.id === productId);
  if (!item) return;

  if (newQty <= 0) {
    cart = cart.filter((c) => c.id !== productId);
  } else {
    item.qty = newQty;
  }
  renderCart();
}

function eur(n) {
  return (Number(n) || 0).toFixed(2).replace(".", ",") + " €";
}

function getUnitGross(item) {
  const v = item?.grossPriceOverride;
  if (typeof v === "number" && isFinite(v) && v >= 0) return v;
  if (typeof item?.grossPrice === "number" && isFinite(item.grossPrice))
    return item.grossPrice;
  return Number(item?.price || 0);
}

function setUnitGrossOverride(item, newGross) {
  const n = Number(newGross);
  if (!isFinite(n) || n < 0) return false;
  item.grossPriceOverride = n;
  return true;
}

function restoreUnitGross(item) {
  item.grossPriceOverride = null;
}

function renderCart() {
  const container = document.getElementById("cartLines");
  if (!container) return;
  container.innerHTML = "";

  let total = 0;

  cart.forEach((item) => {
    const unitPrice = getUnitGross(item);

    const lineTotal = unitPrice * item.qty;
    total += lineTotal;

    const row = document.createElement("div");
    row.className = "cart-line";
    row.dataset.id = item.id;

    const unitTxt = eur(unitPrice);
    const lineTxt = eur(lineTotal);

    row.innerHTML = `
  <div class="cart-line-name">
    <div>${item.name}</div>
    ${
      item.secondaryName
        ? `<div class="cart-line-secondary">${item.secondaryName}</div>`
        : ""
    }
    <div class="cart-line-unit">${item.qty} x ${unitTxt}</div>
  </div>

  <div class="qty-controls">
    <button class="qty-btn" data-action="minus" data-id="${item.id}">-</button>
    <button type="button" class="qty-display qty-display-btn qty-btn" data-action="edit" data-id="${
      item.id
    }">${item.qty}</button>

    <button class="qty-btn" data-action="plus" data-id="${item.id}">+</button>

  </div>

  <div class="cart-line-total">
  <button type="button" class="line-price-btn" data-action="price" data-id="${
    item.id
  }">
    ${lineTxt}
  </button>
  <button class="line-delete-btn" data-id="${item.id}">✕</button>
</div>

`;

    container.appendChild(row);
  });

  const totalEl = document.getElementById("totalAmount");
  if (totalEl) {
    totalEl.textContent = eur(total);
  }
}

const LOGIN_TOKEN_KEY = "tpv_login_token";
const LOGIN_USER_KEY = "tpv_login_user";

let LOGIN_ACTIVE = false;

function isLoggedIn() {
  return !!getLoginToken() && !!getLoginUser();
}

function closeAllOverlaysExceptLogin() {
  // Cierra todo lo que pueda estar abierto por detrás
  try {
    hideTerminalOverlay();
  } catch (e) {}
  try {
    hideCashOpenDialog();
  } catch (e) {}
  try {
    closeOptions();
  } catch (e) {}
  try {
    closeParkedModal();
  } catch (e) {}
  // Si tienes payOverlay abierto:
  try {
    payOverlay?.classList.add("hidden");
  } catch (e) {}
  // NumPad/Qwerty si estorban:
  try {
    closeNumPad();
  } catch (e) {}
  try {
    closeQwerty();
  } catch (e) {}
}

function lockAppUI() {
  document.body.classList.add("modal-locked");
}
function unlockAppUI() {
  document.body.classList.remove("modal-locked");
}

function getLoginToken() {
  return localStorage.getItem(LOGIN_TOKEN_KEY) || "";
}

function getLoginUser() {
  return localStorage.getItem(LOGIN_USER_KEY) || "";
}
function getLoginAgent() {
  return localStorage.getItem("tpv_login_codagente") || "";
}
function getLoginWarehouse() {
  return localStorage.getItem("tpv_login_codalmacen") || "";
}

function setLoginSession({ token, user, codagente, codalmacen }) {
  localStorage.setItem("tpv_login_token", token || "");
  localStorage.setItem("tpv_login_user", user || "");
  localStorage.setItem("tpv_login_codagente", codagente || "");
  localStorage.setItem("tpv_login_codalmacen", codalmacen || "");
}
function clearLoginSession() {
  localStorage.removeItem("tpv_login_token");
  localStorage.removeItem("tpv_login_user");
  localStorage.removeItem("tpv_login_codagente");
  localStorage.removeItem("tpv_login_codalmacen");
}

function hasCompanyResolved() {
  const cfg = window.RECIPOK_API || {};
  return !!(
    cfg.baseUrl &&
    cfg.apiKey &&
    (localStorage.getItem("tpv_companyEmail") || "")
  );
}

async function openLoginModal() {
  if (!hasCompanyResolved()) {
    toast(
      "Primero debes introducir el email de tu empresa para activar el TPV.",
      "warn",
      "Activación"
    );
    return false; // ← NO abrir login
  }
  const overlay = document.getElementById("loginOverlay");
  const usersBar = document.getElementById("loginUsersBar"); // 👈 nuevo
  const passInp = document.getElementById("loginPass");
  const errEl = document.getElementById("loginError");
  const okBtn = document.getElementById("loginOkBtn");
  const exitBtn = document.getElementById("loginExitBtn");
  const pinPad = document.getElementById("loginPinPad");
  const MAX_PIN = 4;

  if (!overlay || !usersBar || !passInp || !okBtn || !exitBtn) {
    throw new Error(
      "Falta el HTML del modal de login (loginUsersBar/loginPass/loginOkBtn/loginExitBtn)."
    );
  }

  if (pinPad && !pinPad.dataset.bound) {
    pinPad.dataset.bound = "1";
    pinPad.onclick = (e) => {
      const btn = e.target.closest("button[data-k]");
      if (!btn) return;
      const k = btn.getAttribute("data-k");

      if (k === "clear") {
        passInp.value = "";
        passInp.focus();
        return;
      }
      if (k === "back") {
        passInp.value = (passInp.value || "").slice(0, -1);
        passInp.focus();
        return;
      }
      if (/^\d$/.test(k)) {
        if ((passInp.value || "").length >= MAX_PIN) return;
        passInp.value = (passInp.value || "") + k;
        passInp.focus();
        return;
      }
    };
  }

  errEl.textContent = "";
  passInp.value = "";
  closeAllOverlaysExceptLogin();
  LOGIN_ACTIVE = true;
  okBtn.disabled = false;
  overlay.classList.remove("hidden");
  lockAppUI();

  // ✅ usuario seleccionado por botones
  let selectedUser = "";

  // Helper: pintar botones (por ahora desde operators.json o lista estática)
  // IMPORTANTE: Aquí luego lo conectamos al endpoint que devuelva los nicks desde FacturaScripts.
  function renderUserButtons(userList) {
    usersBar.innerHTML = "";
    userList.forEach((u) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "agent-btn"; // usa tu clase si ya existe
      btn.textContent = u;
      btn.onclick = () => {
        selectedUser = u;
        // marcar seleccionado
        [...usersBar.querySelectorAll("button")].forEach((b) =>
          b.classList.remove("selected")
        );
        btn.classList.add("selected");
        errEl.textContent = "";
        passInp.focus();
      };
      usersBar.appendChild(btn);
    });
  }

  // ✅ Lista temporal (pon aquí tus usuarios mientras conectamos al servidor)
  renderUserButtons(["admin", "demo"]); // <- cámbialo cuando tengas el endpoint

  // si solo hay 1, lo auto-seleccionamos
  const firstBtn = usersBar.querySelector("button");
  if (firstBtn) firstBtn.click();

  passInp.focus();

  const kbBtn = document.getElementById("loginKeyboardBtn");
  if (kbBtn) {
    kbBtn.onclick = () => openQwertyForInput(passInp); // 👈 función puente
  }

  const doLogin = async () => {
    try {
      errEl.textContent = "";
      okBtn.disabled = true;

      const u = (selectedUser || "").trim();
      const p = (passInp.value || "").trim();

      if (!u) {
        errEl.textContent = "Selecciona un usuario.";
        okBtn.disabled = false;
        return false;
      }
      if (!p) {
        errEl.textContent = "Escribe la contraseña.";
        okBtn.disabled = false;
        return false;
      }

      const base = window.TPV_CONFIG?.resolverUrl || "";
      if (!base) throw new Error("Falta TPV_CONFIG.resolverUrl");

      const url = base.replace(/\/clients\.json(\?.*)?$/i, "/tpv_login.php");

      const body = new URLSearchParams();
      body.append(
        "companyEmail",
        localStorage.getItem("tpv_companyEmail") || ""
      );
      body.append("user", u);
      body.append("pass", p);

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: body.toString(),
        cache: "no-store",
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.ok !== true) {
        errEl.textContent = data?.message || "Login incorrecto.";
        passInp.value = ""; // ✅ limpiar PIN
        passInp.focus();
        okBtn.disabled = false;
        return false;
      }

      setLoginSession({
        token: data.token,
        user: data.user,
        codagente: data.codagente,
        codalmacen: data.codalmacen,
      });

      refreshLoggedUserUI();

      overlay.classList.add("hidden");
      unlockAppUI();
      toast?.("Sesión iniciada ✅", "ok", "Login");
      LOGIN_ACTIVE = false;

      return true;
    } catch (e) {
      errEl.textContent = e?.message || String(e);
      passInp.value = ""; // ✅ limpiar PIN
      passInp.focus();
      okBtn.disabled = false;
      return false;
    }
  };

  return await new Promise((resolve) => {
    okBtn.onclick = async () => {
      const ok = await doLogin();
      if (ok) resolve(true); // ✅ solo resolvemos si entra bien
    };
    exitBtn.onclick = () => {
      clearLoginSession();
      overlay.classList.add("hidden");
      unlockAppUI();
      LOGIN_ACTIVE = false; // ✅ importante
      window.electronAPI?.quitApp?.();
      okBtn.disabled = false;
      resolve(false);
    };

    passInp.onkeydown = (e) => {
      if (e.key === "Enter") okBtn.click();
      if (e.key === "Escape") exitBtn.click();
    };
  });
}

function grossToNet(gross, taxRate) {
  const g = Number(gross) || 0;
  const t = Number(taxRate) || 0;
  const divisor = 1 + t / 100;
  return divisor > 0 ? g / divisor : g;
}

// ===== Modal genérico de confirmación (usa msgOverlay) =====
function confirmModal(title, text) {
  const overlay = document.getElementById("msgOverlay");
  const titleEl = document.getElementById("msgTitle");
  const textEl = document.getElementById("msgText");
  const okBtn = document.getElementById("msgOkBtn");
  const cancelBtn = document.getElementById("msgCancelBtn");

  if (!overlay || !titleEl || !textEl || !okBtn || !cancelBtn) {
    // fallback seguro si falta algo
    return Promise.resolve(window.confirm(text));
  }

  titleEl.textContent = title || "Confirmar";
  textEl.textContent = text || "";

  overlay.classList.remove("hidden");
  lockAppUI();

  return new Promise((resolve) => {
    const cleanup = () => {
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      window.removeEventListener("keydown", onKey);
      overlay.classList.add("hidden");
      unlockAppUI();
    };

    const onKey = (e) => {
      if (e.key === "Escape") {
        cleanup();
        resolve(false);
      }
      if (e.key === "Enter") {
        cleanup();
        resolve(true);
      }
    };

    window.addEventListener("keydown", onKey);

    cancelBtn.onclick = () => {
      cleanup();
      resolve(false);
    };

    okBtn.onclick = () => {
      cleanup();
      resolve(true);
    };
  });
}

window.TPV_UI?.onGuard?.(async ({ title, text }) => {
  await confirmModal(title || "Aviso", text || "");
});

// ===== Toasts (notificaciones breves) =====

function toast(message, type = "info", title = "") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const el = document.createElement("div");
  el.className = `toast ${type}`;

  el.innerHTML = `
    ${title ? `<div class="title">${title}</div>` : ""}
    <div>${message}</div>
  `;

  container.appendChild(el);

  requestAnimationFrame(() => el.classList.add("show"));

  const ttl = type === "err" ? 4500 : 2800;
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 200);
  }, ttl);
}

// ===== Teclado numérico =====
const numPadOverlay = document.getElementById("numPadOverlay");
const numPadDisplay = document.getElementById("numPadDisplay");
const numPadProductName = document.getElementById("numPadProductName");
let numPadCurrentValue = "";
let numPadOnConfirm = null;
let numPadVisible = false;
let numPadOverwriteNextDigit = true;
let numPadMode = "qty"; // "qty" | "price"
let numPadOriginalUnitGross = null;
let numPadTargetItemId = null;

// Función común para cerrar overlays de teclados al hacer clic fuera
function handleOverlayOutsideClick(e, padSelector, closeFn) {
  const pad = e.target.closest(padSelector);
  if (!pad) {
    closeFn();
    return true;
  }
  return false;
}

function updateNumPadDisplay() {
  if (!numPadDisplay) return;
  numPadDisplay.textContent =
    numPadCurrentValue === "" ? "0" : numPadCurrentValue;
}

function openNumPad(
  initialValue,
  onConfirm,
  productName,
  mode = "qty",
  originalValue = null,
  targetId = null
) {
  numPadMode = mode;
  numPadOriginalUnitGross = originalValue;
  numPadTargetItemId = targetId;

  numPadCurrentValue = initialValue != null ? String(initialValue) : "";
  numPadOverwriteNextDigit = true;
  numPadOnConfirm = onConfirm;

  if (numPadProductName) {
    numPadProductName.textContent = productName ? ` - ${productName}` : "";
  }

  // ✅ si es precio, muestra botón “Restaurar”
  const resetBtn = document.querySelector('[data-key="resetPrice"]');
  if (resetBtn) resetBtn.style.display = mode === "price" ? "" : "none";

  updateNumPadDisplay();
  if (numPadOverlay) numPadOverlay.classList.remove("hidden");
  numPadVisible = true;
}

function closeNumPad() {
  if (numPadOverlay) {
    numPadOverlay.classList.add("hidden");
  }
  if (numPadProductName) {
    numPadProductName.textContent = "";
  }
  numPadVisible = false;
  numPadOnConfirm = null;
}

function numPadAddDigit(digit) {
  if (numPadOverwriteNextDigit) {
    numPadCurrentValue = digit; // 👈 sustituye
    numPadOverwriteNextDigit = false;
    updateNumPadDisplay();
    return;
  }

  if (numPadCurrentValue.length < 12) {
    numPadCurrentValue += digit;
    updateNumPadDisplay();
  }
}

function numPadAddOperator(op) {
  // Si está en modo overwrite (recién abierto) y el usuario toca un operador:
  // ✅ NO sustituimos, queremos operar con el valor actual (5 -> 5*2)
  numPadOverwriteNextDigit = false;

  let s = String(numPadCurrentValue || "");

  // Si está vacío, arrancamos desde 0 salvo "-" (permitir negativos si quieres)
  if (!s) s = "0";

  // Evitar dos operadores seguidos: reemplaza el último
  if (/[+\-*/]$/.test(s)) {
    s = s.slice(0, -1) + op;
  } else {
    s += op;
  }

  numPadCurrentValue = s;
  updateNumPadDisplay();
}

function numPadAppend(token) {
  // límite más alto porque ahora puede haber operadores
  if (numPadCurrentValue.length >= 20) return;

  // normalizar tokens especiales
  if (token === "mul") token = "*";
  if (token === "div") token = "/";
  if (token === "dot") token = ".";

  numPadCurrentValue += token;
  updateNumPadDisplay();
}

function numPadAddDot() {
  numPadOverwriteNextDigit = false;
  let s = String(numPadCurrentValue || "0");

  // no permitir ".."
  if (s.endsWith(".")) return;

  // si el último char es operador, añade "0."
  if (/[+\-*/]$/.test(s)) s += "0.";
  // si NO hay punto en el último número, añadirlo
  else {
    const parts = s.split(/[+\-*/]/);
    const last = parts[parts.length - 1];
    if (last.includes(".")) return;
    s += ".";
  }

  numPadCurrentValue = s;
  updateNumPadDisplay();
}

function numPadBackspace() {
  if (numPadCurrentValue.length > 0) {
    numPadCurrentValue = numPadCurrentValue.slice(0, -1);
    updateNumPadDisplay();
    if (numPadCurrentValue.length === 0) numPadOverwriteNextDigit = true;
  }
}

function numPadClearAll() {
  numPadCurrentValue = "";
  numPadOverwriteNextDigit = true;
  updateNumPadDisplay();
}

function numPadConfirm() {
  const raw = String(numPadCurrentValue || "").trim();

  // Si no toca nada y le da OK -> mantener lo que había
  if (!raw) {
    if (typeof numPadOnConfirm === "function") {
      // en qty: 1; en price: usar original/actual
      if (numPadMode === "price") {
        const item = cart.find((c) => c.id === numPadTargetItemId);
        const current = item
          ? getEffectiveUnitGross(item)
          : numPadOriginalUnitGross || 0;
        numPadOnConfirm(current);
      } else {
        numPadOnConfirm(1);
      }
    }
    closeNumPad();
    return;
  }

  // Eval simple de expresiones (si ya lo tienes, reutiliza tu versión)
  const cleaned = raw.replace(/\s+/g, "");
  if (!/^[0-9+\-*/.]+$/.test(cleaned)) {
    toast("Expresión no válida", "warn", "Teclado");
    return;
  }

  let value;
  try {
    // eslint-disable-next-line no-new-func
    value = Function(`"use strict"; return (${cleaned});`)();
  } catch (e) {
    toast("Expresión no válida", "warn", "Teclado");
    return;
  }

  if (numPadMode === "price") {
    value = Number(value);
    if (!isFinite(value) || value <= 0) value = 0;
    if (typeof numPadOnConfirm === "function") numPadOnConfirm(value);
    closeNumPad();
    return;
  }

  // cash (permite 0)
  if (numPadMode === "cash") {
    value = Math.round(Number(value));
    if (!isFinite(value) || value < 0) value = 0;
    if (typeof numPadOnConfirm === "function") numPadOnConfirm(value);
    closeNumPad();
    return;
  }

  // qty
  value = Math.floor(Number(value));
  if (!isFinite(value) || value <= 0) value = 1;
  if (typeof numPadOnConfirm === "function") numPadOnConfirm(value);
  closeNumPad();
}

function safeEvalQtyExpression(exprRaw) {
  let expr = String(exprRaw || "").trim();
  if (!expr) return null;

  // Permitir coma decimal
  expr = expr.replaceAll(",", ".");

  // Mapear símbolos bonitos a operadores reales
  expr = expr.replaceAll("×", "*").replaceAll("÷", "/").replaceAll("−", "-");

  // Solo permitimos: números, espacios, + - * / ( ) y .
  if (!/^[0-9+\-*/().\s]+$/.test(expr)) return null;

  // Evitar cosas raras como ** o //
  if (expr.includes("**") || expr.includes("//")) return null;

  let result;
  try {
    result = Function(`"use strict"; return (${expr});`)();
  } catch {
    return null;
  }

  if (!isFinite(result)) return null;

  // Cantidad entera final
  const qty = Math.round(Number(result));
  if (!isFinite(qty)) return null;

  // Reglas: mínimo 1, máximo 9999 (ajusta si quieres)
  return Math.max(1, Math.min(9999, qty));
}

if (numPadOverlay) {
  numPadOverlay.addEventListener("click", (e) => {
    if (handleOverlayOutsideClick(e, ".num-pad", closeNumPad)) return;

    const btn = e.target.closest("[data-key]");
    if (!btn) return;

    const key = btn.getAttribute("data-key");

    // ✅ números u operadores
    if (key >= "0" && key <= "9") {
      numPadAddDigit(key);
    } else if (key === ".") {
      numPadAddDot();
      // permitir punto solo si no hay ya un punto en el último número
      // (simple: evitar ".." y "1.2.3")
      const lastChunk = numPadCurrentValue.split(/[+\-*/]/).pop() || "";
      if (lastChunk.includes(".")) return;
      if (numPadOverwriteNextDigit) {
        numPadCurrentValue = "0.";
        numPadOverwriteNextDigit = false;
      } else {
        numPadCurrentValue += ".";
      }
      updateNumPadDisplay();
    } else if (key === "+" || key === "-" || key === "*" || key === "/") {
      numPadAddOperator(key);
    } else if (key === "back") {
      numPadBackspace();
    } else if (key === "clear") {
      numPadClearAll();
    } else if (key === "cancel") {
      closeNumPad();
    } else if (key === "ok") {
      numPadConfirm();
    } else if (key === "resetPrice") {
      const item = cart.find((c) => c.id === numPadTargetItemId);
      if (item) {
        restoreUnitGross(item); // ✅ vuelve al original
        renderCart();
      }
      closeNumPad();
    }
  });
}

window.addEventListener("keydown", (e) => {
  if (numPadVisible) {
    if (/^[0-9+\-*/().]$/.test(e.key)) {
      e.preventDefault();
      numPadAppend(e.key);
    } else if (e.key === "Backspace") {
      e.preventDefault();
      numPadBackspace();
    } else if (e.key === "Enter") {
      e.preventDefault();
      numPadConfirm();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeNumPad();
    }
    return;
  }

  // Teclado QWERTY se gestiona más abajo
});

// ===== Teclado QWERTY =====
const qwertyOverlay = document.getElementById("qwertyOverlay");
const qwertyDisplay = document.getElementById("qwertyDisplay");
let qwertyCurrentValue = "";
let qwertyVisible = false;

function updateQwertyDisplay() {
  if (!qwertyDisplay) return;
  qwertyDisplay.textContent = qwertyCurrentValue || "";
}

let qwertyTargetInput = null;

// default: text
function openQwertyForInput(inputEl, mode = "text") {
  qwertyMode = mode;

  const emailRow = document.getElementById("qwertyEmailRow");
  if (emailRow) {
    emailRow.classList.toggle("hidden", qwertyMode !== "email");
  }

  qwertyTargetInput = inputEl || null;
  qwertyCurrentValue = inputEl?.value ? inputEl.value : "";
  updateQwertyDisplay();

  const qwertyOverlay = document.getElementById("qwertyOverlay");
  if (qwertyOverlay) qwertyOverlay.classList.remove("hidden");
  qwertyVisible = true;
}

function closeQwerty() {
  const emailRow = document.getElementById("qwertyEmailRow");
  if (emailRow) emailRow.classList.add("hidden");

  const qwertyOverlay = document.getElementById("qwertyOverlay");
  if (qwertyOverlay) qwertyOverlay.classList.add("hidden");

  qwertyVisible = false;
  qwertyMode = "text";
}

function qwertyAddChar(ch) {
  qwertyCurrentValue += ch;
  updateQwertyDisplay();
}

function qwertyBackspace() {
  if (qwertyCurrentValue.length > 0) {
    qwertyCurrentValue = qwertyCurrentValue.slice(0, -1);
    updateQwertyDisplay();
  }
}

function qwertyClearAll() {
  qwertyCurrentValue = "";
  updateQwertyDisplay();
}

function qwertyConfirm() {
  if (qwertyTargetInput) {
    qwertyTargetInput.value = qwertyCurrentValue;
    // si es el buscador, actualizamos la búsqueda
    if (qwertyTargetInput === searchInput) {
      searchTerm = qwertyCurrentValue;
      renderProducts();
    }
    qwertyTargetInput.dispatchEvent(new Event("input", { bubbles: true }));
  }
  closeQwerty();
}

if (searchKeyboardBtn) {
  searchKeyboardBtn.onclick = () => {
    openQwertyForInput(searchInput);
  };
}

if (qwertyOverlay) {
  qwertyOverlay.addEventListener("click", (e) => {
    if (handleOverlayOutsideClick(e, ".qwerty-pad", closeQwerty)) {
      return;
    }

    const keyBtn = e.target.closest("[data-key]");
    if (!keyBtn) return;

    const key = keyBtn.getAttribute("data-key");
    if (key === ".com") {
      qwertyAddChar(".com");
    } else if (key === "gmail.com") {
      qwertyAddChar("gmail.com");
    } else if (key === "@") {
      qwertyAddChar("@");
    } else if (key === ".") {
      qwertyAddChar(".");
    } else if (key === "_") {
      qwertyAddChar("_");
    } else if (key === "-") {
      qwertyAddChar("-");
    } else if (key.length === 1) {
      qwertyAddChar(key);
    } else if (key === "space") {
      qwertyAddChar(" ");
    } else if (key === "back") {
      qwertyBackspace();
    } else if (key === "clear") {
      qwertyClearAll();
    } else if (key === "cancel") {
      closeQwerty();
    } else if (key === "ok") {
      qwertyConfirm();
    }
  });
}

window.addEventListener("keydown", (e) => {
  if (!qwertyVisible) return;

  if (e.key.length === 1) {
    e.preventDefault();
    qwertyAddChar(e.key);
  } else if (e.key === "Backspace") {
    e.preventDefault();
    qwertyBackspace();
  } else if (e.key === "Enter") {
    e.preventDefault();
    qwertyConfirm();
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeQwerty();
  }
});

// ===== Eventos del carrito =====
const cartLinesContainer = document.getElementById("cartLines");

if (cartLinesContainer) {
  cartLinesContainer.addEventListener("click", (e) => {
    const qtyBtn = e.target.closest(".qty-btn");
    if (qtyBtn) {
      const action = qtyBtn.getAttribute("data-action");
      const id = parseInt(qtyBtn.getAttribute("data-id"), 10);
      const item = cart.find((c) => c.id === id);
      if (!item) return;

      if (action === "plus") {
        updateCartItemQuantity(id, item.qty + 1);
      } else if (action === "minus") {
        updateCartItemQuantity(id, item.qty - 1);
      } else if (action === "edit") {
        openNumPad(
          item.qty,
          (newQty) => {
            updateCartItemQuantity(id, newQty);
          },
          item.name
        );
      }
      return;
    }

    const priceBtn = e.target.closest('[data-action="price"]');
    if (priceBtn) {
      const id = parseInt(priceBtn.getAttribute("data-id"), 10);
      const item = cart.find((c) => c.id === id);
      if (!item) return;

      const currentUnit = getUnitGross(item);
      const originalUnit =
        item.originalGrossPrice ?? item.grossPrice ?? item.price ?? 0;

      openNumPad(
        currentUnit.toFixed(2),
        (newUnitGross) => {
          const v = Number(newUnitGross);
          if (!isFinite(v) || v <= 0) return;
          setUnitGrossOverride(item, v); // ✅ guarda en grossPriceOverride
          renderCart();
        },
        item.name,
        "price",
        originalUnit,
        id
      );

      return;
    }

    const deleteBtn = e.target.closest(".line-delete-btn");
    if (deleteBtn) {
      const id = parseInt(deleteBtn.getAttribute("data-id"), 10);
      updateCartItemQuantity(id, 0);
    }
  });
}

// ===== Estado (texto + punto de estado abajo) =====
function setStatusText(text) {
  const statusBar = document.getElementById("statusBar");
  if (!statusBar) return;

  const strong = statusBar.querySelector("strong");
  const dot = document.getElementById("statusDot");

  if (strong) strong.textContent = text;

  if (!dot) return;

  const t = (text || "").toLowerCase();

  // 🔴 OFFLINE / ERROR
  if (
    t.includes("offline") ||
    t.includes("sin conexión") ||
    t.includes("error")
  ) {
    dot.style.background = "#ef4444"; // rojo
    return;
  }

  // 🟡 CONECTANDO / PROCESANDO
  if (
    t.includes("conectando") ||
    t.includes("cobrando") ||
    t.includes("procesando")
  ) {
    dot.style.background = "#facc15"; // amarillo
    return;
  }

  // 🟢 ONLINE / OK
  dot.style.background = "#22c55e"; // verde
}

function updateOnlineBadge(ok) {
  const dot = document.getElementById("statusDot");
  const statusBar = document.getElementById("statusBar");
  if (!statusBar) return;

  const strong = statusBar.querySelector("strong");
  if (dot) dot.style.background = ok ? "#22c55e" : "#ef4444"; // verde / rojo
  if (strong)
    strong.textContent = ok ? "Online Recipok" : "Sin internet (modo offline)";
}

function updateParkedCountBadge() {
  const badge = document.getElementById("parkedCountBadge");
  if (!badge) return;
  const n = parkedTickets.length;
  badge.textContent = n;
}

function getCartTotal(items) {
  return (items || []).reduce((sum, item) => {
    const unit = getUnitGross(item);

    return sum + unit * (item.qty || 1);
  }, 0);
}

function registerPaymentUsage(code, amount, label) {
  if (!code) return;

  const key = String(code).trim() || "DESCONOCIDO";
  if (!cashSession.paymentsByMethod) {
    cashSession.paymentsByMethod = {};
  }

  const entry = cashSession.paymentsByMethod[key] || {
    code: key,
    label: label || key,
    total: 0,
    count: 0,
  };

  const inc = Number(amount) || 0;
  entry.total += inc;
  entry.count += 1;

  cashSession.paymentsByMethod[key] = entry;
}

// Registra todos los pagos de una venta (array payResult.pagos)
function registerPaymentsForCurrentSession(pagos) {
  if (!Array.isArray(pagos)) return;
  pagos.forEach((p) => {
    registerPaymentUsage(p.codpago, p.importe, p.descripcion || p.codpago);
  });
}

async function parkCurrentCart(obs = "") {
  if (!cart || cart.length === 0) {
    toast("No hay productos para aparcar.", "warn", "Aparcar");
    return;
  }

  parkedCounter += 1;

  const snapshot = cart.map((item) => ({ ...item }));
  const total = getCartTotal(snapshot);

  const clientName = cartClientInput
    ? cartClientInput.value || "Cliente"
    : "Cliente";

  const observation = String(obs || "").trim();

  const localTicket = {
    id: parkedCounter,
    createdAt: new Date(),
    items: snapshot,
    total,
    clientName,
    obs: observation,
    fs: null,
  };

  // 👉 Aquí llamamos al endpoint de presupuestos
  const remote = await apiCreatePresupuestoFromCart(observation);
  if (remote && (remote.doc || remote.data)) {
    const doc = remote.doc || remote.data;
    localTicket.fs = {
      idpresupuesto: doc.idpresupuesto ?? doc.id ?? null,
      codigo: doc.codigo ?? null,
    };
  }

  parkedTickets.push(localTicket);

  cart = [];
  renderCart();
  updateParkedCountBadge();

  setStatusText("Ticket aparcado.");
}

function apiDeletePresupuesto(idpresupuesto) {
  if (!idpresupuesto || TPV_STATE.offline || TPV_STATE.locked) return;

  // usamos apiWrite con DELETE
  apiWrite(`presupuestoclientes/${idpresupuesto}`, "DELETE", {}).catch((e) => {
    console.warn("No se pudo borrar presupuesto en FS:", e);
  });
}

// ===== Modal de tickets aparcados =====
const parkedTicketsOverlay = document.getElementById("parkedTicketsOverlay");
const parkedTicketsList = document.getElementById("parkedTicketsList");
const parkedCloseBtn = document.getElementById("parkedCloseBtn");

function openParkedModal() {
  if (!parkedTicketsOverlay) return;

  if (!parkedTickets || parkedTickets.length === 0) {
    toast("No hay tickets aparcados.", "info", "Aparcados");
    return;
  }

  renderParkedTicketsModal();
  parkedTicketsOverlay.classList.remove("hidden");
}

function closeParkedModal() {
  if (!parkedTicketsOverlay) return;
  parkedTicketsOverlay.classList.add("hidden");
}

function renderParkedTicketsModal() {
  if (!parkedTicketsList) return;

  parkedTicketsList.innerHTML = "";

  if (!parkedTickets || parkedTickets.length === 0) {
    const empty = document.createElement("div");
    empty.className = "parked-ticket-empty";
    empty.textContent = "No hay tickets aparcados.";
    parkedTicketsList.appendChild(empty);
    return;
  }

  const getItemName = (it) =>
    (it.name || it.nombre || it.descripcion || it.productName || "Producto")
      .toString()
      .trim();

  const getItemQty = (it) => Number(it.qty ?? it.cantidad ?? 1) || 1;

  parkedTickets.forEach((t, index) => {
    const div = document.createElement("div");
    div.className = "parked-ticket-item parked-ticket-compact";
    div.dataset.index = index;

    const fecha = t.createdAt ? new Date(t.createdAt) : new Date();

    const hora = fecha.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const totalTexto = t.total != null ? t.total.toFixed(2) + " €" : "—";

    // ✅ “tipos” = productos distintos (por nombre/id)
    const items = Array.isArray(t.items) ? t.items : [];
    const keyOf = (it) =>
      String(it.idproducto || it.id || getItemName(it)).toLowerCase();
    const uniqueMap = new Map();
    items.forEach((it) => {
      const k = keyOf(it);
      if (!uniqueMap.has(k)) uniqueMap.set(k, it);
    });
    const tipos = uniqueMap.size;

    // ✅ resumen de productos (3 máx)
    const preview = Array.from(uniqueMap.values())
      .slice(0, 3)
      .map((it) => `${getItemQty(it)}× ${getItemName(it)}`)
      .join(" · ");

    const extra = tipos > 3 ? ` · +${tipos - 3}` : "";

    const obs = (t.obs || "").trim();

    div.innerHTML = `
      <div class="pt-left">
        <div class="pt-title">Ticket #${t.id}</div>
        <div class="pt-sub">${hora} · ${escapeHtml(
      t.clientName || "Cliente"
    )}</div>
      </div>

      <div class="pt-mid">
        ${
          obs
            ? `<div class="pt-obs">${escapeHtml(obs)}</div>`
            : `<div class="pt-obs pt-obs-muted">Sin observación</div>`
        }
        <div class="pt-items">${escapeHtml(preview + extra)}</div>
      </div>

      <div class="pt-right">
  <div class="pt-right-top">
    <div class="pt-total">${totalTexto}</div>
    <button type="button" class="pt-del" title="Eliminar ticket aparcado" aria-label="Eliminar">🗑</button>
  </div>

  
</div>



    `;

    const delBtn = div.querySelector(".pt-del");
    if (delBtn) {
      delBtn.onclick = async (e) => {
        e.stopPropagation();

        const ok = await confirmModal(
          "Eliminar ticket aparcado",
          `¿Seguro que quieres eliminar el Ticket #${t.id}?`
        );
        if (!ok) return;

        parkedTickets.splice(index, 1);
        // Si borro el ticket que estaba cargado, lo “desvinculo”
        if (currentParkedTicketIndex === index) {
          currentParkedTicketIndex = null;
        } else if (
          currentParkedTicketIndex !== null &&
          currentParkedTicketIndex > index
        ) {
          // Reajustar índice si se borra uno anterior
          currentParkedTicketIndex -= 1;
        }
        updateParkedCountBadge();

        // Si ya no quedan, cerramos modal
        if (!parkedTickets.length) {
          closeParkedModal();
          toast("No quedan tickets aparcados.", "info", "Aparcados");
          return;
        }

        renderParkedTicketsModal();
        toast("Ticket aparcado eliminado.", "ok", "Aparcados");
      };
    }

    div.onclick = () => {
      restoreParkedCartByIndex(index);
      closeParkedModal();
    };

    parkedTicketsList.appendChild(div);
  });
}

function clearPaidParkedTicket() {
  if (
    currentParkedTicketIndex === null ||
    !Array.isArray(parkedTickets) ||
    parkedTickets.length === 0
  ) {
    return;
  }

  const idx = currentParkedTicketIndex;
  if (idx < 0 || idx >= parkedTickets.length) {
    currentParkedTicketIndex = null;
    return;
  }

  const ticket = parkedTickets[idx];
  const fsInfo = ticket.fs || {};
  const idpresupuesto = fsInfo.idpresupuesto || null;

  // Quitamos de la lista local
  parkedTickets.splice(idx, 1);
  currentParkedTicketIndex = null;
  updateParkedCountBadge();

  // Y, si existe en FacturaScripts, lo borramos allí
  if (idpresupuesto) {
    apiDeletePresupuesto(idpresupuesto);
  }
}

// Cerrar modal al pulsar la X
if (parkedCloseBtn) {
  parkedCloseBtn.onclick = () => {
    closeParkedModal();
  };
}

// Cerrar al hacer clic fuera de la tarjeta
if (parkedTicketsOverlay) {
  parkedTicketsOverlay.addEventListener("click", (e) => {
    const modal = e.target.closest(".parked-modal");
    if (!modal) {
      closeParkedModal();
    }
  });
}

// Recuperar ticket por índice (lo usa el modal)
function restoreParkedCartByIndex(index) {
  if (!parkedTickets || parkedTickets.length === 0) {
    return;
  }

  if (index < 0 || index >= parkedTickets.length) {
    toast("Ticket aparcado no válido.", "err", "Aparcados");
    return;
  }

  const ticket = parkedTickets[index];

  // Clonamos líneas al carrito
  cart = (ticket.items || []).map((i) => ({ ...i }));
  renderCart();

  // Guardamos qué ticket aparcado está cargado
  currentParkedTicketIndex = index;

  // 👇 IMPORTANTE: no tocamos parkedTickets ni el contador
  // parkedTickets.splice(index, 1);
  // updateParkedCountBadge();

  setStatusText("Ticket aparcado cargado en el carrito.");
}

// Para compatibilidad, si en algún sitio se llamara a restoreParkedCart()
function restoreParkedCart() {
  openParkedModal();
}

// ===== Gestión de terminales / agentes / caja =====
function fillTerminalSelect() {
  if (!terminalSelect) return;

  terminalSelect.innerHTML = "";
  terminals.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    terminalSelect.appendChild(opt);
  });
}

function setCurrentTerminal(terminal) {
  currentTerminal = terminal || null;
}

function getAgentsForTerminalId(terminalId) {
  if (!terminalId) return [];
  const key = String(terminalId);
  return agentsByTerminal[key] || [];
}

function renderAgentButtonsOverlay(terminalId) {
  if (!agentButtonsOverlay || !agentSelectWrapper) return;

  const list = getAgentsForTerminalId(terminalId);
  agentButtonsOverlay.innerHTML = "";

  if (list.length === 0) {
    agentSelectWrapper.style.display = "none";
    currentAgent = null;
    return;
  }

  agentSelectWrapper.style.display = "";

  list.forEach((agent) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "agent-btn" +
      (currentAgent && currentAgent.codagente === agent.codagente
        ? " selected"
        : "");
    btn.textContent = agent.name;
    btn.onclick = () => {
      currentAgent = agent;
      // marcar seleccionado
      agentButtonsOverlay
        .querySelectorAll(".agent-btn")
        .forEach((b) => b.classList.toggle("selected", b === btn));
    };
    agentButtonsOverlay.appendChild(btn);
  });

  // Si solo hay uno y aún no hay seleccionado, lo auto-seleccionamos
  if (!currentAgent && list.length === 1) {
    currentAgent = list[0];
    const firstBtn = agentButtonsOverlay.querySelector(".agent-btn");
    if (firstBtn) firstBtn.classList.add("selected");
  }
}

function renderMainAgentBar() {
  if (!mainAgentBar) return;

  mainAgentBar.innerHTML = "";

  if (!currentTerminal) return;

  const list = getAgentsForTerminalId(currentTerminal.id);
  if (!list.length) return;

  list.forEach((agent) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "agent-btn" +
      (currentAgent && currentAgent.codagente === agent.codagente
        ? " selected"
        : "");
    btn.textContent = agent.name;

    btn.onclick = async () => {
      // Código del agente que se ha pulsado
      const clickedCode = agent.codagente;

      // 1) Refrescamos TPVs y agentes desde la API
      await refreshTerminalsAndAgents();

      // 2) Volvemos a obtener la lista de agentes del TPV actual
      const currentList = currentTerminal
        ? getAgentsForTerminalId(currentTerminal.id)
        : [];

      // 3) Buscamos el agente pulsado en la lista actualizada
      let newCurrentAgent =
        currentList.find((a) => a.codagente === clickedCode) ||
        currentList[0] ||
        null;

      currentAgent = newCurrentAgent;

      // 4) Actualizamos el nombre en la cabecera
      if (agentNameEl) {
        agentNameEl.textContent = currentAgent ? currentAgent.name : "---";
      }

      // 5) Volvemos a redibujar la barra con la información nueva
      renderMainAgentBar();
    };

    mainAgentBar.appendChild(btn);
  });
}

function setCurrentAgent(agent) {
  currentAgent = agent || null;
}

function getAgentsForTerminal(terminalId) {
  if (!terminalId) return [];
  const tid = String(terminalId);
  return agents.filter((a) => String(a.terminalId) === tid);
}

// Overlay para elegir TPV / agente
function showTerminalOverlay(mode = "session") {
  if (LOGIN_ACTIVE) return;

  if (!terminalOverlay) return;

  terminalOverlayMode = mode;
  terminalErrorEl.textContent = "";

  // Rellenamos select de TPVs
  fillTerminalSelect();

  const multipleTpvs = terminals.length > 1;

  // ----- MODO CAMBIO RÁPIDO DE AGENTE -----
  if (mode === "agentSwitch") {
    // Solo cambiamos de agente en el TPV actual
    if (!currentTerminal) return;

    if (terminalSelectWrapper) terminalSelectWrapper.style.display = "none";

    const list = getAgentsForTerminalId(currentTerminal.id);
    if (list.length === 0) {
      // No hay agentes asignados a este TPV
      terminalErrorEl.textContent = "Este terminal no tiene agentes asignados.";
      return;
    }

    // Con 1 o más agentes mostramos los botones
    renderAgentButtonsOverlay(currentTerminal.id);
    terminalOverlay.classList.remove("hidden");
    return;
  }

  // ----- MODO SELECCIÓN PARA ABRIR CAJA -----

  // TPV
  if (terminalSelectWrapper) {
    if (multipleTpvs) {
      terminalSelectWrapper.style.display = "";
      // si hay un terminal actual, que quede seleccionado
      if (currentTerminal && terminalSelect) {
        terminalSelect.value = String(currentTerminal.id);
      }
    } else {
      terminalSelectWrapper.style.display = "none";
      if (terminals.length === 1) {
        setCurrentTerminal(terminals[0]);
      }
    }
  }

  // Agentes de ese TPV
  let selectedTerminalId;
  if (multipleTpvs && terminalSelect) {
    selectedTerminalId =
      terminalSelect.value || (terminals[0] && terminals[0].id);
  } else if (currentTerminal) {
    selectedTerminalId = currentTerminal.id;
  } else if (terminals[0]) {
    selectedTerminalId = terminals[0].id;
    setCurrentTerminal(terminals[0]);
  }

  renderAgentButtonsOverlay(selectedTerminalId);

  // Si no hay nada que elegir (<=1 TPV y sin/1 agente), abrimos directamente
  const list = getAgentsForTerminalId(selectedTerminalId);
  const multipleAgents = list.length > 1;

  if (!multipleTpvs && !multipleAgents) {
    terminalOverlay.classList.add("hidden");

    if (!currentTerminal) {
      if (terminals.length === 1) {
        setCurrentTerminal(terminals[0]);
      } else if (terminals.length === 0) {
        setCurrentTerminal({ id: "demo", name: "TPV demo" });
      }
    }

    if (!currentAgent && list.length === 1) {
      currentAgent = list[0];
    }

    openCashOpenDialog("open");
    return;
  }

  terminalOverlay.classList.remove("hidden");
}

if (terminalSelect) {
  terminalSelect.addEventListener("change", () => {
    if (terminalOverlayMode === "session") {
      renderAgentButtonsOverlay(terminalSelect.value);
    }
  });
}

function hideTerminalOverlay() {
  if (!terminalOverlay) return;
  terminalOverlay.classList.add("hidden");
}

function updateCloseSummary(countedTotal) {
  if (!cashCloseSummary) return;

  // Datos base de la sesión
  const opening = cashSession.openingTotal || 0;
  const cashIncome = cashSession.cashSalesTotal || 0;
  const movements = cashSession.cashMovementsTotal || 0;
  const expectedCash = opening + cashIncome + movements;
  const totalSales = cashSession.totalSales || 0;

  // Escribimos los valores
  if (sumOpeningEl)
    sumOpeningEl.textContent = opening.toFixed(2).replace(".", ",") + " €";
  if (sumCashIncomeEl)
    sumCashIncomeEl.textContent =
      cashIncome.toFixed(2).replace(".", ",") + " €";
  if (sumMovementsEl)
    sumMovementsEl.textContent = movements.toFixed(2).replace(".", ",") + " €";
  if (sumExpectedCashEl)
    sumExpectedCashEl.textContent =
      expectedCash.toFixed(2).replace(".", ",") + " €";
  if (sumCountedCashEl)
    sumCountedCashEl.textContent =
      countedTotal.toFixed(2).replace(".", ",") + " €";
  if (sumTotalSalesEl)
    sumTotalSalesEl.textContent =
      totalSales.toFixed(2).replace(".", ",") + " €";

  // 👇 actualizar listado de métodos de pago
  renderPayMethodsSummary();
}

function renderPayMethodsSummary() {
  const box = document.getElementById("payMethodsSummary");
  if (!box) return;

  const map = cashSession.paymentsByMethod || {};
  const entries = Object.values(map);

  box.innerHTML = "";

  if (!entries.length) {
    box.style.display = "none";
    return;
  }

  box.style.display = "flex";

  entries.sort((a, b) =>
    (a.label || a.code).localeCompare(b.label || b.code, "es")
  );

  entries.forEach((pm) => {
    const label = pm.label || pm.code;
    const total = Number(pm.total) || 0;

    const card = document.createElement("div");
    card.className = "cash-pay-card";

    card.innerHTML = `
      <div class="cash-pay-card-amount">${eur(total)}</div>
      <div class="cash-pay-card-label">${escapeHtml(label)}</div>
    `;

    box.appendChild(card);
  });
}

function renderCashPayMethodsSummary(payStats) {
  const wrap = document.getElementById("payMethodsSummary");
  if (!wrap) return;

  wrap.innerHTML = "";

  const title = document.createElement("div");
  title.className = "cash-paymethods-title";
  title.textContent = "Formas de pago usadas";
  wrap.appendChild(title);

  if (!Array.isArray(payStats) || !payStats.length) {
    const empty = document.createElement("div");
    empty.textContent = "Sin ventas en este periodo.";
    empty.style.fontSize = "12px";
    empty.style.opacity = "0.7";
    wrap.appendChild(empty);
    return;
  }

  const table = document.createElement("div");
  table.className = "cash-paymethods-table";
  wrap.appendChild(table);

  // Cabecera
  const emptyLabel = document.createElement("div");
  emptyLabel.className = "pm-label";
  table.appendChild(emptyLabel);

  payStats.forEach((m) => {
    const th = document.createElement("div");
    th.className = "pm-head";
    th.textContent = m.name;
    table.appendChild(th);
  });

  // Fila importes
  const lblImporte = document.createElement("div");
  lblImporte.className = "pm-label";
  lblImporte.textContent = "Importe";
  table.appendChild(lblImporte);

  payStats.forEach((m) => {
    const td = document.createElement("div");
    td.className = "pm-cell";
    td.textContent = euro2es(m.total); // usa tu helper de € que ya tienes
    table.appendChild(td);
  });

  // Fila nº cobros
  const lblCobros = document.createElement("div");
  lblCobros.className = "pm-label";
  lblCobros.textContent = "Cobros";
  table.appendChild(lblCobros);

  payStats.forEach((m) => {
    const td = document.createElement("div");
    td.className = "pm-cell pm-count";
    td.textContent = String(m.count || 0);
    table.appendChild(td);
  });
}

function cashResetUIForOpening() {
  // Inputs a 0
  document
    .querySelectorAll("#cashOpenOverlay .cash-grid-page input[data-denom]")
    .forEach((inp) => {
      inp.value = "0";
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.dispatchEvent(new Event("change", { bubbles: true }));
    });

  // Observaciones
  const obs = document.querySelector("#cashOpenOverlay #cashObs");
  if (obs) obs.value = "";

  // Totales
  const idsToZero = [
    "sumOpening",
    "sumCashIncome",
    "sumMovements",
    "sumExpectedCash",
    "sumCountedCash",
    "sumTotalSales",
    "cashOpenTotal",
  ];

  idsToZero.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = "0,00 €";
  });

  // 👇 limpiar formas de pago usadas en la nueva sesión
  cashSession.paymentsByMethod = {};
}

// ---- Apertura / cierre de caja ----
function openCashOpenDialog(mode = "open") {
  if (mode === "open") {
    cashResetUIForOpening();
    cashWrapInputsWithSteppers();
  }
  if (LOGIN_ACTIVE) return;

  if (!cashOpenOverlay) return;
  if (!currentTerminal) {
    toast("Selecciona un terminal primero.", "warn", "Caja");
    return;
  }

  cashDialogMode = mode;

  // Cambiar título y texto del botón según modo
  const titleEl = document.getElementById("cashDialogTitle");
  if (titleEl) {
    titleEl.textContent =
      mode === "open" ? "Apertura de caja" : "Cierre de caja";
  }
  if (cashOpenOkBtn) {
    cashOpenOkBtn.textContent = mode === "open" ? "Abrir caja" : "Cerrar caja";
  }

  // Mostrar/ocultar resumen extendido
  if (cashCloseSummary) {
    cashCloseSummary.style.display = mode === "close" ? "block" : "none";
  }

  // Poner nombre del terminal
  if (cashOpenTerminalName) {
    cashOpenTerminalName.textContent = currentTerminal.name;
  }

  const inputs = cashOpenOverlay.querySelectorAll(
    ".cash-grid-page input[data-denom]"
  );

  inputs.forEach((inp) => (inp.value = "0"));

  if (mode === "open") {
    // Apertura: empezamos siempre en 0
    inputs.forEach((inp) => {
      inp.value = "0";
    });
    cashOpenOverlay.querySelectorAll(".cash-qty").forEach((s) => {
      s.textContent = "0";
    });
  } else {
    // Cierre: también empezamos en 0 (el trabajador cuenta desde cero)
    inputs.forEach((inp) => {
      inp.value = "0";
    });
    cashOpenOverlay.querySelectorAll(".cash-qty").forEach((s) => {
      s.textContent = "0";
    });
  }

  // Recalcular total según valores actuales
  updateCashOpenTotal();

  cashOpenOverlay.classList.remove("hidden");
}

function getCashHiddenInput(denom) {
  return cashOpenOverlay?.querySelector(
    `.cash-hidden-input[data-denom="${denom}"]`
  );
}

function syncCashQtyLabel(denom, qty) {
  const label = cashOpenOverlay?.querySelector(
    `.cash-qty[data-denom="${denom}"]`
  );
  if (label) label.textContent = String(qty);
}

function setCashQtyByDenom(denom, qty) {
  const inp = getCashHiddenInput(denom);
  if (!inp) return;

  const n = Math.max(0, Math.floor(Number(qty) || 0));
  inp.value = String(n);
  syncCashQtyLabel(denom, n);
  updateCashOpenTotal();
}

function getCashQtyByDenom(denom) {
  const inp = getCashHiddenInput(denom);
  return Math.max(0, parseInt(inp?.value || "0", 10) || 0);
}

// Delegación de click para + / − / editar
if (cashOpenOverlay && !cashOpenOverlay.dataset.cashBound) {
  cashOpenOverlay.dataset.cashBound = "1";

  cashOpenOverlay.addEventListener("click", (e) => {
    const minusBtn = e.target.closest('.cash-step-btn[data-action="minus"]');
    const plusBtn = e.target.closest('.cash-step-btn[data-action="plus"]');
    const editBtn = e.target.closest('.cash-qty-btn[data-action="edit"]');

    // Averigua denom desde el botón o desde la celda
    const cell = e.target.closest(".cash-cell");
    if (!cell) return;

    const denom =
      editBtn?.dataset?.denom ||
      cell.querySelector(".cash-qty")?.dataset?.denom ||
      cell.querySelector(".cash-hidden-input")?.dataset?.denom;

    if (!denom) return;

    const current = getCashQtyByDenom(denom);

    if (minusBtn) {
      setCashQtyByDenom(denom, current - 1);
      return;
    }

    if (plusBtn) {
      setCashQtyByDenom(denom, current + 1);
      return;
    }

    if (editBtn) {
      // Abre tu numpad existente
      openNumPad(
        String(current),
        (newQty) => setCashQtyByDenom(denom, newQty),
        `Cantidad de ${denom} €`,
        "qty"
      );
      return;
    }
  });
}

function hideCashOpenDialog() {
  if (!cashOpenOverlay) return;
  cashOpenOverlay.classList.add("hidden");
}

function updateCashOpenTotal() {
  if (!cashOpenOverlay || !cashOpenTotalEl) return;

  let total = 0;
  const inputs = cashOpenOverlay.querySelectorAll(".cash-hidden-input");
  const breakdown = [];

  inputs.forEach((inp) => {
    const denom = parseFloat(inp.dataset.denom || "0");
    const qty = parseInt(inp.value || "0", 10);

    if (isNaN(denom) || isNaN(qty)) return;

    const lineTotal = denom * qty;
    total += lineTotal;

    if (qty > 0) {
      breakdown.push({
        denom,
        qty,
        total: lineTotal,
      });
    }
  });

  if (cashDialogMode === "open") {
    // Guardamos apertura
    cashSession.openingTotal = total;
    cashSession.openingBreakdown = breakdown.map((b) => ({ ...b }));
    // Estado actual de la caja al abrir (teórico)
    cashSession.currentCashBreakdown = breakdown.map((b) => ({ ...b }));
  } else {
    // Guardamos cierre (conteo de caja)
    cashSession.closingTotal = total;
    cashSession.closingBreakdown = breakdown.map((b) => ({ ...b }));
    // Para el resumen extendido de cierre
    updateCloseSummary(total);
  }

  // Total mostrado en la línea principal del diálogo
  cashOpenTotalEl.textContent = total.toFixed(2).replace(".", ",") + " €";
}

function syncCashInput(visibleInput) {
  const denom = visibleInput.dataset.denom;
  const hidden = document.querySelector(
    `.cash-hidden-input[data-denom="${denom}"]`
  );

  if (!hidden) return;

  const val = Math.max(0, parseInt(visibleInput.value || "0", 10));
  hidden.value = val;
  visibleInput.value = val;

  updateCashOpenTotal();
}

async function confirmCashOpening() {
  cashSession.open = true;
  cashSession.openedAt = new Date().toISOString();

  // ✅ Crear log en FacturaScripts (sin romper si falla)
  try {
    await apiOpenCashInFS();
  } catch (e) {
    console.warn("No se pudo abrir caja en FacturaScripts:", e?.message || e);
    toast(
      "Caja abierta, pero no se pudo registrar en FacturaScripts.",
      "warn",
      "Caja"
    );
  }

  hideCashOpenDialog();

  if (terminalNameEl && currentTerminal) {
    terminalNameEl.textContent = currentTerminal.name || "---";
  }
  if (agentNameEl) {
    agentNameEl.textContent = currentAgent ? currentAgent.name : "---";
  }

  renderMainUI();
  renderMainAgentBar();
  updateCashButtonLabel();

  console.log("Caja abierta:", cashSession);
}

async function confirmCashClosing() {
  cashSession.open = false;

  // ✅ Cerrar log en FacturaScripts (antes de limpiar estado local)
  try {
    await apiCloseCashInFS();
  } catch (e) {
    console.warn("No se pudo cerrar caja en FacturaScripts:", e?.message || e);
    toast(
      "Caja cerrada, pero no se pudo registrar el cierre en FacturaScripts.",
      "warn",
      "Caja"
    );
  }

  hideCashOpenDialog();
  updateCashButtonLabel();

  // Dejar TPV y agente "des-seleccionados"
  currentTerminal = null;
  currentAgent = null;
  if (terminalNameEl) terminalNameEl.textContent = "---";
  if (agentNameEl) agentNameEl.textContent = "---";
  refreshLoggedUserUI();

  if (mainAgentBar) mainAgentBar.innerHTML = ""; // limpiar barra principal

  // Limpiar visor de productos y carrito
  selectedCategory = null;
  activeFamilyParentId = null;
  activeSubfamilyId = null;
  cart = [];
  renderCart();

  const grid = document.getElementById("productsGrid");
  const catContainer = document.getElementById("categories");
  const subCatContainer = document.getElementById("subcategories");
  if (grid) grid.innerHTML = "";
  if (catContainer) catContainer.innerHTML = "";
  if (subCatContainer) subCatContainer.innerHTML = "";

  mainUiRendered = false;

  console.log("Caja cerrada:", cashSession);
  const printBtn = document.getElementById("printTicketBtn");
  if (printBtn) {
    printBtn.disabled = true;
  }
  lastTicket = null;
}

function resetTPVToEmpty() {
  unlockAppUI();
  // Cierra overlays que pudieran estar abiertos
  try {
    hideTerminalOverlay();
  } catch (e) {}
  try {
    hideCashOpenDialog();
  } catch (e) {}
  try {
    closeOptions();
  } catch (e) {}
  try {
    closeParkedModal();
  } catch (e) {}
  try {
    payOverlay?.classList.add("hidden");
  } catch (e) {}

  // Estado de caja / selección
  cashSession.open = false;
  currentTerminal = null;
  currentAgent = null;

  if (terminalNameEl) terminalNameEl.textContent = "---";
  if (agentNameEl) agentNameEl.textContent = "---";

  if (mainAgentBar) mainAgentBar.innerHTML = "";

  // Limpia carrito y UI productos
  selectedCategory = null;
  activeFamilyParentId = null;
  activeSubfamilyId = null;
  cart = [];
  renderCart();

  const grid = document.getElementById("productsGrid");
  const catContainer = document.getElementById("categories");
  const subCatContainer = document.getElementById("subcategories");
  if (grid) grid.innerHTML = "";
  if (catContainer) catContainer.innerHTML = "";
  if (subCatContainer) subCatContainer.innerHTML = "";

  mainUiRendered = false;
  lastTicket = null;

  const printBtn = document.getElementById("printTicketBtn");
  if (printBtn) printBtn.disabled = true;

  updateCashButtonLabel();
  setStatusText("—");
}

// ===== Llamadas a API Recipok / FacturaScripts =====
async function fetchApiResource(resource) {
  const cfg = window.RECIPOK_API;
  if (!cfg || !cfg.baseUrl || !cfg.apiKey) {
    throw new Error("Config API no definida");
  }

  const url = `${cfg.baseUrl}/${resource}?limit=0`;

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      Token: cfg.apiKey,
    },
  });

  // Si el servidor devuelve 429, paramos aquí con un mensaje claro
  if (res.status === 429) {
    throw new Error(
      "La API ha devuelto 429 (demasiadas peticiones). " +
        "Es un bloqueo temporal por seguridad. Espera unos minutos antes de seguir usando el TPV."
    );
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    console.error(`Respuesta no es JSON para ${resource}:`, e);
    throw new Error(`Respuesta no válida en ${resource}`);
  }

  if (data && data.status === "error") {
    throw new Error(data.message || `Error API en ${resource}`);
  }

  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} en ${resource}: ${res.statusText || ""}`
    );
  }

  if (!Array.isArray(data)) {
    console.warn(`Formato inesperado para ${resource}:`, data);
  }

  return data;
}

async function fetchFormasPagoActivas(opts = {}) {
  const { forceOnlineIfPossible = false } = opts;

  // Si estamos offline y no forzamos online, devolvemos cache
  if (!forceOnlineIfPossible && TPV_STATE?.offline) {
    const cached = loadPayMethodsCache();
    return Array.isArray(cached) ? cached : [];
  }

  try {
    // Online: pedir al endpoint
    const data = await fetchApiResourceWithParams("formapagos", {
      limit: 200,
      order: "asc",
      "filter[activa]": 1, // FacturaScripts suele aceptar 1/0
    });

    const list = (Array.isArray(data) ? data : [])
      .filter((f) => f && f.activa === true) // por si el filtro no se aplica en server
      // opcional: solo imprimibles
      // .filter((f) => f.imprimir !== false)
      .map((f) => ({
        activa: !!f.activa,
        codpago: String(f.codpago || "").trim(),
        descripcion: String(f.descripcion || f.codpago || "").trim(),
        domiciliado: !!f.domiciliado,
        imprimir: f.imprimir !== false,
        pagado: !!f.pagado,
        plazovencimiento: Number(f.plazovencimiento || 0),
        tipovencimiento: String(f.tipovencimiento || "days"),
        idempresa: f.idempresa ?? null,
        codcuentabanco: f.codcuentabanco ?? null,
      }))
      .filter((x) => x.codpago);

    // Guardar caché SIEMPRE que haya algo válido
    if (list.length) savePayMethodsCache(list);

    return list;
  } catch (e) {
    // Fallback: si falla online, usamos caché
    const cached = loadPayMethodsCache();
    if (Array.isArray(cached) && cached.length) return cached;

    // Último fallback: efectivo
    return [{ codpago: "CONT", descripcion: "Al contado", imprimir: true }];
  }
}

// Eventos overlay terminal (modo selección para abrir caja o cambio rápido)
if (terminalOkBtn) {
  terminalOkBtn.onclick = () => {
    // CAMBIO RÁPIDO DE AGENTE
    if (terminalOverlayMode === "agentSwitch") {
      const list = currentTerminal
        ? getAgentsForTerminalId(currentTerminal.id)
        : [];
      if (list.length >= 1 && !currentAgent) {
        terminalErrorEl.textContent = "Selecciona un agente válido.";
        return;
      }
      if (agentNameEl && currentAgent) {
        agentNameEl.textContent = currentAgent.name;
      }
      renderMainAgentBar();
      hideTerminalOverlay();
      return;
    }

    // MODO SESIÓN (abrir caja)
    let selectedTerminal = currentTerminal;

    if (terminals.length > 1 && terminalSelectWrapper && terminalSelect) {
      const selectedId = terminalSelect.value;
      selectedTerminal = terminals.find(
        (t) => String(t.id) === String(selectedId)
      );
      if (!selectedTerminal) {
        terminalErrorEl.textContent = "Selecciona un terminal válido.";
        return;
      }
      setCurrentTerminal(selectedTerminal);
    }

    const list = selectedTerminal
      ? getAgentsForTerminalId(selectedTerminal.id)
      : [];

    if (list.length > 1 && !currentAgent) {
      terminalErrorEl.textContent = "Selecciona un agente válido.";
      return;
    }

    if (!currentAgent && list.length === 1) {
      currentAgent = list[0];
    }

    hideTerminalOverlay();
    openCashOpenDialog("open");
  };
}

if (terminalExitBtn) {
  terminalExitBtn.onclick = () => {
    hideTerminalOverlay();
  };
}

// Eventos apertura de caja
if (cashOpenOverlay) {
  const inputs = cashOpenOverlay.querySelectorAll(".cash-hidden-input");
  inputs.forEach((inp) => {
    inp.addEventListener("input", updateCashOpenTotal);
  });
}

const cashOpenCancelBtn = document.getElementById("cashOpenCancelBtn");
const cashOpenOkBtn = document.getElementById("cashOpenOkBtn");

if (cashOpenCancelBtn) {
  cashOpenCancelBtn.onclick = () => {
    hideCashOpenDialog();

    // Si estábamos abriendo caja y aún no hay caja abierta,
    // dejamos TPV y agente visualmente como "---"
    if (cashDialogMode === "open" && !cashSession.open) {
      currentTerminal = null;
      currentAgent = null;
      if (terminalNameEl) terminalNameEl.textContent = "---";
      if (agentNameEl) agentNameEl.textContent = "---";
    }
  };
}

if (cashOpenOkBtn) {
  cashOpenOkBtn.onclick = async () => {
    if (cashDialogMode === "open") {
      await confirmCashOpening();
      return;
    }

    // ✅ BLOQUEO: no permitir cerrar caja con tickets aparcados
    const parkedCount = Array.isArray(parkedTickets) ? parkedTickets.length : 0;

    if (parkedCount > 0) {
      await confirmModal(
        "No puedes cerrar la caja",
        `Tienes ${parkedCount} ticket(s) aparcado(s).\n\nRecupéralos (o elimínalos) antes de cerrar la caja.`
      );
      openParkedModal(); // 👈 llevarle directo a los aparcados
      return;
    }

    await confirmCashClosing();
  };
}

// ===== Caja (logs) en FacturaScripts =====

// 1) Request genérico (form-urlencoded) para POST/PUT/DELETE
async function apiWrite(resource, method = "POST", fields = {}) {
  const cfg = window.RECIPOK_API || {};
  if (!cfg.baseUrl || !cfg.apiKey) throw new Error("Config API no definida");

  const base = cfg.baseUrl.replace(/\/+$/, "");
  const url = `${base}/${String(resource).replace(/^\/+/, "")}`;

  const body = new URLSearchParams();
  Object.entries(fields || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    body.append(k, String(v));
  });

  const res = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      Token: cfg.apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (res.status === 429) throw new Error("API 429 (demasiadas peticiones).");

  const data = await res.json().catch(() => null);

  if (!res.ok || (data && data.status === "error")) {
    throw new Error(data?.message || `HTTP ${res.status} en ${resource}`);
  }

  return data;
}

async function apiCreatePresupuestoFromCart(obs = "") {
  if (TPV_STATE.offline || TPV_STATE.locked) return null;

  const cfg = window.RECIPOK_API || {};
  if (!cfg.baseUrl || !cfg.apiKey) {
    console.warn("Sin config de API para crear presupuesto.");
    return null;
  }

  const payload = buildPresupuestoPayloadFromCart(obs);

  const base = cfg.baseUrl.replace(/\/+$/, "");
  const url = `${base}/crearPresupuestoCliente`;

  const body = new URLSearchParams();

  body.append("codcliente", payload.codcliente);

  if (payload.codalmacen) body.append("codalmacen", payload.codalmacen);
  if (payload.codpago) body.append("codpago", payload.codpago);
  if (payload.codserie) body.append("codserie", payload.codserie);
  if (payload.fecha) body.append("fecha", payload.fecha);
  if (payload.observaciones)
    body.append("observaciones", payload.observaciones);

  body.append("aparcado", payload.aparcado ? "1" : "0");

  if (payload.idtpv) body.append("idtpv", String(payload.idtpv));
  if (payload.idcaja) body.append("idcaja", String(payload.idcaja));

  // Igual que en crearFacturaCliente: líneas como JSON
  body.append("lineas", JSON.stringify(payload.lineas));

  // 🔍 Log de depuración parecido al de la factura
  console.log(">>> Enviando a crearPresupuestoCliente:", body.toString());

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Token: cfg.apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || (data && data.status === "error")) {
      throw new Error(data?.message || "Error creando presupuesto");
    }

    console.log("Respuesta OK crearPresupuestoCliente:", data);
    return data;
  } catch (e) {
    console.warn("No se pudo crear presupuesto en FacturaScripts:", e);
    toast(
      "Ticket aparcado solo en local (no se registró en FacturaScripts).",
      "warn",
      "Aparcar"
    );
    return null;
  }
}

// 2) Fecha/hora estilo FacturaScripts: "YYYY-MM-DD HH:mm:ss"
function nowFs() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 3) Abrir/cerrar caja remota (tpvcajas)
// NOTA: si en tu FS el recurso no es "tpvcajas", lo cambiamos al real.
async function apiOpenCashInFS() {
  if (TPV_STATE.offline || TPV_STATE.locked) return null;
  if (!currentTerminal?.id) throw new Error("No hay terminal seleccionado");

  const payload = {
    idtpv: Number(currentTerminal.id),
    fechaini: nowFs(),
    dineroini: Number(cashSession.openingTotal || 0),
    nick: getLoginUser(), // ✅
    observaciones: "",
  };

  const resp = await apiWrite("tpvcajas", "POST", payload);

  const doc = resp?.doc || resp?.data || resp;
  const remoteId = doc?.idcaja ?? null;

  cashSession.remoteCajaId = remoteId;
  return resp;
}

async function apiCloseCashInFS() {
  if (TPV_STATE.offline || TPV_STATE.locked) return null;

  const remoteId = cashSession.remoteCajaId;
  if (!remoteId) {
    console.warn("No hay cashSession.remoteCajaId: no cierro caja en FS.");
    return null;
  }

  const opening = Number(cashSession.openingTotal || 0);
  const cashIncome = Number(cashSession.cashSalesTotal || 0);
  const movements = Number(cashSession.cashMovementsTotal || 0);

  const expectedCash = opening + cashIncome + movements; // totalcaja
  const counted = Number(cashSession.closingTotal || 0); // dinerofin
  const diff = counted - expectedCash; // diferencia

  // Si quieres contar tickets reales, lo calculamos luego.
  const numtickets = 0;
  const totaltickets = Number(cashSession.totalSales || 0);

  const payload = {
    fechafin: nowFs(),
    dinerofin: counted,
    ingresos: cashIncome,
    nick: getLoginUser(),
    totalmovi: movements,
    totalcaja: expectedCash,
    diferencia: diff,
    numtickets,
    totaltickets,
    observaciones: "",
  };

  return await apiWrite(`tpvcajas/${remoteId}`, "PUT", payload);
}

// Botón abrir/cerrar caja (header "Caja")
if (cashHeaderBtn) {
  cashHeaderBtn.onclick = async () => {
    // 0) Bloqueado
    if (TPV_STATE.locked) {
      showMessageModal(
        "Acceso bloqueado",
        "Tu cuenta de TPV está desactivada. Contacta con soporte."
      );
      return;
    }

    // 1) Si NO hay empresa resuelta, el click debe pedir email (no login)
    if (!hasCompanyResolved()) {
      await forceReconnectFlow(); // pide email + valida + carga datos
      if (!hasCompanyResolved()) return; // cancelado o falló
    }

    // 1.5) Si hay empresa pero seguimos OFFLINE, intentamos reconectar sin pedir email
    if (TPV_STATE.offline) {
      try {
        await loadDataFromApi(); // esto ya pone offline=false si conecta
      } catch (e) {
        // si sigue offline, paramos aquí para evitar abrir caja/login en demo
      }
      if (TPV_STATE.offline) {
        toast(
          "Sin conexión. Reintenta cuando tengas internet.",
          "warn",
          "Caja"
        );
        return;
      }
    }

    await ensureDataLoaded();

    // 2) Ya hay empresa → ahora sí exigimos login
    if (!getLoginToken() || !getLoginUser()) {
      const ok = await openLoginModal();
      if (!ok) return;
    }

    // 3) Comportamiento normal
    if (cashSession.open) {
      const parkedCount = Array.isArray(parkedTickets)
        ? parkedTickets.length
        : 0;

      if (parkedCount > 0) {
        await confirmModal(
          "Tickets aparcados",
          `Tienes ${parkedCount} ticket${
            parkedCount === 1 ? "" : "s"
          } aparcado${
            parkedCount === 1 ? "" : "s"
          }.\n\nAntes de cerrar la caja, recupera o elimina los tickets aparcados.`
        );
        openParkedModal();
        return;
      }

      openCashOpenDialog("close");
      return;
    }

    await refreshTerminalsAndAgents();

    if (terminals.length === 0) {
      if (!currentTerminal)
        setCurrentTerminal({ id: "demo", name: "TPV demo" });

      // ✅ Resetear valores y reenganchar steppers ANTES de mostrar
      cashResetUIForOpening();
      cashWrapInputsWithSteppers();

      openCashOpenDialog("open");
      return;
    }

    showTerminalOverlay("session");
  };
}

// Click en nombre de agente para cambio rápido / refrescar lista
if (agentNameEl) {
  agentNameEl.addEventListener("click", async () => {
    if (!currentTerminal) return;

    // Siempre refrescamos primero desde la API
    await refreshTerminalsAndAgents();

    const list = getAgentsForTerminalId(currentTerminal.id);

    // Si no hay agentes, no hacemos nada
    if (list.length === 0) {
      return;
    }

    // Con 1 o más agentes abrimos el overlay para que se vea la lista actual
    showTerminalOverlay("agentSwitch");
  });
}

if (userNameEl) {
  userNameEl.addEventListener("click", async () => {
    await doLogoutFlow();
  });
}

// ===== Carga de datos desde la API de Recipok =====
async function loadDataFromApi() {
  console.log("loadDataFromApi() ejecutándose con:", window.RECIPOK_API);
  try {
    const cfg = window.RECIPOK_API || {};

    // Si no hay config, usamos modo demo
    if (!cfg.baseUrl || !cfg.apiKey) {
      console.warn("Config API Recipok no definida. Usando datos de demo.");

      categories = demoCategories.map((c) => ({ ...c, parentId: null }));
      products = [...demoProducts];

      setStatusText("Offline (demo)");
      renderMainUI();
      TPV_STATE.offline = true;
      TPV_STATE.locked = false;
      updateCashButtonLabel();
      toast("Modo demo (sin conexión). Pulsa “Conectar” en Caja.", "info");
      return;
    }

    // base de la API, tal cual (normalmente acaba en /api/3)
    apiBaseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");

    // base para ficheros: quitamos el sufijo /api/loquesea
    filesBaseUrl = apiBaseUrl.replace(/\/api\/[^/]+$/i, "");

    setStatusText("Conectando API...");

    // 1) Cargamos lo principal EN PARALELO (sin impuestos todavía)
    const [
      familiasRaw,
      productosData,
      tpvTerminales,
      variantesData,
      empresasData,
      productImagesMap,
    ] = await Promise.all([
      fetchApiResource("familias"),
      fetchApiResource("productos"),
      fetchApiResource("tpvterminales"),
      fetchApiResource("variantes"),
      fetchApiResource("empresas"),
      // mapa de imágenes (si falla, devolvemos objeto vacío para no romper nada)
      buildProductImagesMap().catch((e) => {
        console.warn(
          "No se pudieron cargar imágenes de productos:",
          e.message || e
        );
        return {};
      }),
    ]);

    companyInfo =
      Array.isArray(empresasData) && empresasData[0] ? empresasData[0] : null;
    await loadCompanyLogoUrl();

    // Mapa de imágenes devuelto (aunque buildProductImagesMap ya lo asigna)
    if (productImagesMap && typeof productImagesMap === "object") {
      PRODUCT_IMAGES_MAP = productImagesMap;
    }

    // 2) INTENTAMOS cargar impuestos en una llamada aparte.
    //    Si falla (429, etc.), seguimos funcionando con el fallback de extractTaxRateFromCode.
    taxRatesByCode = {};
    try {
      const impuestosData = await fetchApiResource("impuestos");
      if (Array.isArray(impuestosData)) {
        impuestosData.forEach((imp) => {
          const code = String(
            imp.codimpuesto || imp.codigo || imp.id || ""
          ).trim();
          if (!code) return;

          // Diferentes instalaciones pueden usar campos distintos.
          let rate =
            imp.iva ?? imp.porcentaje ?? imp.porcentajeiva ?? imp.impuesto ?? 0;

          rate = Number(rate);
          if (isNaN(rate)) rate = 0;

          taxRatesByCode[code] = rate;
        });
      }
    } catch (e) {
      console.warn(
        "No se pudieron cargar los impuestos. Usaremos el % deducido del código (IVA10 → 10, IVA21 → 21, etc.):",
        e.message || e
      );
      taxRatesByCode = {}; // forzamos a que se use extractTaxRateFromCode
    }

    // 3) TPV-agentes (los envolvemos en su propio try/catch para que no rompa todo)
    let tpvAgentesData = [];
    let agentesMaestros = [];
    try {
      [tpvAgentesData, agentesMaestros] = await Promise.all([
        fetchApiResource("tpvagentes"),
        fetchApiResource("agentes"),
      ]);
    } catch (e) {
      console.warn("No se pudieron cargar tpvagentes/agentes:", e.message || e);
    }

    // ===== Familias -> categories (incluye padre/hijos) =====
    if (Array.isArray(familiasRaw) && familiasRaw.length) {
      const visibles = familiasRaw.filter((f) => {
        const flag = f.tpv_show ?? f.tpv ?? f.mostrarentpv ?? f.mostrar_en_tpv;
        return !isFalseFlag(flag);
      });

      visibles.sort((a, b) => {
        const sa = Number(a.tpv_sort ?? a.tpvsort ?? a.orden ?? 0);
        const sb = Number(b.tpv_sort ?? b.tpvsort ?? b.orden ?? 0);
        if (sa !== sb) return sa - sb;
        const na = String(a.descripcion ?? a.nombre ?? a.codfamilia ?? "");
        const nb = String(b.descripcion ?? b.nombre ?? b.codfamilia ?? "");
        return na.localeCompare(nb, "es");
      });

      categories = visibles.map((f, idx) => ({
        id: String(f.codfamilia ?? f.id ?? idx),
        name: String(f.descripcion ?? f.nombre ?? f.codfamilia ?? ""),
        parentId: f.madre ? String(f.madre) : null,
        color: "#007bff",
      }));
    } else {
      if (!categories.length) {
        categories = demoCategories.map((c) => ({ ...c, parentId: null }));
      }
    }

    // ===== Productos + variantes -> products =====
    if (Array.isArray(productosData) && productosData.length) {
      const productoById = new Map();
      productosData.forEach((p, idx) => {
        const idProd = Number(p.idproducto ?? p.id ?? idx);
        if (!idProd) return;
        productoById.set(idProd, p);
      });

      // Agrupamos variantes por producto
      const variantsByProduct = {};
      if (Array.isArray(variantesData) && variantesData.length) {
        variantesData.forEach((v, idx) => {
          const baseId = Number(v.idproducto);
          if (!baseId) return;
          if (!variantsByProduct[baseId]) variantsByProduct[baseId] = [];
          variantsByProduct[baseId].push({ v, idx });
        });
      }

      const combined = [];

      // ---- PRODUCTOS CON VARIANTES ----
      Object.entries(variantsByProduct).forEach(([baseIdStr, list]) => {
        const baseId = Number(baseIdStr);
        const base = productoById.get(baseId);
        if (!base) return;

        if (base.bloqueado || isFalseFlag(base.sevende)) return;

        const baseName = String(
          base.descripcion ?? base.referencia ?? ""
        ).trim();
        const category = String(base.codfamilia ?? "");

        // IVA del producto base
        const codImpuestoBase = base.codimpuesto || null;
        const taxRateBase = extractTaxRateFromCode(codImpuestoBase);

        const baseSort = Number(base.tpv_sort ?? base.tpvsort ?? 0) || 0;
        const baseSortKey = baseSort * 1000;

        // 👇 imagen del producto base
        const imgInfoBase = PRODUCT_IMAGES_MAP[baseId] || null;

        const sortedVariants = list.slice().sort((a, b) => a.idx - b.idx);

        sortedVariants.forEach(({ v, idx }, pos) => {
          let mainName = String(v.referencia ?? "").trim();
          if (!mainName) {
            mainName = baseName;
          }
          if (!mainName || mainName === "-") return;

          const price = Number(v.precio ?? base.precio ?? 0);
          const idVar = Number(v.idvariante ?? v.id ?? baseId * 1000 + pos);

          const secondaryName =
            baseName && mainName !== baseName ? baseName : "";

          combined.push({
            id: idVar,
            name: mainName,
            secondaryName,
            price,
            category,
            sortKey: baseSortKey + pos,
            baseProductId: baseId,
            isVariant: true,
            variantOrder: pos,
            isPrimaryVariant: pos === 0,
            codimpuesto: codImpuestoBase,
            taxRate: taxRateBase,
            // 👇 misma imagen que el producto base
            imageUrl: imgInfoBase ? imgInfoBase.url : null,
          });
        });
      });

      // ---- PRODUCTOS SIN VARIANTES ----
      productosData.forEach((p, idx) => {
        const idProd = Number(p.idproducto ?? p.id ?? idx);
        if (!idProd) return;

        if (variantsByProduct[idProd]) return;

        if (p.bloqueado || isFalseFlag(p.sevende)) return;

        const name = String(p.descripcion ?? p.referencia ?? "").trim();
        if (!name || name === "-") return;

        const price = Number(p.precio ?? 0);
        const category = String(p.codfamilia ?? "");

        const codimpuesto = p.codimpuesto || null;
        const taxRate = extractTaxRateFromCode(codimpuesto);

        const baseSort = Number(p.tpv_sort ?? p.tpvsort ?? 0) || 0;

        // 👇 imagen directa del producto (si tiene)
        const imgInfo = PRODUCT_IMAGES_MAP[idProd] || null;

        combined.push({
          id: idProd,
          name,
          secondaryName: "",
          price,
          category,
          sortKey: baseSort * 1000,
          baseProductId: idProd,
          isVariant: false,
          variantOrder: 0,
          isPrimaryVariant: true,
          codimpuesto,
          taxRate,
          imageUrl: imgInfo ? imgInfo.url : null,
        });
      });

      // ---- ORDEN FINAL ----
      combined.sort((a, b) => {
        const sa = a.sortKey || 0;
        const sb = b.sortKey || 0;
        if (sa !== sb) return sa - sb;

        if (a.baseProductId === b.baseProductId) {
          return (a.variantOrder ?? 0) - (b.variantOrder ?? 0);
        }

        return a.name.localeCompare(b.name, "es");
      });

      products = combined;
    } else {
      if (!products.length) products = [...demoProducts];
    }

    // ===== Terminales -> terminals =====
    if (Array.isArray(tpvTerminales) && tpvTerminales.length) {
      terminals = tpvTerminales.map((t, idx) => {
        const id = String(t.idtpv ?? t.id ?? idx);
        return {
          id,
          name: t.name || t.descripcion || `TPV ${id}`,
          codalmacen: t.codalmacen || null,
          productlimit: t.productlimit || null,
        };
      });
    } else {
      terminals = [];
    }

    // ===== Agentes =====
    const agentNameByCode = {};
    if (Array.isArray(agentesMaestros)) {
      agentesMaestros.forEach((a) => {
        const code = String(a.codagente ?? "");
        if (!code) return;
        agentNameByCode[code] = a.nombre || a.name || `Agente ${code}`;
      });
    }

    agentsByTerminal = {};
    const allAgentsMap = {};

    if (Array.isArray(tpvAgentesData)) {
      tpvAgentesData.forEach((rel) => {
        const tpvIdRaw = rel.idtpv ?? rel.codtpv ?? rel.idtpvterminal ?? rel.id;
        const codag = rel.codagente ?? rel.idagente ?? rel.idagente2;
        if (!tpvIdRaw || !codag) return;

        const tpvKey = String(tpvIdRaw);
        const code = String(codag);
        const name =
          agentNameByCode[code] || rel.nombre || rel.name || `Agente ${code}`;

        const agentObj = {
          id: code,
          codagente: code,
          name,
        };

        if (!agentsByTerminal[tpvKey]) agentsByTerminal[tpvKey] = [];
        if (
          !agentsByTerminal[tpvKey].some(
            (a) => a.codagente === agentObj.codagente
          )
        ) {
          agentsByTerminal[tpvKey].push(agentObj);
        }

        allAgentsMap[code] = agentObj;
      });
    }

    agents = Object.values(allAgentsMap);

    // ===== Estado online + lógica de selección de TPV / agente =====
    setStatusText("Online Recipok");

    TPV_STATE.offline = false;
    TPV_STATE.locked = false;
    updateCashButtonLabel();

    const numTerminals = terminals.length;
    const onlyTerminal = numTerminals === 1 ? terminals[0] : null;
    const listForOnlyTerminal = onlyTerminal
      ? getAgentsForTerminalId(onlyTerminal.id)
      : [];

    if (onlyTerminal && listForOnlyTerminal.length <= 1) {
      setCurrentTerminal(onlyTerminal);
      currentAgent = listForOnlyTerminal[0] || null;
      openCashOpenDialog("open");
    } else if (numTerminals > 0 || agents.length > 0) {
      showTerminalOverlay("session");
    } else {
      renderMainUI();
    }
  } catch (err) {
    console.error("Error llamando a la API de Recipok:", err);
    setStatusText("Offline (demo)");

    TPV_STATE.offline = true;
    TPV_STATE.locked = false;
    updateCashButtonLabel();
    toast("Sin conexión. Modo demo.", "warn");

    if (!categories.length) {
      categories = demoCategories.map((c) => ({ ...c, parentId: null }));
    }
    if (!products.length) products = [...demoProducts];

    renderMainUI();
  }
}

refreshLoggedUserUI();

let companyInfo = null; // ya lo tienes
let companyLogoUrl = ""; // ✅ GLOBAL

async function loadCompanyLogoUrl() {
  try {
    if (!companyInfo || !companyInfo.idlogo) return "";

    const files = await fetchApiResource("attachedfiles");
    if (!Array.isArray(files)) return "";

    const f = files.find(
      (x) => Number(x.idfile) === Number(companyInfo.idlogo)
    );
    if (!f) return "";

    const rel = f["download-permanent"] || f.download || "";
    if (!rel) return "";

    // filesBaseUrl = https://plus.recipok.com/slug (sin /api/3)
    const base = (filesBaseUrl || "").replace(/\/+$/, "");
    const path = String(rel).replace(/^\/+/, "");

    companyLogoUrl = `${base}/${path}`;
    return companyLogoUrl;
  } catch (e) {
    console.warn("No se pudo cargar logo:", e);
    companyLogoUrl = "";
    return "";
  }
}

async function loadCompanyInfo() {
  try {
    const data = await fetchApiResource("empresas");
    if (Array.isArray(data) && data.length) {
      companyInfo = data[0]; // normalmente hay 1
      return companyInfo;
    }
    companyInfo = null;
    return null;
  } catch (e) {
    console.warn("No se pudo cargar empresas:", e);
    companyInfo = null;
    return null;
  }
}

async function refreshTerminalsAndAgents() {
  const cfg = window.RECIPOK_API;
  if (!cfg || !cfg.baseUrl || !cfg.apiKey) return;

  try {
    const [tpvTerminales, tpvAgentesData, agentesMaestros] = await Promise.all([
      fetchApiResource("tpvterminales"),
      fetchApiResource("tpvagentes"),
      fetchApiResource("agentes"),
    ]);

    // ---- Terminales ----
    if (Array.isArray(tpvTerminales) && tpvTerminales.length) {
      terminals = tpvTerminales.map((t, idx) => {
        const id = String(t.idtpv ?? t.id ?? idx);
        return {
          id,
          name: t.name || t.descripcion || `TPV ${id}`,
          codalmacen: t.codalmacen || null,
          productlimit: t.productlimit || null,
        };
      });
    } else {
      terminals = [];
    }

    // ---- Mapa codagente -> nombre (desde /agentes) ----
    const agentNameByCode = {};
    if (Array.isArray(agentesMaestros)) {
      agentesMaestros.forEach((a) => {
        const code = String(a.codagente ?? "");
        if (!code) return;
        agentNameByCode[code] = a.nombre || a.name || `Agente ${code}`;
      });
    }

    // ---- TPV-agente -> agentsByTerminal + lista agents ----
    agentsByTerminal = {};
    const allAgentsMap = {};

    if (Array.isArray(tpvAgentesData)) {
      tpvAgentesData.forEach((rel) => {
        const tpvIdRaw = rel.idtpv ?? rel.codtpv ?? rel.idtpvterminal ?? rel.id;
        const codag = rel.codagente ?? rel.idagente ?? rel.idagente2;
        if (!tpvIdRaw || !codag) return;

        const tpvKey = String(tpvIdRaw);
        const code = String(codag);
        const name =
          agentNameByCode[code] || rel.nombre || rel.name || `Agente ${code}`;

        const agentObj = {
          id: code,
          codagente: code,
          name,
        };

        if (!agentsByTerminal[tpvKey]) agentsByTerminal[tpvKey] = [];
        if (
          !agentsByTerminal[tpvKey].some(
            (a) => a.codagente === agentObj.codagente
          )
        ) {
          agentsByTerminal[tpvKey].push(agentObj);
        }

        allAgentsMap[code] = agentObj;
      });
    }

    agents = Object.values(allAgentsMap);

    // Reajustar currentTerminal / currentAgent si ya había algo seleccionado
    if (currentTerminal) {
      const updated = terminals.find(
        (t) => String(t.id) === String(currentTerminal.id)
      );
      if (!updated) {
        currentTerminal = null;
        currentAgent = null;
      } else {
        currentTerminal = updated;
        const list = getAgentsForTerminalId(currentTerminal.id);
        if (
          !currentAgent ||
          !list.some(
            (a) => a.codagente === (currentAgent && currentAgent.codagente)
          )
        ) {
          currentAgent = null;
        }
      }
    }

    // Si la caja está abierta, refrescamos barra principal
    if (cashSession.open) {
      renderMainAgentBar();
      if (agentNameEl)
        agentNameEl.textContent = currentAgent ? currentAgent.name : "---";
      if (terminalNameEl)
        terminalNameEl.textContent = currentTerminal
          ? currentTerminal.name
          : "---";
    }
  } catch (e) {
    console.warn("No se pudieron refrescar TPVs/agentes:", e);
  }
}

// ===== Cobro / creación de ticket en FacturaScripts =====
function buildTicketPayloadFromCart() {
  if (!cart || cart.length === 0) {
    throw new Error("El carrito está vacío.");
  }

  const cfg = window.RECIPOK_API || {};

  // Cliente por defecto del TPV
  const codcliente = cfg.defaultCodClienteTPV || "1";

  const lineas = cart.map((item) => {
    const descripcion = item.secondaryName
      ? `${item.name} - ${item.secondaryName}`
      : item.name;

    const qty = item.qty || 1;

    const unitGross = getUnitGross(item); // ✅ precio efectivo (override o normal)
    const unitNet = grossToNet(unitGross, item.taxRate); // ✅ neto a enviar a FS

    const linea = {
      descripcion,
      cantidad: qty,
      pvpunitario: unitNet, // ✅ ahora sí respeta el override
    };

    if (item.codimpuesto) linea.codimpuesto = item.codimpuesto;
    return linea;
  });

  // Payload mínimo que sabemos que funciona:
  // - codcliente
  // - lineas
  // - pagada = 1 (marcamos el ticket como cobrado)
  const payload = {
    codcliente,
    lineas,
    pagada: 1,
  };

  // ⚠ De momento NO mandamos fecha, hora, serie, forma de pago ni agente.
  // Cuando todo vaya fino, los añadimos uno a uno.

  return payload;
}

function buildPresupuestoPayloadFromCart(obs = "") {
  if (!cart || cart.length === 0) {
    throw new Error("El carrito está vacío.");
  }

  const cfg = window.RECIPOK_API || {};

  const codcliente = cfg.defaultCodClienteTPV || "1";
  const codalmacen = currentTerminal?.codalmacen || getLoginWarehouse() || "";
  const codpago = "CONT"; // ajusta si usas otro
  const codserie = "S"; // serie de presupuestos (ajústala si es otra)

  // FacturaScripts normalmente acepta YYYY-MM-DD
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const fecha = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate()
  )}`;

  const lineas = cart.map((item) => {
    const descripcion = item.secondaryName
      ? `${item.name} - ${item.secondaryName}`
      : item.name;

    const qty = item.qty || 1;
    const unitGross = getUnitGross(item);
    const unitNet = grossToNet(unitGross, item.taxRate);

    const linea = {
      descripcion,
      cantidad: qty,
      pvpunitario: unitNet,
    };

    if (item.codimpuesto) linea.codimpuesto = item.codimpuesto;

    return linea;
  });

  return {
    codcliente,
    codalmacen,
    codpago,
    codserie,
    fecha,
    observaciones: String(obs || "").trim(),
    aparcado: true,
    idtpv: currentTerminal ? currentTerminal.id : null,
    idcaja: cashSession?.remoteCajaId ?? null,
    lineas,
  };
}

async function updateFacturaCliente(idfactura, fields) {
  const cfg = window.RECIPOK_API || {};
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const url = `${base}/facturaclientes/${idfactura}`;

  const body = new URLSearchParams();
  Object.entries(fields).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    body.append(k, String(v));
  });

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      Token: cfg.apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || (data && data.status === "error")) {
    throw new Error(data?.message || `Error actualizando factura ${idfactura}`);
  }
  return data;
}

// ===== Opciones (⚙️) =====
const OPTIONS_AUTOPRINT_KEY = "tpv_autoPrint";

const optionsBtn = document.getElementById("optionsBtn");
const optionsOverlay = document.getElementById("optionsOverlay");
const optionsCloseX = document.getElementById("optionsCloseX");
const optionsCloseBtn = document.getElementById("optionsCloseBtn");
const optionsOpenDrawerBtn = document.getElementById("optionsOpenDrawerBtn");
const payOpenDrawerBtn = document.getElementById("payOpenDrawerBtn");

const optionsChangePrinterBtn = document.getElementById(
  "optionsChangePrinterBtn"
);
const currentPrinterNameEl = document.getElementById("currentPrinterName");
const autoPrintToggle = document.getElementById("autoPrintToggle");

function isAutoPrintEnabled() {
  return localStorage.getItem(OPTIONS_AUTOPRINT_KEY) === "1";
}
function setAutoPrintEnabled(v) {
  localStorage.setItem(OPTIONS_AUTOPRINT_KEY, v ? "1" : "0");
}

function refreshOptionsUI() {
  if (autoPrintToggle) autoPrintToggle.checked = isAutoPrintEnabled();

  // Estas funciones ya deberían existir por tu printerOverlay:
  // - getSavedPrinterName()
  if (currentPrinterNameEl) {
    const p =
      typeof getSavedPrinterName === "function" ? getSavedPrinterName() : "";
    currentPrinterNameEl.textContent = p ? p : "—";
  }
}

function openOptions() {
  refreshOptionsUI();
  optionsOverlay?.classList.remove("hidden");
}

function closeOptions() {
  optionsOverlay?.classList.add("hidden");
}

optionsBtn?.addEventListener("click", openOptions);
optionsCloseX?.addEventListener("click", closeOptions);
optionsCloseBtn?.addEventListener("click", closeOptions);

// cerrar al click fuera del diálogo
optionsOverlay?.addEventListener("click", (e) => {
  if (e.target === optionsOverlay) closeOptions();
});

// Toggle auto-print
autoPrintToggle?.addEventListener("change", () => {
  setAutoPrintEnabled(!!autoPrintToggle.checked);
  if (typeof toast === "function") {
    toast(
      autoPrintToggle.checked
        ? "Auto-impresión activada ✅"
        : "Auto-impresión desactivada",
      "info",
      "Opciones"
    );
  }
});

// Cambiar impresora desde Opciones
optionsChangePrinterBtn?.addEventListener("click", async () => {
  try {
    // 1) Cierra opciones para que no tape nada
    closeOptions();

    // 2) Abre selector de impresora (PROMESA)
    const chosen = await openPrinterPicker();

    // 3) Si eligió, guarda y refresca UI
    if (chosen) {
      savePrinterName(chosen);
    }
    refreshOptionsUI();

    // 4) Vuelve a abrir opciones (si quieres que el usuario siga ahí)
    openOptions();
  } catch (e) {
    console.warn(e);
    toast?.("No se pudo cambiar impresora", "err", "Impresión");
    // por si falla, reabre opciones igualmente
    openOptions();
  }
});

async function handleOpenDrawerClick(btn) {
  try {
    const printerName =
      typeof getSavedPrinterName === "function" ? getSavedPrinterName() : "";

    if (!printerName) {
      toast?.("Primero selecciona una impresora.", "warn", "Cajón");
      closeOptions?.();
      const chosen = await openPrinterPicker();
      if (chosen) {
        savePrinterName(chosen);
        refreshOptionsUI?.();
      }
      openOptions?.();
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.dataset._oldText = btn.textContent;
      btn.textContent = "Abriendo...";
    }

    const r = await window.TPV_PRINT.openCashDrawer(printerName);

    if (!r || !r.ok) {
      toast?.(
        "No se pudo abrir el cajón: " + (r?.error || "error desconocido"),
        "err",
        "Cajón"
      );
    } else {
      toast?.("Cajón abierto ✅", "ok", "Cajón");
    }
  } catch (e) {
    console.warn(e);
    toast?.("Error al abrir el cajón", "err", "Cajón");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.dataset._oldText || "🧾 Abrir cajón";
      delete btn.dataset._oldText;
    }
  }
}

// Opciones
optionsOpenDrawerBtn?.addEventListener("click", () =>
  handleOpenDrawerClick(optionsOpenDrawerBtn)
);

// Cobrar
payOpenDrawerBtn?.addEventListener("click", () =>
  handleOpenDrawerClick(payOpenDrawerBtn)
);

async function createRefundInFacturaScripts(
  facturaRow,
  qtyByLineId,
  lineasFactura
) {
  const codcliente =
    facturaRow?._raw?.codcliente ||
    window.RECIPOK_API?.defaultCodClienteTPV ||
    "1";

  const lineas = [];
  for (const l of lineasFactura || []) {
    const id = Number(l.idlinea);
    const q = Number(qtyByLineId?.[id] || 0);
    if (!(q > 0)) continue;

    lineas.push({
      descripcion: `DEV - ${l.descripcion || "Producto"}`,
      cantidad: -q,
      pvpunitario: Number(l.pvpunitario || 0),
      codimpuesto: l.codimpuesto || undefined,
    });
  }
  if (!lineas.length)
    throw new Error("Selecciona al menos 1 línea para devolver.");

  const payload = {
    codcliente,
    lineas,
    pagada: 1,
    codpago: facturaRow.codpago || null,
    serie: "R",
  };

  let resp = null;

  try {
    resp = await createTicketInFacturaScripts(payload); // ✅ AQUÍ
  } catch (e) {
    const msg = e?.message || String(e);

    const isNetwork =
      msg.includes("Failed to fetch") ||
      msg.includes("Network") ||
      msg.includes("timeout");

    if (isNetwork) {
      await window.TPV_QUEUE.enqueue({
        type: "CREATE_FACTURACLIENTE",
        payload,
        createdAt: Date.now(),
      });

      setStatusText("Offline · Venta guardada");
      toast(
        "Sin conexión. Venta guardada y se enviará al volver internet.",
        "warn",
        "Offline"
      );
      return { queued: true, payload }; // ✅ salimos sin tocar updateFacturaCliente
    }

    throw e;
  }

  // ✅ Ya existe resp aquí
  const doc = resp.doc || resp.factura || resp.data || resp;
  const newId = doc?.idfactura || doc?.id || null;

  const originalId = facturaRow.idfactura;
  const originalCodigo = facturaRow.codigo || facturaRow._raw?.codigo || "";

  if (newId && originalId) {
    await updateFacturaCliente(newId, {
      codserie: "R",
      idfacturarect: originalId,
      codigorect: originalCodigo,
      idestado: 11,
      pagada: 1,
      codpago: facturaRow.codpago || "",
      idtpv: currentTerminal?.id || "",
      codalmacen: currentTerminal?.codalmacen || "",
      codagente: currentAgent?.codagente || "",
    });
  }

  return resp;
}

async function createTicketInFacturaScripts(ticketPayload) {
  const cfg = window.RECIPOK_API || {};
  if (!cfg.baseUrl || !cfg.apiKey) {
    throw new Error(
      "Config API de FacturaScripts no definida (baseUrl/apiKey)."
    );
  }

  const base = cfg.baseUrl.replace(/\/+$/, "");
  const url = `${base}/crearFacturaCliente`;

  const bodyParams = new URLSearchParams();
  bodyParams.append("codcliente", ticketPayload.codcliente);
  bodyParams.append("lineas", JSON.stringify(ticketPayload.lineas));

  // Intento de registrar forma de pago principal en FacturaScripts (si el endpoint lo soporta)
  if (ticketPayload.codpago) {
    bodyParams.append("codpago", String(ticketPayload.codpago));
  }

  // Desglose de pagos (por si el endpoint lo acepta)
  if (Array.isArray(ticketPayload.pagos) && ticketPayload.pagos.length) {
    bodyParams.append("pagos", JSON.stringify(ticketPayload.pagos));
  }

  // Solo enviamos 'pagada' como extra
  if (ticketPayload.pagada !== undefined) {
    bodyParams.append("pagada", String(ticketPayload.pagada));
  }

  // Numero2 (FacturaScripts lo llama "numero2" en la UI)
  if (ticketPayload.numero2) {
    bodyParams.append("numero2", String(ticketPayload.numero2));
  }

  // Serie: normalmente suele ser "codserie" en FS
  if (ticketPayload.serie) {
    bodyParams.append("codserie", String(ticketPayload.serie));
  }

  console.log(">>> Enviando a crearFacturaCliente:", bodyParams.toString());

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Token: cfg.apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: bodyParams.toString(),
  });

  // Manejo especial de 429 (por si volvemos a disparar el límite)
  if (res.status === 429) {
    const text = await res.text().catch(() => "");
    console.error("Error 429 crearFacturaCliente:", text);
    throw new Error(
      "La API ha devuelto 429 (demasiadas peticiones). " +
        "Es un bloqueo temporal por seguridad; espera unos minutos antes de seguir usando el TPV."
    );
  }

  if (!res.ok) {
    let msg = `Error HTTP ${res.status}`;
    try {
      const errData = await res.json();
      console.error("Respuesta de error crearFacturaCliente:", errData);
      if (errData.message) msg += `: ${errData.message}`;
      if (errData.errors)
        msg += " | Detalles: " + JSON.stringify(errData.errors);
    } catch (e) {
      const text = await res.text().catch(() => "");
      if (text) msg += `: ${text}`;
    }
    throw new Error(msg);
  }

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    console.error("No se pudo parsear JSON de crearFacturaCliente:", e);
    throw new Error(
      "Respuesta no válida de FacturaScripts al crear la factura."
    );
  }

  if (data.error || data.errors) {
    console.error("Errores en crearFacturaCliente:", data);
    throw new Error(data.error || JSON.stringify(data.errors));
  }

  console.log("Respuesta OK crearFacturaCliente:", data);
  return data;
}

function buildTicketPrintData(apiResponse, ticketPayload, cartSnapshot) {
  const factura =
    apiResponse.doc || apiResponse.factura || apiResponse.data || apiResponse;

  const paymentMethod =
    factura.formapago ||
    factura.metodopago ||
    factura.codpago ||
    factura.codpago_desc ||
    ticketPayload.paymentMethod ||
    "Efectivo";

  const codigo = factura.codigo || factura.codigoFactura || null;

  // fallback por si alguna instalación no devuelve codigo en esa respuesta
  const numeroFallback =
    factura.numfactura ||
    factura.numero ||
    factura.idfactura ||
    factura.id ||
    null;

  const numero = codigo || numeroFallback;

  const totalFromFactura =
    typeof factura.total !== "undefined" ? Number(factura.total) : null;

  const totalFromCart = cartSnapshot.reduce((sum, item) => {
    const unitPrice = getUnitGross(item);
    return sum + unitPrice * (item.qty || 1);
  }, 0);

  // ✅ FIX: sacar el nombre del cliente del input
  const clientName =
    (cartClientInput && (cartClientInput.value || "").trim()) || "Cliente";

  return {
    numero,
    paymentMethod,
    fecha: factura.fecha || ticketPayload.fecha,
    hora: factura.hora || ticketPayload.hora,
    total: totalFromFactura !== null ? totalFromFactura : totalFromCart,

    // ✅ mejor guardar el estado real en el ticket (por si luego cierras caja)
    terminalName: currentTerminal ? currentTerminal.name || "" : "",
    agentName: currentAgent ? currentAgent.name || "" : "",

    clientName,
    company: companyInfo ? { ...companyInfo } : null,
    lineas: cartSnapshot,
  };
}

const PRINTER_STORAGE_KEY = "tpv_printerName";

function getSavedPrinterName() {
  return localStorage.getItem(PRINTER_STORAGE_KEY) || "";
}

function savePrinterName(name) {
  localStorage.setItem(PRINTER_STORAGE_KEY, name || "");
}

async function openPrinterPicker() {
  const overlay = document.getElementById("printerOverlay");
  const select = document.getElementById("printerSelect");
  const okBtn = document.getElementById("printerOkBtn");
  const cancelBtn = document.getElementById("printerCancelBtn");
  const errEl = document.getElementById("printerError");

  if (!overlay || !select || !okBtn || !cancelBtn) {
    throw new Error("Falta el modal de impresoras en index.html");
  }

  if (!window.TPV_PRINT) {
    throw new Error("TPV_PRINT no está disponible (preload.js/IPC).");
  }

  // Cargamos impresoras del sistema
  const printers = await window.TPV_PRINT.listPrinters();
  if (!printers || printers.length === 0) {
    throw new Error("No se encontraron impresoras instaladas en este equipo.");
  }

  select.innerHTML = "";
  printers.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = p.isDefault
      ? `${p.displayName} (predeterminada)`
      : p.displayName;
    select.appendChild(opt);
  });

  // Preseleccionar la guardada o la predeterminada
  const saved = getSavedPrinterName();
  if (saved && printers.some((p) => p.name === saved)) {
    select.value = saved;
  } else {
    const def = printers.find((p) => p.isDefault);
    if (def) select.value = def.name;
  }

  if (errEl) errEl.textContent = "";
  overlay.classList.remove("hidden");

  return await new Promise((resolve) => {
    const cleanup = () => {
      okBtn.onclick = null;
      cancelBtn.onclick = null;
    };

    cancelBtn.onclick = () => {
      cleanup();
      overlay.classList.add("hidden");
      resolve(""); // cancelado
    };

    okBtn.onclick = () => {
      const chosen = select.value || "";
      if (!chosen) {
        if (errEl) errEl.textContent = "Selecciona una impresora.";
        return;
      }
      cleanup();
      overlay.classList.add("hidden");
      resolve(chosen);
    };
  });
}

async function ensurePrinterSelected() {
  let name = getSavedPrinterName();
  if (name) return name;

  const chosen = await openPrinterPicker();
  if (!chosen) return ""; // usuario canceló
  savePrinterName(chosen);
  return chosen;
}

async function printTicket(ticket) {
  if (!ticket) {
    toast("No hay ticket para imprimir.", "warn", "Impresión");
    return;
  }

  const printerName = await ensurePrinterSelected();
  if (!printerName) {
    toast("Impresión cancelada (sin impresora).", "warn", "Impresión");
    return;
  }

  // 1) Cargar plantilla
  let templateHtml = "";
  try {
    const res = await fetch("ticket_print.html", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    templateHtml = await res.text();
  } catch (e) {
    toast(
      "No puedo cargar ticket_print.html: " + (e.message || e),
      "err",
      "Impresión"
    );
    return;
  }

  const doc = new DOMParser().parseFromString(templateHtml, "text/html");

  // Método pago (si hay desglose, lo mostramos)
  if (Array.isArray(ticket.pagos) && ticket.pagos.length) {
    const txt = ticket.pagos
      .map((p) => `${p.descripcion || p.codpago}: ${euro2es(p.importe)}`)
      .join(" + ");
    setText(doc, "paymentMethod", txt);
  } else {
    setText(doc, "paymentMethod", ticket.paymentMethod || "Efectivo");
  }

  // Helpers
  const eur = (n) => (Number(n) || 0).toFixed(2).replace(".", ",");
  const now = new Date();
  const fecha = ticket.fecha || now.toLocaleDateString("es-ES");
  const hora =
    ticket.hora ||
    now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

  // ✅ FACTURA / FECHA / CLIENTE (esto faltaba)
  setText(doc, "invoiceNumber", ticket.numero != null ? ticket.numero : "—");

  // En el HTML "ticketDate" es fecha + hora en una misma línea
  const fechaHoraTexto = `${fecha} ${hora}`;
  setText(doc, "ticketDate", fechaHoraTexto);

  // Nombre de cliente (del input del carrito)
  setText(doc, "clientName", (ticket.clientName || "").trim() || "Cliente");

  // 2) Datos “empresa” (si no tienes API aún, usa placeholders)
  // TODO: cuando tengas endpoint real, rellena ticket.company.*
  const emp = ticket.company || companyInfo || null;

  const logoEl = doc.getElementById("companyLogo");
  const logoUrl = companyLogoUrl || "";

  if (logoEl && logoUrl) {
    logoEl.setAttribute("src", logoUrl);
    logoEl.style.display = "inline-block";
  }

  setText(doc, "companyShortName", emp?.nombrecorto || "—");
  setText(doc, "companyLegalName", emp?.nombre || "");

  setText(doc, "companyAddress", emp?.direccion || "");
  setText(doc, "companyZip", emp?.codpostal ? emp.codpostal + ", " : "");
  setText(doc, "companyCity", emp?.ciudad || "");
  setText(doc, "companyCif", emp?.cifnif || "—");
  setText(doc, "companyPhone", emp?.telefono1 || "");

  // 4) TPV / agente (usa estado actual si existe)
  const terminalTexto =
    (currentTerminal?.name || ticket.terminalName || "").trim() || "—";
  const agenteTexto =
    (currentAgent?.name || ticket.agentName || "").trim() || "—";
  setText(doc, "terminalName", terminalTexto);
  setText(doc, "agentName", agenteTexto);

  // 5) Pintar líneas + calcular total + desglose IVA
  const itemsEl = doc.getElementById("items");
  if (itemsEl) itemsEl.innerHTML = "";

  const lineas = Array.isArray(ticket.lineas) ? ticket.lineas : [];
  let total = 0;

  // taxMap: { rate: { base, iva } }
  const taxMap = {};

  for (const l of lineas) {
    const name = (l.name || l.descripcion || "Producto").toString().trim();
    const qty = Number(l.qty ?? l.cantidad ?? 1) || 1;

    // unitGross (con IVA)
    let unitGross = 0;
    if (typeof l.grossPrice === "number" && !isNaN(l.grossPrice)) {
      unitGross = Number(l.grossPrice);
    } else if (typeof l.price === "number" && !isNaN(l.price)) {
      const tax = Number(l.taxRate ?? 0) || 0;
      unitGross = Number(l.price) * (1 + tax / 100);
    } else if (typeof l.pvpunitario !== "undefined") {
      // fallback: si te llega pvpunitario neto, lo convertimos con taxRate/codimpuesto
      const tax =
        Number(l.taxRate ?? extractTaxRateFromCode(l.codimpuesto) ?? 0) || 0;
      unitGross = (Number(l.pvpunitario) || 0) * (1 + tax / 100);
    }

    const rate =
      Number(l.taxRate ?? extractTaxRateFromCode(l.codimpuesto) ?? 0) || 0;

    const lineGross = unitGross * qty;
    total += lineGross;

    // base/iva por tipo
    const divisor = 1 + rate / 100;
    const lineBase = divisor > 0 ? lineGross / divisor : lineGross;
    const lineIva = lineGross - lineBase;

    if (!taxMap[rate]) taxMap[rate] = { base: 0, iva: 0 };
    taxMap[rate].base += lineBase;
    taxMap[rate].iva += lineIva;

    // Render item
    if (itemsEl) {
      const div = doc.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div class="item-top">
          <div class="qty">${qty}</div>
          <div class="desc">${escapeHtml(name)}</div>
          <div class="ltotal">${eur(lineGross)}</div>
        </div>
      `;
      itemsEl.appendChild(div);
    }
  }

  // 6) Desglose IVA como la imagen (Base Imponible X% / IVA X%)
  const taxSummaryEl = doc.getElementById("taxSummary");
  if (taxSummaryEl) taxSummaryEl.innerHTML = "";

  const ratesSorted = Object.keys(taxMap)
    .map((r) => Number(r))
    .filter((r) => !isNaN(r) && r > 0)
    .sort((a, b) => a - b);

  for (const r of ratesSorted) {
    const base = taxMap[r].base;
    const iva = taxMap[r].iva;

    appendRow(taxSummaryEl, `Base Imponible ${r}%`, eur(base));
    appendRow(taxSummaryEl, `IVA ${r}%`, eur(iva));
  }

  // 7) Totales
  setText(doc, "grandTotal", eur(total));
  setText(doc, "paidAmount", eur(total));

  const finalHtml = "<!doctype html>\n" + doc.documentElement.outerHTML;

  const isCash = Array.isArray(ticket.pagos)
    ? ticket.pagos.some(
        (p) =>
          (p.codpago || "").toLowerCase() === "cash" ||
          (p.descripcion || "").toLowerCase().includes("efect")
      )
    : true;

  const res = await window.TPV_PRINT.printTicket({
    html: finalHtml,
    deviceName: printerName,
  });
  if (!res || !res.ok) {
    toast(
      "No se pudo imprimir: " + (res?.error || "error desconocido"),
      "err",
      "Impresión"
    );
    return;
  }
  toast("Ticket impreso ✅", "ok", "Impresión");
  // 💰 Abrir cajón SOLO si es efectivo
  if (isCash) {
    const drawer = await window.TPV_PRINT.openCashDrawer(printerName);
    if (!drawer || !drawer.ok) {
      toast(
        "Ticket impreso, pero no se pudo abrir el cajón: " +
          (drawer?.error || "error desconocido"),
        "warn",
        "Cajón"
      );
    }
  }
}

function setText(doc, id, value) {
  const el = doc.getElementById(id);
  if (el) el.textContent = value == null ? "" : String(value);
}

function appendRow(container, left, right) {
  if (!container) return;
  const div = container.ownerDocument.createElement("div");
  div.className = "row small";
  div.innerHTML = `<div class="col-left">${escapeHtml(
    left
  )}</div><div class="col-right">${escapeHtml(right)}</div>`;
  container.appendChild(div);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

let isPayingNow = false;

async function onPayButtonClick() {
  try {
    if (isPayingNow) return;
    isPayingNow = true;

    if (!cashSession || !cashSession.open) {
      toast("Abre la caja para poder cobrar.", "warn", "Cobrar");
      return;
    }

    if (!cart || cart.length === 0) {
      toast("Añade productos antes de cobrar.", "warn", "Cobrar");
      return;
    }

    if (!currentTerminal) {
      toast("Debes seleccionar un terminal antes de cobrar.", "warn", "Cobrar");
      return;
    }

    // total carrito (ya con IVA)

    const totalCart = getCartTotal(cart);

    // 1) Abrimos modal de cobro (formas de pago reales)
    const payResult = await openPayModal(totalCart);
    if (!payResult) {
      setStatusText("Cobro cancelado");
      return;
    }

    // 2) Construimos payload factura
    const ticketPayload = buildTicketPayloadFromCart();

    // Número 2 y Serie desde el modal
    ticketPayload.numero2 = payResult.numero || "";
    ticketPayload.serie = payResult.serie || "";

    // 🔥 IMPORTANTE: escoger método principal
    // - si hay 1 pago, ese
    // - si hay varios, marcamos como "Mixto" para el ticket, pero para FS enviamos el primero
    const pagos = payResult.pagos || [];
    const primary = pagos[0];

    // para ticket (impresión)
    if (pagos.length === 1) {
      ticketPayload.paymentMethod = primary.descripcion || primary.codpago;
    } else {
      ticketPayload.paymentMethod = "Mixto";
    }

    setStatusText("Cobrando...");

    // 3) Crear factura en FacturaScripts
    // ✅ Aquí intentamos registrar el método en FacturaScripts:
    // - enviamos codpago (si el endpoint lo soporta, quedará guardado)
    // - y enviamos "pagos" con el desglose (por si tu endpoint lo acepta)
    // Si FacturaScripts ignorase estos campos, no romperá el cobro.
    ticketPayload.codpago = primary ? primary.codpago : null;
    ticketPayload.pagos = pagos; // opcional

    const isMixto = pagos.length > 1;

    // Para FS:
    if (isMixto) {
      ticketPayload.codpago = primary ? primary.codpago : null;
      ticketPayload.pagos = pagos; // si el endpoint lo admite, perfecto
    }

    // ✅ Snapshot INMUTABLE y SIEMPRE array
    const cartSnapshot = Array.isArray(cart) ? cart.map((i) => ({ ...i })) : [];

    const sendResult = await sendOrQueueFactura(ticketPayload);

    // ✅ OFFLINE (encolado): no seguimos el flujo online
    if (!sendResult.ok && sendResult.queued) {
      // 🔢 Registrar uso de métodos de pago en la sesión de caja
      registerPaymentsForCurrentSession(pagos);
      try {
        // Ticket imprimible mínimo offline (SIN romper nunca)
        lastTicket = buildOfflineTicketPrintData(
          cartSnapshot,
          ticketPayload,
          payResult
        );

        // ✅ si quieres que aparezca en el modal Tickets mientras está offline:
        saveOfflineTicketForTicketsModal({
          _localId: sendResult.localId,

          // Un “número” visible tipo OFF-ABC123
          codigo: `OFF-${String(sendResult.localId || "")
            .slice(0, 6)
            .toUpperCase()}`,

          nombrecliente: "Venta en cola",

          // ✅ TOTAL REAL (no ticketPayload.total)
          total: Number(
            payResult?.total ?? totalCart ?? ticketPayload?.total ?? 0
          ),

          codpago:
            payResult?.pagos?.[0]?.codpago || ticketPayload.codpago || "—",
          fecha: lastTicket.fecha,
          hora: lastTicket.hora,

          // ✅ Guardamos todo para que se vea/imprima bien offline
          lineas: Array.isArray(lastTicket.lineas) ? lastTicket.lineas : [],
          pagos: Array.isArray(lastTicket.pagos)
            ? lastTicket.pagos
            : payResult.pagos || [],
          cambio: Number(lastTicket.cambio || payResult.cambio || 0),

          // marca para que el render/print lo trate como offline
          _offline: true,
        });

        const printBtn = document.getElementById("printTicketBtn");
        if (printBtn) printBtn.disabled = false;
      } catch (e) {
        console.warn("No se pudo construir ticket offline:", e?.message || e);
        // NO tiramos error: la venta ya está en cola
      }

      // ✅ Vaciar carrito SIEMPRE aunque falle impresión/ticket offline
      cart = [];
      renderCart();

      setStatusText("Venta guardada en cola (offline)");
      toast("Sin internet: venta guardada en cola ✅", "ok", "Cobrar");
      return;
    }

    // ✅ ONLINE: seguimos normal
    const apiResponse = sendResult.remote;

    // completar código si se puede
    const facturaResp =
      apiResponse.doc || apiResponse.factura || apiResponse.data || apiResponse;
    const idfactura = facturaResp?.idfactura || null;
    const codcliente = facturaResp?.codcliente;
    const idempresa = facturaResp?.idempresa;
    const coddivisa = facturaResp?.coddivisa;
    const fecha = facturaResp?.fecha;
    const codigofactura = facturaResp?.codigo;

    if (idfactura) {
      await updateFacturaCliente(idfactura, {
        idestado: 11,
        pagada: 1,
        codpago: ticketPayload.codpago || "",
        idtpv: currentTerminal?.id || "",
        codalmacen: currentTerminal?.codalmacen || "",
        codagente: currentAgent?.codagente || "",
      });
    }

    // ✅ Crear 1 recibo por cada método de pago usado (pago mixto)
    if (idfactura && codcliente) {
      const today = new Date().toISOString().slice(0, 10);
      const pagos = payResult.pagos || [];

      for (const p of pagos) {
        const importe = Number(Number(p.importe || 0).toFixed(2));
        if (!(importe > 0)) continue;

        await createReciboCliente({
          idfactura,
          codcliente,
          codpago: p.codpago,
          importe,
          fechaPago: today,
          idempresa,
          codigofactura,
          coddivisa,
          fecha: today,
        });
      }
    } else {
      console.warn(
        "No hay idfactura/codcliente: no se pudieron crear recibos."
      );
    }
    // ✅ Limpieza: elimina el recibo "total" automático y deja SOLO los recibos por método
    try {
      await cleanupRecibosFactura(idfactura, payResult.pagos || []);
    } catch (e) {
      console.warn("cleanupRecibosFactura falló:", e?.message || e);
    }
    // 🔢 Registrar uso de métodos de pago en la sesión de caja
    registerPaymentsForCurrentSession(pagos);
    if (idfactura) {
      try {
        const fc = await fetchFacturaClienteById(idfactura);
        if (fc && fc.codigo) {
          if (!apiResponse.factura) apiResponse.factura = facturaResp;
          apiResponse.factura.codigo = String(fc.codigo);
        }
      } catch (e) {
        console.warn(
          "No se pudo completar codigo desde facturaclientes:",
          e?.message || e
        );
      }
    }

    // 4) Guardamos ticket para imprimir
    lastTicket = buildTicketPrintData(apiResponse, ticketPayload, cartSnapshot);

    // ✅ Guardamos desglose de pagos para imprimirlo
    lastTicket.pagos = pagos;
    lastTicket.cambio = payResult.cambio || 0;

    const printBtn = document.getElementById("printTicketBtn");
    if (printBtn) printBtn.disabled = false;

    // 5) Caja: SOLO efectivo suma a cashSalesTotal
    // (si hay varios métodos, solo suma la parte del método "Al contado" / "CONT" (si existe))
    const totalVenta = lastTicket.total || totalCart || 0;

    let efectivo = 0;
    pagos.forEach((p) => {
      const code = String(p.codpago || "").toUpperCase();
      const desc = String(p.descripcion || "").toLowerCase();
      // criterio: CONT o “al contado” lo consideramos efectivo
      if (
        code === "CONT" ||
        desc.includes("contado") ||
        desc.includes("efectivo")
      ) {
        efectivo += Number(p.importe || 0);
      }
    });

    const hasCash = efectivo > 0;
    if (hasCash) {
      await openDrawerNow();
    }

    cashSession.cashSalesTotal = (cashSession.cashSalesTotal || 0) + efectivo;
    cashSession.totalSales = (cashSession.totalSales || 0) + totalVenta;

    // 6) Vaciar carrito
    cart = [];
    renderCart();
    clearPaidParkedTicket();
    setStatusText("Venta cobrada");

    toast(
      lastTicket.numero
        ? `Venta cobrada ✅ (${ticketPayload.paymentMethod} - ${lastTicket.numero})`
        : `Venta cobrada ✅ (${ticketPayload.paymentMethod})`,
      "ok",
      "Cobrar"
    );
    // ✅ Auto-impresión (solo si el check está activado)
    if (isAutoPrintEnabled()) {
      try {
        await printTicket(lastTicket);
      } catch (e) {
        console.warn("Auto-impresión falló:", e?.message || e);
        toast(
          "Venta cobrada, pero no se pudo imprimir automáticamente.",
          "warn",
          "Impresión"
        );
      }
    }
  } catch (err) {
    console.error("Error al cobrar:", err);
    toast("Error al cobrar: " + (err.message || err), "err", "Cobrar");
    setStatusText("Error al cobrar");
  } finally {
    isPayingNow = false;
  }
}

// ===== Botón "Eliminar todo" =====
const clearBtn = document.getElementById("clearCartBtn");
if (clearBtn) {
  clearBtn.onclick = () => {
    cart = [];
    renderCart();
  };
}

// ===== Botón "Cobrar" =====
const payBtn = document.getElementById("payBtn");
if (payBtn) {
  payBtn.onclick = () => {
    onPayButtonClick();
  };
}

// Botón imprimir ticket
const printTicketBtn = document.getElementById("printTicketBtn");
if (printTicketBtn) {
  printTicketBtn.onclick = () => {
    if (!lastTicket) {
      toast("No hay ningún ticket para imprimir.", "warn", "Impresión");
      return;
    }

    printTicket(lastTicket);
  };
}

// ===== Modal Cobrar (UI tipo FacturaScripts) =====
const payOverlay = document.getElementById("payOverlay");
const payMethodsList = document.getElementById("payMethodsList");
const payTotalBig = document.getElementById("payTotalBig");
const payChangeBig = document.getElementById("payChangeBig");
const payErrorEl = document.getElementById("payError");
const payCancelBtn = document.getElementById("payCancelBtn");
const paySaveBtn = document.getElementById("paySaveBtn");
const payCloseX = document.getElementById("payCloseX");
const payObs = document.getElementById("payObs");
const payNumber = document.getElementById("payNumber");
const paySerie = document.getElementById("paySerie");

let payModalState = {
  total: 0,
  formas: [], // [{codpago, descripcion}]
  values: {}, // { codpago: "texto" }
  selectedCodpago: null, // input activo
};

// utilidades € (sin romper tus eur())
function parseEuroStr(s) {
  const v = String(s || "")
    .trim()
    .replace(",", ".");
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}
function euro2(n) {
  return (Number(n) || 0).toFixed(2);
}
function euro2es(n) {
  return euro2(n).replace(".", ",") + " €";
}

function sumPagos() {
  let sum = 0;
  for (const cod of Object.keys(payModalState.values)) {
    sum += parseEuroStr(payModalState.values[cod]);
  }
  return sum;
}

function remainingToPay() {
  return Math.max(0, payModalState.total - sumPagos());
}

function calcChange() {
  return Math.max(0, sumPagos() - payModalState.total);
}

function setPayError(msg) {
  if (!payErrorEl) return;
  payErrorEl.textContent = msg || "";
}

function selectPayInput(codpago) {
  payModalState.selectedCodpago = codpago;

  // marcar visualmente
  const inputs = payMethodsList
    ? payMethodsList.querySelectorAll(".pay-amount")
    : [];
  inputs.forEach((inp) => {
    inp.classList.toggle("active", inp.dataset.codpago === codpago);
  });

  const active = payMethodsList
    ? payMethodsList.querySelector(`.pay-amount[data-codpago="${codpago}"]`)
    : null;
  if (active) active.focus();
}

function renderPayHeaderTotals() {
  if (payTotalBig) payTotalBig.textContent = euro2es(payModalState.total);

  // Diferencia: pagado - total (positivo = cambio, negativo = falta)
  const diff = sumPagos() - payModalState.total;

  const signed = (n) => {
    const sign = n < 0 ? "-" : "";
    return sign + euro2(Math.abs(n)).replace(".", ",") + " €";
  };

  if (payChangeBig) payChangeBig.textContent = signed(diff);
}

function renderPayMethods() {
  if (!payMethodsList) return;

  payMethodsList.innerHTML = "";

  payModalState.formas.forEach((fp) => {
    const row = document.createElement("div");
    row.className = "pay-method-row";

    const pill = document.createElement("div");
    pill.className = "pay-pill";
    pill.textContent = fp.descripcion || fp.codpago;

    const inp = document.createElement("input");
    inp.className = "pay-amount";
    inp.inputMode = "decimal";
    inp.placeholder = "";
    inp.dataset.codpago = fp.codpago;

    inp.value = payModalState.values[fp.codpago] || "";

    inp.addEventListener("focus", () => selectPayInput(fp.codpago));
    inp.addEventListener("click", () => selectPayInput(fp.codpago));

    inp.addEventListener("input", () => {
      // sanea: solo números y un separador decimal
      const raw = inp.value;
      const cleaned = raw
        .replace(/[^0-9.,]/g, "")
        .replace(/(.*)[.,](.*)[.,].*/g, "$1.$2"); // evita 2 decimales
      inp.value = cleaned;
      payModalState.values[fp.codpago] = cleaned;
      renderPayHeaderTotals();
      setPayError("");
    });

    const maxBtn = document.createElement("button");
    maxBtn.className = "pay-max";
    maxBtn.type = "button";
    maxBtn.textContent = "Máx";
    maxBtn.addEventListener("click", () => {
      const cod = fp.codpago;

      // ¿Cuántos métodos tienen importe > 0?
      const nonZeroCods = payModalState.formas
        .map((x) => x.codpago)
        .filter((c) => parseEuroStr(payModalState.values[c] || "") > 0);

      const currentVal = parseEuroStr(payModalState.values[cod] || "");

      let target = 0;

      // Caso A: solo hay 0 o 1 método con valor y es este -> llenar TOTAL
      // (aunque tuviera algo, Máx significa "completar con este método")
      if (
        nonZeroCods.length <= 1 &&
        (nonZeroCods.length === 0 || nonZeroCods[0] === cod)
      ) {
        target = payModalState.total;
      } else {
        // Caso B: pago mixto -> poner SOLO lo que falta para llegar al total
        target = remainingToPay();
        // Si ya tiene algo este método, lo sumamos (porque target es "lo que falta global", no "lo que falta en este input")
        // En mixto, queremos que este método quede exactamente en "lo que falta" (no acumular)
        // Así que NO sumamos currentVal.
      }

      payModalState.values[cod] = euro2(target);
      inp.value = euro2(target);

      selectPayInput(cod);
      renderPayHeaderTotals();
      setPayError("");
    });

    const trashBtn = document.createElement("button");
    trashBtn.className = "pay-trash";
    trashBtn.type = "button";
    trashBtn.textContent = "🗑";
    trashBtn.title = "Borrar este importe";

    trashBtn.addEventListener("click", () => {
      payModalState.values[fp.codpago] = "";
      inp.value = "";
      selectPayInput(fp.codpago);
      renderPayHeaderTotals();
      setPayError("");
    });

    row.appendChild(pill);
    row.appendChild(inp);
    row.appendChild(maxBtn);
    row.appendChild(trashBtn);

    payMethodsList.appendChild(row);
  });

  // Selección inicial: primera forma
  if (!payModalState.selectedCodpago && payModalState.formas[0]) {
    selectPayInput(payModalState.formas[0].codpago);
  } else if (payModalState.selectedCodpago) {
    selectPayInput(payModalState.selectedCodpago);
  }

  renderPayHeaderTotals();
}

// teclado numérico (derecha)
function payKeyAppend(ch) {
  const cod = payModalState.selectedCodpago;
  if (!cod) return;

  let v = String(payModalState.values[cod] || "");

  if (ch === ".") {
    if (v.includes(".") || v.includes(",")) return;
    v = v ? v + "." : "0.";
  } else if (ch === "00") {
    if (!v) v = "0";
    v += "00";
  } else {
    v += String(ch);
  }

  // recorta a 2 decimales si hay punto
  v = v.replace(",", ".");
  if (v.includes(".")) {
    const [a, b] = v.split(".");
    v = a + "." + (b || "").slice(0, 8); // permitir hasta 8 decimales por si acaso
  }

  payModalState.values[cod] = v;
  const inp = payMethodsList
    ? payMethodsList.querySelector(`.pay-amount[data-codpago="${cod}"]`)
    : null;
  if (inp) inp.value = v;

  renderPayHeaderTotals();
  setPayError("");
}

function payKeyBackspace() {
  const cod = payModalState.selectedCodpago;
  if (!cod) return;

  let v = String(payModalState.values[cod] || "");
  v = v.slice(0, -1);
  payModalState.values[cod] = v;

  const inp = payMethodsList
    ? payMethodsList.querySelector(`.pay-amount[data-codpago="${cod}"]`)
    : null;
  if (inp) inp.value = v;

  renderPayHeaderTotals();
  setPayError("");
}

function payKeyClearAll() {
  for (const fp of payModalState.formas) {
    payModalState.values[fp.codpago] = "";
  }
  renderPayMethods();
  setPayError("");
}

async function openPayModal(total) {
  if (!payOverlay) throw new Error("Falta #payOverlay en index.html");

  setPayError("");
  payModalState.total = Number(total) || 0;
  payModalState.values = {};
  payModalState.selectedCodpago = null;

  // cargar formas de pago reales
  const formas = await fetchFormasPagoActivas();
  payModalState.formas = formas
    .map((f) => ({
      codpago: String(f.codpago || "").trim(),
      descripcion: String(f.descripcion || f.codpago || "").trim(),
      imprimir: f.imprimir !== false,
    }))
    .filter((x) => x.codpago);

  if (!payModalState.formas.length) {
    payModalState.formas = [
      { codpago: "CONT", descripcion: "Efectivo", imprimir: true },
    ];
  }

  // pintar lista
  renderPayMethods();

  // limpiar extras
  if (payObs) payObs.value = "";
  if (payNumber) payNumber.value = "";
  if (paySerie) paySerie.value = "";

  payOverlay.classList.remove("hidden");

  // eventos keypad
  const keypad = payOverlay.querySelector(".pay-keypad");
  const onKeypadClick = (e) => {
    const btn = e.target.closest("[data-k]");
    if (!btn) return;
    const k = btn.getAttribute("data-k");
    if (k === "back") payKeyBackspace();
    else if (k === "clear") payKeyClearAll();
    else payKeyAppend(k);
  };
  keypad.addEventListener("click", onKeypadClick);

  // cerrar por X / cancelar
  const closeModal = () => {
    keypad.removeEventListener("click", onKeypadClick);
    payOverlay.classList.add("hidden");
  };

  return await new Promise((resolve) => {
    const cleanupBtns = () => {
      if (payCancelBtn) payCancelBtn.onclick = null;
      if (paySaveBtn) paySaveBtn.onclick = null;
      if (payCloseX) payCloseX.onclick = null;
    };

    const cancel = () => {
      cleanupBtns();
      closeModal();
      resolve(null);
    };

    if (payCloseX) payCloseX.onclick = cancel;
    if (payCancelBtn) payCancelBtn.onclick = cancel;

    if (paySaveBtn) {
      paySaveBtn.onclick = () => {
        setPayError("");

        const pagos = [];
        for (const fp of payModalState.formas) {
          const raw = String(payModalState.values[fp.codpago] || "").trim();
          const val = parseEuroStr(raw);
          if (val > 0) {
            pagos.push({
              codpago: fp.codpago,
              descripcion: fp.descripcion,
              importe: Number(euro2(val)),
            });
          }
        }

        if (!pagos.length) {
          setPayError("Introduce un importe en alguna forma de pago.");
          return;
        }

        const pagado = pagos.reduce((s, p) => s + (p.importe || 0), 0);
        if (pagado + 0.00001 < payModalState.total) {
          setPayError("El importe pagado es inferior al total.");
          return;
        }

        const result = {
          pagos,
          total: payModalState.total,
          pagado,
          cambio: calcChange(),
          observaciones: payObs ? String(payObs.value || "") : "",
          numero: payNumber ? String(payNumber.value || "") : "",
          serie: paySerie ? String(paySerie.value || "") : "",
        };

        cleanupBtns();
        closeModal();
        resolve(result);
      };
    }
  });
}

// Botón aparcar ticket
const parkBtn = document.getElementById("parkBtn");

const parkObsOverlay = document.getElementById("parkObsOverlay");
const parkObsInput = document.getElementById("parkObsInput");
const parkObsCancelBtn = document.getElementById("parkObsCancelBtn");
const parkObsOkBtn = document.getElementById("parkObsOkBtn");
const parkObsKeyboardBtn = document.getElementById("parkObsKeyboardBtn");

function openParkObsModal() {
  const overlay = document.getElementById("parkObsOverlay");
  const input = document.getElementById("parkObsInput");
  if (!overlay || !input) {
    toast("Falta el HTML del modal de aparcar.", "err", "Aparcar");
    return;
  }
  input.value = "";
  overlay.classList.remove("hidden");
  input.focus();
}

function closeParkObsModal() {
  parkObsOverlay.classList.add("hidden");
}

parkBtn?.addEventListener("click", () => {
  // 1) No permitir aparcar si el carrito está vacío
  if (!Array.isArray(cart) || cart.length === 0) {
    toast("No puedes aparcar un ticket vacío.", "warn", "Aparcar");
    return;
  }

  // 2) (Opcional pero recomendado) exigir terminal seleccionada antes de aparcar
  if (!currentTerminal) {
    toast("Debes seleccionar un terminal antes de aparcar.", "warn", "Aparcar");
    return;
  }

  // 3) Si todo OK, recién ahí abrimos el modal de observación
  openParkObsModal();
});

parkObsCancelBtn?.addEventListener("click", () => {
  closeParkObsModal();
});

parkObsOkBtn?.addEventListener("click", () => {
  const obs = parkObsInput.value.trim();
  closeParkObsModal();
  parkCurrentCart(obs || "");
});

parkObsKeyboardBtn?.addEventListener("click", () => {
  // Reutiliza tu teclado QWERTY actual
  // Necesitas una función tipo: openQwerty(targetInput)
  openQwertyForInput(parkObsInput);
});

// Botón ver/recuperar aparcados
const parkedListBtn = document.getElementById("parkedListBtn");
if (parkedListBtn) {
  parkedListBtn.onclick = () => {
    openParkedModal();
  };
}

let ticketsCache = []; // última lista cargada
let ticketsLoading = false; // evita dobles cargas

const ticketsOverlay = document.getElementById("ticketsOverlay");
const ticketsCloseBtn = document.getElementById("ticketsCloseBtn");
const ticketsList = document.getElementById("ticketsList");
const ticketsReloadBtn = document.getElementById("ticketsReloadBtn");
const ticketsSearch = document.getElementById("ticketsSearch");

async function openTicketsModal() {
  if (!ticketsOverlay) {
    toast(
      "Falta el HTML del modal de tickets (#ticketsOverlay).",
      "err",
      "Tickets"
    );
    return;
  }

  ticketsOverlay.classList.remove("hidden");

  await renderQueuedTicketsIfAny(); // ✅ NUEVO
  await loadAndRenderTickets();
}

function closeTicketsModal() {
  if (!ticketsOverlay) return;
  ticketsOverlay.classList.add("hidden");
}

async function loadAndRenderTickets() {
  if (!ticketsList) return;
  if (ticketsLoading) return;
  ticketsLoading = true;

  try {
    ticketsList.innerHTML = "Cargando…";

    // ✅ Online -> trae de API y guarda cache
    if (!TPV_STATE?.offline) {
      ticketsCache = await fetchUltimosTickets(60);
      saveTicketsCache(ticketsCache);

      const merged = getAllTicketsForUI(ticketsCache);
      renderTicketsList(merged);
      return;
    }

    // ✅ Offline -> usar cache (histórico)
    const cached = loadTicketsCache();
    ticketsCache = cached;

    const merged = getAllTicketsForUI(ticketsCache);
    renderTicketsList(merged);
  } catch (e) {
    console.error(e);

    // ✅ fallback final: si falla todo, intenta cache
    const cached = loadTicketsCache();
    if (cached.length) {
      ticketsCache = cached;
      renderTicketsList(ticketsCache);
    } else {
      ticketsList.innerHTML = `<div class="parked-ticket-empty">Error cargando tickets.</div>`;
      toast("Error cargando tickets: " + (e?.message || e), "err", "Tickets");
    }
  } finally {
    ticketsLoading = false;
  }
}

function renderTicketsList(tickets) {
  if (!ticketsList) return;

  const term = (ticketsSearch?.value || "").trim().toLowerCase();
  let filtered = Array.isArray(tickets) ? tickets : [];

  if (term) {
    filtered = filtered.filter((t) => {
      const s = `${t.codigo || ""} ${t.nombrecliente || ""} ${t.total || ""} ${
        t.codpago || ""
      }`.toLowerCase();
      return s.includes(term);
    });
  }

  ticketsList.innerHTML = "";

  if (!filtered.length) {
    ticketsList.innerHTML = `<div class="parked-ticket-empty">No hay tickets.</div>`;
    return;
  }

  filtered.forEach((t) => {
    const div = document.createElement("div");
    div.className = "ticket-row";

    const num = t.codigo || `#${t.idfactura}`;
    const cliente = t.nombrecliente || "Cliente";
    const fechaHora = `${t.fecha || ""} ${t.hora || ""}`.trim();
    const totalNum = Number(t.total || 0);
    const total = eurES(totalNum);
    const pago = t.codpago || "—";

    // ✅ ticket devuelto = total negativo
    const isRefunded = totalNum < 0;
    if (isRefunded) div.classList.add("ticket-refunded");

    div.innerHTML = `
      <div class="ticket-left">
        <div class="ticket-num">${escapeHtml(num)}</div>

        <div class="ticket-mid">
          <span class="ticket-client">${escapeHtml(cliente)}</span>
          <span class="ticket-pay">${escapeHtml(pago)}</span>
          <span class="ticket-id">${
            t._offline ? "OFFLINE" : `ID ${t.idfactura}`
          }</span>
        </div>

        <div class="ticket-bot">${escapeHtml(fechaHora)}</div>
      </div>

      <div class="ticket-right">
        <div class="ticket-total">${total}</div>

        <div class="ticket-actions">
          <button type="button" class="ticket-btn ticket-print" title="Imprimir">🖨</button>
          ${
            isRefunded
              ? ""
              : `<button type="button" class="ticket-btn ticket-refund" title="Devolver">↩</button>`
          }
        </div>
      </div>
    `;

    // ✅ imprimir siempre
    const printBtn = div.querySelector(".ticket-print");
    if (printBtn) {
      printBtn.onclick = async (e) => {
        e.stopPropagation();

        // ✅ Si es ticket offline, imprimimos lo guardado (sin API)
        if (t && t._offline) {
          const ticket = {
            numero: t.codigo || "OFFLINE",
            fecha: t.fecha || "",
            hora: t.hora || "",
            paymentMethod: t.codpago || "—",
            clientName: t.nombrecliente || "Venta en cola",
            terminalName: currentTerminal ? currentTerminal.name : "",
            agentName: currentAgent ? currentAgent.name : "",
            company: companyInfo ? { ...companyInfo } : null,
            lineas: Array.isArray(t.lineas) ? t.lineas : [],
            total: Number(t.total || 0),
            pagos: Array.isArray(t.pagos) ? t.pagos : [],
            cambio: Number(t.cambio || 0),
          };

          await printTicket(ticket);
          return;
        }

        // ✅ Online normal
        await imprimirFacturaHistorica(t);
      };
    }

    // ✅ devolver solo si existe el botón (no devueltos)
    const refundBtn = div.querySelector(".ticket-refund");
    if (refundBtn) {
      refundBtn.onclick = async (e) => {
        e.stopPropagation();
        await openRefundForFactura(t);
      };
    }

    // ✅ click en la fila: solo abre devolución si NO está devuelto
    div.onclick = async () => {
      if (isRefunded) return;
      await openRefundForFactura(t);
    };

    ticketsList.appendChild(div);
  });
}

// Bind botones del overlay
const ticketsKeyboardBtn = document.getElementById("ticketsKeyboardBtn");

ticketsKeyboardBtn?.addEventListener("click", () => {
  if (!ticketsSearch) return;
  openQwertyForInput(ticketsSearch);
});
if (ticketsCloseBtn) ticketsCloseBtn.onclick = closeTicketsModal;
if (ticketsReloadBtn) ticketsReloadBtn.onclick = loadAndRenderTickets;
let ticketsSearchTimer = null;

if (ticketsSearch) {
  ticketsSearch.oninput = () => {
    clearTimeout(ticketsSearchTimer);
    ticketsSearchTimer = setTimeout(() => {
      // ✅ usa el cache ya cargado
      renderTicketsList(ticketsCache);
    }, 250);
  };
}

function mapFacturaRowToTicketRow(f) {
  return {
    idfactura: f.idfactura,
    codigo: f.codigo || f.numero || f.codigofactura || null,
    nombrecliente: f.nombrecliente || f.cliente || f.razonsocial || "",
    total: f.total != null ? Number(f.total) : 0,
    codpago: f.codpago || f.formapago || "",
    fecha: f.fecha || "",
    hora: f.hora || "",
    _raw: f,
  };
}

function filterLastNDays(list, days = 30) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return (Array.isArray(list) ? list : []).filter((t) => {
    const ts = parseFechaHoraFS(t.fecha, t.hora, t.idfactura);

    return ts >= cutoff;
  });
}

// Botón "Tickets" (YA FUNCIONAL)
const ticketsListBtn = document.getElementById("ticketsListBtn");
if (ticketsListBtn) ticketsListBtn.onclick = openTicketsModal;

function parseFechaHoraFS(fecha, hora, idfactura) {
  // ✅ Si tenemos timestamp local guardado, SIEMPRE manda (corrige tickets de cola)
  const tsLocal = idfactura ? getFacturaLocalTimestamp(idfactura) : 0;
  if (tsLocal) return tsLocal;

  const f = String(fecha || "").trim();
  const h = String(hora || "00:00:00").trim();

  let yyyy, mm, dd;

  // dd-mm-yyyy
  let m = f.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) {
    dd = Number(m[1]);
    mm = Number(m[2]) - 1;
    yyyy = Number(m[3]);
  } else {
    // yyyy-mm-dd
    m = f.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return 0;
    yyyy = Number(m[1]);
    mm = Number(m[2]) - 1;
    dd = Number(m[3]);
  }

  const [HH, MM, SS] = h.split(":").map((x) => Number(x || 0));
  return new Date(yyyy, mm, dd, HH, MM, SS).getTime();
}

function sortTicketsByFechaDesc(list) {
  return (Array.isArray(list) ? list : []).slice().sort((a, b) => {
    const ta = parseFechaHoraFS(a.fecha, a.hora, a.idfactura);
    const tb = parseFechaHoraFS(b.fecha, b.hora, b.idfactura);
    return tb - ta;
  });
}

function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}

function isValidEmailFormat(email) {
  const e = normalizeEmail(email);
  // simple y suficiente para TPV (sin RFC loco)
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

function updateEmailModalValidation() {
  const emailInput = document.getElementById("emailInput");
  const emailOkBtn = document.getElementById("emailOkBtn");
  const emailError = document.getElementById("emailError");
  if (!emailInput || !emailOkBtn) return;

  const val = (emailInput.value || "").trim();
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val.toLowerCase());

  emailOkBtn.disabled = !ok;
  if (emailError)
    emailError.textContent =
      !val || ok ? "" : "Email no válido (ej: nombre@dominio.com)";
}

function getSavedConfig() {
  return {
    companyEmail: localStorage.getItem("tpv_companyEmail") || "",
    baseUrl: localStorage.getItem("tpv_baseUrl") || "",
    apiKey: localStorage.getItem("tpv_apiKey") || "",
  };
}

function saveResolvedCompany({ email, baseUrl, apiKey }) {
  localStorage.setItem("tpv_companyEmail", email);
  localStorage.setItem("tpv_baseUrl", baseUrl);
  localStorage.setItem("tpv_apiKey", apiKey || "");
}

async function fetchClientsJson() {
  const base = (window.TPV_CONFIG && window.TPV_CONFIG.resolverUrl) || "";
  if (!base) throw new Error("Falta TPV_CONFIG.resolverUrl");
  const url = `${base}?t=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("No se pudo cargar clients.json");
  return await res.json();
}

async function resolveCompanyByEmail(email) {
  const e = normalizeEmail(email);
  if (!e) throw new Error("Email vacío");

  const data = await fetchClientsJson();
  const client = (data.clients || []).find(
    (c) => normalizeEmail(c.email) === e
  );

  if (!client) throw new Error("Cuenta no encontrada");
  if (client.active === false) throw new Error("Cuenta desactivada");

  const slug = client.slug;
  const apiKey = client.apiKey;

  if (!slug) throw new Error("clients.json: falta slug");
  if (!apiKey) throw new Error("clients.json: falta apiKey");

  const baseUrl = `https://plus.recipok.com/${slug}/api/3`;
  return { email: e, baseUrl, apiKey };
}

async function validateBaseUrlOrThrow(baseUrl, apiKey) {
  const url = `${baseUrl.replace(/\/+$/, "")}/productos?limit=1`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", Token: apiKey },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Ping falló: HTTP ${res.status}`);
    }

    await res.json().catch(() => null);
    return true;
  } finally {
    clearTimeout(t);
  }
}

async function forceReconnectFlow() {
  try {
    toast("Conectando…", "info");

    let email = await askEmailWithModal();
    email = normalizeEmail(email);

    if (!email) {
      toast("Conexión cancelada. Sigues en modo demo.", "warn");
      return false;
    }

    // Esto ya valida si existe y si está activa
    const resolved = await resolveCompanyByEmail(email);

    saveResolvedCompany(resolved);

    window.RECIPOK_API.baseUrl = resolved.baseUrl;
    window.RECIPOK_API.apiKey = resolved.apiKey;

    await validateBaseUrlOrThrow(resolved.baseUrl, resolved.apiKey);

    TPV_STATE.offline = false;
    TPV_STATE.locked = false;
    updateCashButtonLabel();

    toast("Conectado ✅", "ok");

    // Recargamos datos reales
    await loadDataFromApi();

    return true;
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);

    if (msg.toLowerCase().includes("desactivada")) {
      TPV_STATE.locked = true;
      TPV_STATE.offline = false;
      updateCashButtonLabel();
      showMessageModal(
        "Acceso bloqueado",
        "Tu cuenta de TPV está desactivada. Contacta con soporte."
      );
      return false;
    }

    TPV_STATE.offline = true;
    updateCashButtonLabel();
    toast("No se pudo conectar. Modo demo.", "warn");
    return false;
  }
}

async function bootstrapApp() {
  const resolved = await bootstrapCompany(); // ← importante capturar retorno
  if (!resolved) {
    // Cancelado o bloqueado: NO seguimos
    return;
  }

  const ok = await openLoginModal();
  if (!ok) return;

  await loadDataFromApi();

  // ✅ Precarga/caché de formas de pago para modo offline (sin abrir modal)
  try {
    const methods = await fetchFormasPagoActivas(); // esta función debe guardar cache
    console.log("Formas de pago precargadas:", methods?.length || 0);
  } catch (e) {
    console.warn("No se pudieron precargar formapagos:", e?.message || e);
  }

  // ✅ Precarga/caché de tickets (para modo offline)
  try {
    const list = await fetchUltimosTickets(60);
    saveTicketsCache(list);
    console.log("Tickets precargados:", list?.length || 0);
  } catch (e) {
    console.warn("No se pudieron precargar tickets:", e?.message || e);
  }
}

/*bootstrapApp();*/

async function bootstrapCompany() {
  console.log("bootstrapCompany() ejecutándose...");

  const saved = getSavedConfig();
  const savedEmail = normalizeEmail(saved.companyEmail);

  const applyResolved = ({ baseUrl, apiKey }) => {
    window.RECIPOK_API.baseUrl = baseUrl;
    window.RECIPOK_API.apiKey = apiKey;
  };

  // 0) Siempre leemos clients.json para decidir si puede entrar o no
  let clientsData = null;
  try {
    clientsData = await fetchClientsJson();
  } catch (e) {
    console.warn("No se pudo cargar clients.json. Modo tolerante:", e);
    clientsData = { clients: [] };
  }

  const findClientByEmail = (email) => {
    const e = normalizeEmail(email);
    return (
      (clientsData.clients || []).find((c) => normalizeEmail(c.email) === e) ||
      null
    );
  };

  // Helper: pide email hasta que sea válido / cancel
  const askAndResolve = async () => {
    while (true) {
      let email = await askEmailWithModal();
      email = normalizeEmail(email);

      if (!email) {
        toast(
          "Activación cancelada. Arrancando en modo demo.",
          "warn",
          "Activación"
        );
        TPV_STATE.offline = true;
        TPV_STATE.locked = false;
        updateCashButtonLabel();
        return null; // cancelado
      }

      const client = findClientByEmail(email);

      if (!client) {
        alert("Email no encontrado. Revisa el email o contacta con soporte.");
        continue;
      }

      if (client.active === false) {
        TPV_STATE.locked = true;
        TPV_STATE.offline = false;
        updateCashButtonLabel();
        showMessageModal(
          "Acceso bloqueado",
          "Tu cuenta de TPV está desactivada. Contacta con soporte."
        );
        return null; // bloqueado
      }

      const resolved = await resolveCompanyByEmail(email);
      return resolved;
    }
  };

  // 1) Si hay email guardado, comprobamos SIEMPRE contra clients.json
  if (savedEmail) {
    const client = findClientByEmail(savedEmail);

    if (!client) {
      console.warn(
        "Email guardado ya no existe en clients.json. Pidiendo de nuevo..."
      );
      const resolved = await askAndResolve();
      if (!resolved) return false;

      saveResolvedCompany(resolved);
      applyResolved(resolved);
      await validateBaseUrlOrThrow(resolved.baseUrl, resolved.apiKey);
      TPV_STATE.offline = false;
      TPV_STATE.locked = false;
      updateCashButtonLabel();
      return true;
    }

    if (client.active === false) {
      TPV_STATE.locked = true;
      TPV_STATE.offline = false;
      updateCashButtonLabel();
      showMessageModal(
        "Acceso bloqueado",
        "Tu cuenta de TPV está desactivada. Contacta con soporte."
      );
      return false;
    }

    // Existe y está activa: resolvemos desde email (que construye baseUrl/apiKey)
    try {
      const resolved = await resolveCompanyByEmail(savedEmail);
      saveResolvedCompany(resolved);
      applyResolved(resolved);
      await validateBaseUrlOrThrow(resolved.baseUrl, resolved.apiKey);
      TPV_STATE.offline = false;
      TPV_STATE.locked = false;
      updateCashButtonLabel();
      return true;
    } catch (e) {
      console.warn("Email activo pero fallo al validar. Pidiendo email...", e);
      const resolved2 = await askAndResolve();
      if (!resolved2) return false;

      saveResolvedCompany(resolved2);
      applyResolved(resolved2);
      await validateBaseUrlOrThrow(resolved2.baseUrl, resolved2.apiKey);
      TPV_STATE.offline = false;
      TPV_STATE.locked = false;
      updateCashButtonLabel();
      return true; // ✅ antes tenías return; (undefined)
    }
  }

  // 2) Si no hay email guardado: pedirlo
  const resolved = await askAndResolve();
  if (!resolved) return false;

  saveResolvedCompany(resolved);
  applyResolved(resolved);
  await validateBaseUrlOrThrow(resolved.baseUrl, resolved.apiKey);
  TPV_STATE.offline = false;
  TPV_STATE.locked = false;
  updateCashButtonLabel();
  return true; // ✅ antes faltaba
}

async function fetchFacturaClienteById(idfactura) {
  const data = await fetchApiResourceWithParams("facturaclientes", {
    "filter[idfactura]": idfactura,
    limit: 1,
  });
  return Array.isArray(data) && data[0] ? data[0] : null;
}

async function createReciboCliente({
  idfactura,
  codcliente, // ✅ NUEVO
  codpago,
  importe,
  fechaPago,
  idempresa, // opcional (pero recomendado)
  codigofactura, // opcional (pero recomendado)
  coddivisa, // opcional
  fecha, // opcional (fecha del recibo)
}) {
  const cfg = window.RECIPOK_API || {};
  if (!cfg.baseUrl || !cfg.apiKey) throw new Error("Config API no definida");

  if (!codcliente) throw new Error("Falta codcliente para crear el recibo");

  const base = cfg.baseUrl.replace(/\/+$/, "");
  const url = `${base}/reciboclientes`;

  const body = new URLSearchParams();
  body.append("idfactura", String(idfactura));
  body.append("codcliente", String(codcliente)); // ✅ CLAVE
  body.append("codpago", String(codpago));
  body.append("importe", String(importe));
  body.append("pagado", "1");

  // Recomendados para evitar rarezas en algunos setups de FS
  if (idempresa != null) body.append("idempresa", String(idempresa));
  if (codigofactura) body.append("codigofactura", String(codigofactura));
  if (coddivisa) body.append("coddivisa", String(coddivisa));
  if (fecha) body.append("fecha", String(fecha));

  if (fechaPago) body.append("fechapago", String(fechaPago));
  // si tu FS lo usa, también puedes mandar vencimiento = fecha
  if (fecha) body.append("vencimiento", String(fecha));

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Token: cfg.apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Error creando recibo: HTTP ${res.status} ${txt}`);
  }

  return await res.json().catch(() => ({}));
}

// ===== Recibos: limpieza de duplicados (evita "recibo total" + recibos por método) =====
async function fetchRecibosByFactura(idfactura) {
  const data = await fetchApiResourceWithParams("reciboclientes", {
    "filter[idfactura]": idfactura,
    limit: 200,
    order: "desc",
  });
  return Array.isArray(data) ? data : [];
}

async function deleteReciboCliente(idrecibo) {
  const cfg = window.RECIPOK_API || {};
  if (!cfg.baseUrl || !cfg.apiKey) throw new Error("Config API no definida");

  const base = cfg.baseUrl.replace(/\/+$/, "");
  const url = `${base}/reciboclientes/${idrecibo}`;

  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Accept: "application/json",
      Token: cfg.apiKey,
    },
  });

  // Algunas instalaciones devuelven 200/204 con o sin JSON
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `Error borrando recibo ${idrecibo}: HTTP ${res.status} ${txt}`
    );
  }
  return true;
}

// Deja SOLO los recibos que correspondan a los pagos del modal.
// Elimina el recibo "total" automático y cualquier duplicado.
async function cleanupRecibosFactura(idfactura, pagosEsperados) {
  if (!idfactura) return;

  const round2 = (n) => Number((Number(n) || 0).toFixed(2));

  // Lista esperada (permitimos repetidos)
  const expected = (Array.isArray(pagosEsperados) ? pagosEsperados : [])
    .map((p) => ({
      codpago: String(p.codpago || "").trim(),
      importe: round2(p.importe),
    }))
    .filter((x) => x.codpago && x.importe > 0);

  if (!expected.length) return;

  const recibos = await fetchRecibosByFactura(idfactura);

  // Vamos consumiendo "expected" para quedarnos con 1 recibo por cada pago esperado.
  const expectedPool = expected.slice();

  const matchesOneExpected = (r) => {
    const cod = String(r.codpago || "").trim();
    const imp = round2(r.importe);

    const idx = expectedPool.findIndex(
      (e) => e.codpago === cod && e.importe === imp
    );
    if (idx >= 0) {
      expectedPool.splice(idx, 1); // consumimos este esperado
      return true;
    }
    return false;
  };

  for (const r of recibos) {
    const idrecibo = r.idrecibo || r.id || r.idrecibocliente;
    if (!idrecibo) continue;

    // Si coincide con uno de los pagos esperados, lo dejamos.
    if (matchesOneExpected(r)) continue;

    // Si NO coincide => es el "total" automático o un duplicado => lo borramos
    try {
      await deleteReciboCliente(idrecibo);
    } catch (e) {
      console.warn(
        "No se pudo borrar recibo duplicado:",
        idrecibo,
        e?.message || e
      );
    }
  }
}

async function fetchApiResourceWithParams(resource, params = {}) {
  const cfg = window.RECIPOK_API;
  if (!cfg || !cfg.baseUrl || !cfg.apiKey)
    throw new Error("Config API no definida");

  const base = cfg.baseUrl.replace(/\/+$/, "");
  const sp = new URLSearchParams();

  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    sp.append(k, String(v));
  });

  const url = `${base}/${resource}${sp.toString() ? "?" + sp.toString() : ""}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json", Token: cfg.apiKey },
    cache: "no-store",
  });

  if (res.status === 429)
    throw new Error("API 429 (demasiadas peticiones). Espera unos minutos.");
  const data = await res.json().catch(() => null);

  if (!res.ok) throw new Error(`HTTP ${res.status} en ${resource}`);
  if (data && data.status === "error")
    throw new Error(data.message || `Error API en ${resource}`);

  return data;
}

// =============================================================
// IMÁGENES DE PRODUCTOS (attachedfiles + attachedfilerelations)
// =============================================================

// Mapa global: { [idproducto]: { idfile, url, filename, mimetype } }
let PRODUCT_IMAGES_MAP = {};

// Devuelve solo los files que sean imagen
async function fetchAttachedImageFiles() {
  const data = await fetchApiResourceWithParams("attachedfiles", {
    limit: 5000,
    order: "desc",
  });

  const list = Array.isArray(data) ? data : [];

  return list.filter((f) => {
    const mime = String(f.mimetype || "").toLowerCase();
    const name = String(f.filename || "");
    return mime.startsWith("image/") || /\.(jpe?g|png|gif|webp)$/i.test(name);
  });
}

// Devuelve solo relaciones de tipo Producto
async function fetchProductFileRelations() {
  const data = await fetchApiResourceWithParams("attachedfilerelations", {
    "filter[model]": "Producto",
    limit: 5000,
    order: "desc",
  });

  const list = Array.isArray(data) ? data : [];
  return list.filter(
    (r) =>
      String(r.model || "") === "Producto" &&
      r.idfile != null &&
      r.modelid != null
  );
}

// Construye el mapa idproducto -> { url, idfile, ... }
async function buildProductImagesMap() {
  const [files, relations] = await Promise.all([
    fetchAttachedImageFiles(),
    fetchProductFileRelations(),
  ]);

  const fileById = {};
  files.forEach((f) => {
    fileById[Number(f.idfile)] = f;
  });

  const cfg = window.RECIPOK_API || {};
  const apiBase = (cfg.baseUrl || "").replace(/\/+$/, "");
  const fileBase = apiBase.replace(/\/api\/3$/i, "");

  const map = {};

  relations.forEach((rel) => {
    const idprod = Number(rel.modelid);
    const idfile = Number(rel.idfile);
    if (!idprod || !idfile) return;

    if (map[idprod]) return; // nos quedamos con la primera

    const f = fileById[idfile];
    if (!f) return;

    const path = f["download-permanent"] || f.download || f.path || "";

    if (!path) return;

    const url = `${fileBase}/${path.replace(/^\/+/, "")}`;

    map[idprod] = {
      idfile,
      url,
      filename: f.filename || "",
      mimetype: f.mimetype || "",
    };
  });

  PRODUCT_IMAGES_MAP = map;
  return map;
}

async function fetchUltimosTickets(limit = 60, days = 30) {
  const onlyTpvId = String(currentTerminal?.id || "");
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10); // YYYY-MM-DD

  // Pedimos más de lo necesario para poder filtrar bien
  const rows = await fetchApiResourceWithParams("facturaclientes", {
    limit: Math.max(200, limit * 4),
    order: "desc",

    // ✅ Si tu FacturaScripts soporta estos filtros, perfecto:
    ...(onlyTpvId ? { "filter[idtpv]": onlyTpvId } : {}),
    "filter[fecha_gte]": since,
  });

  // Mapeo a tu formato UI
  let list = (Array.isArray(rows) ? rows : []).map(mapFacturaRowToTicketRow);

  // ✅ Fallback por si el server no filtra bien:
  if (onlyTpvId) {
    list = list.filter((t) => {
      const raw = t._raw || {};
      const idtpv = raw.idtpv ?? t.idtpv ?? raw.codtpv ?? "";
      return String(idtpv) === onlyTpvId;
    });
  }

  list = filterLastNDays(list, days);
  list = hideRefundedOriginals(list);
  list = sortTicketsByFechaDesc(list);

  return list.slice(0, limit);
}

function hideRefundedOriginals(rows) {
  const list = Array.isArray(rows) ? rows : [];

  // ids de originales que ya tienen una rectificativa
  const refundedOriginalIds = new Set(
    list
      .map((r) => Number(r.idfacturarect || r._raw?.idfacturarect || 0))
      .filter((n) => n > 0)
  );

  // quitamos las originales que estén en ese set
  return list.filter((r) => {
    const id = Number(r.idfactura || r._raw?.idfactura || 0);
    const isOriginalRefunded = refundedOriginalIds.has(id);

    // OJO: no filtramos la rectificativa, solo la original
    const isRectificativa =
      Number(r.idfacturarect || r._raw?.idfacturarect || 0) > 0;
    if (isRectificativa) return true;

    return !isOriginalRefunded;
  });
}

async function fetchLineasFactura(idfactura) {
  // 1) Intento A: filtro tipo FS
  try {
    const data = await fetchApiResourceWithParams("lineafacturaclientes", {
      "filter[idfactura]": idfactura,
      limit: 2000,
    });
    if (Array.isArray(data) && data.length) return data;
  } catch (e) {
    // seguimos al fallback
  }

  // 2) Intento B: query simple
  try {
    const data = await fetchApiResourceWithParams("lineafacturaclientes", {
      idfactura,
      limit: 2000,
    });
    if (Array.isArray(data) && data.length) return data;
  } catch (e) {
    // seguimos al fallback
  }

  // 3) Fallback: traemos muchas y filtramos (no ideal, pero funciona)
  const data = await fetchApiResourceWithParams("lineafacturaclientes", {
    limit: 5000,
  });
  const list = Array.isArray(data) ? data : [];
  return list.filter((l) => Number(l.idfactura) === Number(idfactura));
}

async function imprimirFacturaPorId(facturaRow) {
  const idfactura = facturaRow.idfactura;
  const lineas = await fetchLineasFactura(idfactura);

  const mapped = lineas.map((l) => {
    const taxRate = extractTaxRateFromCode(l.codimpuesto);
    const unitNet = Number(l.pvpunitario || 0);
    const unitGross = unitNet * (1 + taxRate / 100);

    return {
      name: l.descripcion || "Producto",
      qty: Number(l.cantidad || 0),
      price: unitNet,
      grossPrice: unitGross,
      codimpuesto: l.codimpuesto || null,
      taxRate,
    };
  });

  const ticket = {
    numero: facturaRow.codigo || facturaRow.numero || String(idfactura),
    fecha: facturaRow.fecha,
    hora: facturaRow.hora,
    paymentMethod: facturaRow.formapago || facturaRow.codpago || "—",
    clientName: facturaRow.nombrecliente || facturaRow.cliente || "Cliente",
    terminalName: currentTerminal ? currentTerminal.name : "",
    agentName: currentAgent ? currentAgent.name : facturaRow.codagente || "—",

    company: companyInfo ? { ...companyInfo } : null,
    lineas: mapped,
  };

  await printTicket(ticket);
}

async function onConnectClick() {
  try {
    // Si NO hay email/baseUrl/apiKey → pedir email (activar)
    if (!hasCompanyResolved()) {
      const ok = await forceReconnectFlow(); // ya la tienes
      return ok; // true/false
    }

    // Si ya hay empresa, intentamos reconectar/ping y recargar
    toast("Conectando…", "info", "Conexión");

    const saved = getSavedConfig();
    await validateBaseUrlOrThrow(saved.baseUrl, saved.apiKey);

    TPV_STATE.offline = false;
    TPV_STATE.locked = false;
    updateCashButtonLabel();

    await loadDataFromApi();
    await syncQueueNow();
    toast("Conectado ✅", "ok", "Conexión");
    return true;
  } catch (e) {
    console.warn("Fallo al conectar:", e);

    TPV_STATE.offline = true;
    updateCashButtonLabel();

    // Si falla (apiKey caducada, url mal, etc.) → forzamos reactivar
    toast("No se pudo conectar. Vamos a reactivar.", "warn", "Conexión");
    const ok = await forceReconnectFlow();
    return ok;
  }
}

function askEmailWithModal() {
  return new Promise((resolve) => {
    // ✅ Buscar DOM SIEMPRE aquí (no usar variables globales cacheadas)
    const emailOverlay = document.getElementById("emailOverlay");
    const emailInput = document.getElementById("emailInput");
    const emailOkBtn = document.getElementById("emailOkBtn");
    const emailCancelBtn = document.getElementById("emailCancelBtn");
    const emailError = document.getElementById("emailError");
    const emailKeyboardBtn = document.getElementById("emailKeyboardBtn");

    // ✅ Si faltan elementos, NO usamos prompt en Electron: mostramos mensaje claro
    if (!emailOverlay || !emailInput || !emailOkBtn || !emailCancelBtn) {
      console.error(
        "Falta el HTML del modal de email (#emailOverlay, #emailInput, #emailOkBtn, #emailCancelBtn)."
      );
      toast?.(
        "Falta el modal de email en el HTML. No puedo pedir el email.",
        "err",
        "Activación"
      );
      resolve("");
      return;
    }

    const isValidEmailFormat = (email) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((email || "").trim().toLowerCase());

    const updateValidation = () => {
      const val = (emailInput.value || "").trim();
      const ok = isValidEmailFormat(val);
      emailOkBtn.disabled = !ok;

      if (emailError) {
        if (!val) emailError.textContent = "";
        else
          emailError.textContent = ok
            ? ""
            : "Email no válido (ej: nombre@dominio.com)";
      }
    };

    if (emailError) emailError.textContent = "";
    emailInput.value = "";
    emailOkBtn.disabled = true;

    emailOverlay.classList.remove("hidden");
    emailInput.focus();

    emailInput.addEventListener("input", updateValidation);
    updateValidation();

    if (emailKeyboardBtn) {
      emailKeyboardBtn.onclick = () => {
        openQwertyForInput(emailInput, "email");
      };
    }

    const cleanup = () => {
      emailOkBtn.onclick = null;
      emailCancelBtn.onclick = null;
      emailInput.onkeydown = null;
      emailInput.removeEventListener("input", updateValidation);
    };

    emailCancelBtn.onclick = () => {
      cleanup();
      emailOverlay.classList.add("hidden");
      resolve("");
    };

    emailOkBtn.onclick = () => {
      const val = (emailInput.value || "").trim();
      if (!isValidEmailFormat(val)) {
        updateValidation();
        return;
      }
      cleanup();
      emailOverlay.classList.add("hidden");
      resolve(val);
    };

    emailInput.onkeydown = (e) => {
      if (e.key === "Enter") emailOkBtn.click();
      if (e.key === "Escape") emailCancelBtn.click();
    };
  });
}

function buildDevolucionLineUI(l) {
  const soldQty = Number(l.cantidad || 0);
  const taxRate = extractTaxRateFromCode(l.codimpuesto);
  const unitNet = Number(l.pvpunitario || 0);
  const unitGross = unitNet * (1 + taxRate / 100);

  return {
    idlinea: l.idlinea,
    descripcion: l.descripcion || "",
    soldQty,
    returnQty: 0, // <-- esto lo modifica el usuario
    unitNet,
    unitGross,
    codimpuesto: l.codimpuesto || null,
    taxRate,
  };
}

function buildTicketFromFacturaRow(facturaRow, lineasFactura) {
  const mapped = (lineasFactura || []).map((l) => {
    const taxRate = extractTaxRateFromCode(l.codimpuesto);
    const unitNet = Number(l.pvpunitario || 0);
    const unitGross = unitNet * (1 + taxRate / 100);

    return {
      name: l.descripcion || "Producto",
      qty: Number(l.cantidad || 0),
      price: unitNet, // neto
      grossPrice: unitGross, // bruto
      codimpuesto: l.codimpuesto || null,
      taxRate,
    };
  });

  return {
    numero:
      facturaRow.codigo || facturaRow.numero || String(facturaRow.idfactura),
    fecha: facturaRow.fecha || "",
    hora: facturaRow.hora || "",
    paymentMethod: facturaRow.codpago || "—",
    clientName: facturaRow.nombrecliente || "Cliente",
    terminalName: currentTerminal
      ? currentTerminal.name
      : `TPV ${facturaRow.idtpv || "—"}`,
    agentName: currentAgent ? currentAgent.name : facturaRow.codagente || "—",
    company: companyInfo ? { ...companyInfo } : null,
    lineas: mapped,
    total: Number(facturaRow.total || 0),
  };
}

async function imprimirFacturaHistorica(facturaRow) {
  const id = facturaRow.idfactura;
  const lineas = await fetchLineasFactura(id);
  const ticket = buildTicketFromFacturaRow(facturaRow, lineas);
  await printTicket(ticket);
}

function lineNetTotal(l) {
  return Number(l.pvpunitario || 0) * Number(l.cantidad || 0);
}
function lineTaxRate(l) {
  // si viene "iva": 10, úsalo; si no, saca de codimpuesto
  const iva = Number(l.iva);
  if (!isNaN(iva) && iva > 0) return iva;
  return extractTaxRateFromCode(l.codimpuesto);
}
function lineGrossUnit(l) {
  const net = Number(l.pvpunitario || 0);
  const tax = lineTaxRate(l);
  return net * (1 + tax / 100);
}
function lineGrossTotal(l) {
  return lineGrossUnit(l) * Number(l.cantidad || 0);
}

let refundState = {
  factura: null,
  lineas: [],
  qtyByLineId: {}, // { idlinea: qtyDevolver }
};

function eurES(n) {
  return (Number(n) || 0).toFixed(2).replace(".", ",") + " €";
}

function renderRefundLines() {
  const wrap = document.getElementById("refundLines");
  if (!wrap) return;

  wrap.innerHTML = "";

  refundState.lineas.forEach((l) => {
    const max = Number(l.cantidad || 0);
    const id = Number(l.idlinea);
    const curr = Number(refundState.qtyByLineId[id] || 0);

    const unitGross = lineGrossUnit(l);
    const tax = lineTaxRate(l);

    const row = document.createElement("div");
    row.style.cssText =
      "display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 0; border-bottom:1px solid #eee;";

    row.innerHTML = `
      <div style="flex:1; min-width:0;">
        <div style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          ${escapeHtml(l.descripcion || "Producto")}
        </div>
        <div style="font-size:12px; opacity:.8;">
          Vendido: ${max} · ${eurES(unitGross)} / ud · IVA ${tax}%
        </div>
      </div>

      <div style="display:flex; align-items:center; gap:6px;">
        <button type="button" class="cart-btn" data-a="minus" data-id="${id}">-</button>
        <div style="min-width:34px; text-align:center; font-weight:700;">${curr}</div>
        <button type="button" class="cart-btn" data-a="plus" data-id="${id}">+</button>
      </div>

      <div style="width:110px; text-align:right; font-weight:700;">
        ${eurES(unitGross * curr)}
      </div>
    `;

    wrap.appendChild(row);
  });

  updateRefundAmount();
}

function updateRefundAmount() {
  const el = document.getElementById("refundAmount");
  if (!el) return;

  let total = 0;
  refundState.lineas.forEach((l) => {
    const id = Number(l.idlinea);
    const q = Number(refundState.qtyByLineId[id] || 0);
    total += lineGrossUnit(l) * q;
  });

  el.textContent = eurES(total);
}

function bindRefundLineClicks() {
  const wrap = document.getElementById("refundLines");
  if (!wrap) return;

  wrap.onclick = (e) => {
    const btn = e.target.closest("button[data-a]");
    if (!btn) return;

    const id = Number(btn.dataset.id);
    const action = btn.dataset.a;

    const line = refundState.lineas.find((x) => Number(x.idlinea) === id);
    if (!line) return;

    const max = Number(line.cantidad || 0);
    let curr = Number(refundState.qtyByLineId[id] || 0);

    if (action === "plus") curr += 1;
    if (action === "minus") curr -= 1;

    if (curr < 0) curr = 0;
    if (curr > max) curr = max;

    refundState.qtyByLineId[id] = curr;
    renderRefundLines();
  };
}

function refundSelectAll() {
  refundState.lineas.forEach((l) => {
    refundState.qtyByLineId[Number(l.idlinea)] = Number(l.cantidad || 0);
  });
  renderRefundLines();
}
function refundSelectNone() {
  refundState.qtyByLineId = {};
  renderRefundLines();
}

async function openRefundForFactura(facturaRow) {
  const overlay = document.getElementById("refundOverlay");
  if (!overlay) {
    toast("Falta #refundOverlay en el HTML.", "err", "Devolución");
    return;
  }

  const lineas = await fetchLineasFactura(facturaRow.idfactura);

  refundState.factura = facturaRow;
  refundState.lineas = lineas;
  refundState.qtyByLineId = {}; // empieza en 0

  // Cabecera
  const n = document.getElementById("refundTicketNum");
  const c = document.getElementById("refundClient");
  const t = document.getElementById("refundTicketTotal");
  if (n) n.textContent = facturaRow.codigo || `#${facturaRow.idfactura}`;
  if (c) c.textContent = facturaRow.nombrecliente || "Cliente";
  if (t) t.textContent = eurES(facturaRow.total || 0);

  overlay.classList.remove("hidden");
  bindRefundLineClicks();
  renderRefundLines();

  // binds botones
  const x = document.getElementById("refundCloseX");
  const cancel = document.getElementById("refundCancelBtn");
  const all = document.getElementById("refundSelectAllBtn");
  const none = document.getElementById("refundSelectNoneBtn");

  if (x) x.onclick = () => overlay.classList.add("hidden");
  if (cancel) cancel.onclick = () => overlay.classList.add("hidden");
  if (all) all.onclick = refundSelectAll;
  if (none) none.onclick = refundSelectNone;

  const confirmBtn = document.getElementById("refundConfirmBtn"); // asegúrate que existe en HTML

  if (confirmBtn) {
    confirmBtn.onclick = async () => {
      try {
        confirmBtn.disabled = true;

        // 1) Crear devolución en FS
        const resp = await createRefundInFacturaScripts(
          facturaRow,
          refundState.qtyByLineId,
          refundState.lineas
        );

        toast("Devolución creada ✅", "ok", "Devolución");

        // 2) Cerrar modal
        overlay.classList.add("hidden");

        // 3) Refrescar lista (para que aparezca la nueva factura rectificativa)
        await loadAndRenderTickets();

        // 4) (Opcional) imprimir automáticamente la devolución:
        // const doc = resp.doc || resp.factura || resp.data || resp;
        // if (doc?.idfactura) {
        //   const row = { ...facturaRow, idfactura: doc.idfactura, codigo: doc.codigo || null, total: doc.total || 0 };
        //   await imprimirFacturaHistorica(row);
        // }
      } catch (e) {
        console.error(e);
        toast("Error en devolución: " + (e?.message || e), "err", "Devolución");
      } finally {
        confirmBtn.disabled = false;
      }
    };
  }
}

async function doLogoutFlow() {
  if (!getLoginToken() && !getLoginUser()) return;

  const ok = await confirmModal(
    "Cerrar sesión",
    "¿Estás seguro de cerrar sesión?"
  );
  if (!ok) return;

  clearLoginSession();
  refreshLoggedUserUI();
  resetTPVToEmpty();

  toast?.("Sesión cerrada", "info", "Usuario");
}

async function ensureDataLoaded() {
  const need =
    !Array.isArray(products) ||
    products.length === 0 ||
    !Array.isArray(categories) ||
    categories.length === 0;

  if (!need) return;

  try {
    await loadDataFromApi();
  } catch (e) {
    console.warn("ensureDataLoaded() fallo:", e);
  }
}

const changePrinterBtn = document.getElementById("changePrinterBtn");
if (changePrinterBtn) {
  changePrinterBtn.onclick = async () => {
    try {
      const chosen = await openPrinterPicker();
      if (!chosen) return;
      savePrinterName(chosen);
      toast("Impresora guardada ✅", "ok", "Impresión");
    } catch (e) {
      toast("Error impresoras: " + (e?.message || e), "err", "Impresión");
    }
  };
}

function showMessageModal(title, text) {
  const o = document.getElementById("msgOverlay");
  const t = document.getElementById("msgTitle");
  const p = document.getElementById("msgText");
  const b = document.getElementById("msgOkBtn");
  if (!o || !t || !p || !b) return;

  t.textContent = title || "Aviso";
  p.textContent = text || "";
  o.classList.remove("hidden");

  b.onclick = () => {
    o.classList.add("hidden");
  };
}

// ===== Inicialización =====
window.addEventListener("DOMContentLoaded", async () => {
  renderCart();
  updateCashButtonLabel();
  updateParkedCountBadge();
  refreshOptionsUI();

  // ✅ Arranca el monitor ANTES del bootstrap (para que actualice el badge siempre)
  startOnlineMonitor();

  await bootstrapApp();

  // ✅ precarga caches una vez logueado y con company resuelta
  warmUpOfflineCaches();
});

async function warmUpOfflineCaches() {
  try {
    // precargar formas de pago y tickets para offline
    await fetchFormasPagoActivas({ forceOnlineIfPossible: true });
    await refreshTicketsCacheFromServer();
  } catch (e) {
    // no pasa nada si falla (por ejemplo, sin internet)
    console.warn("warmUpOfflineCaches:", e?.message || e);
  }
}

// ===== Atajo de teclado para resetear TPV (Ctrl+Shift+R) =====
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "r") {
    localStorage.removeItem("tpv_companyEmail");
    localStorage.removeItem("tpv_baseUrl");
    localStorage.removeItem("tpv_apiKey");
    toast("TPV reseteado. Reinicia la app.", "ok", "Reset");
    setStatusText("TPV reseteado");
  }
});

/* =============================================================
   CAJA - Stepper + teclado numérico/calculadora
   ============================================================= */

function cashParseToInt(value) {
  // Permite expresiones tipo "2*4", "10+5", "20/2" etc.
  // Seguridad: solo números y operadores básicos.
  const raw = String(value ?? "")
    .trim()
    .replace(",", ".");
  if (!raw) return 0;

  // Solo deja: dígitos, espacios, + - * / ( ) y punto
  if (!/^[0-9+\-*/().\s]+$/.test(raw)) return 0;

  try {
    // Eval controlado (con filtro anterior). Resultado numérico.
    const result = Function(`"use strict"; return (${raw});`)();
    const n = Number(result);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.round(n)); // cantidades enteras >= 0
  } catch (e) {
    return 0;
  }
}

function cashSetInputValue(input, newVal) {
  const n = Math.max(0, parseInt(newVal, 10) || 0);
  input.value = String(n);
  // Si ya tienes un listener que recalcula totales al 'input', lo disparo:
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function cashWrapInputsWithSteppers() {
  const inputs = document.querySelectorAll(".cash-grid-page input[data-denom]");
  inputs.forEach((input) => {
    // Evitar envolver 2 veces
    if (input.closest(".cash-stepper")) return;

    // Convertimos a text para permitir expresiones y evitar spinners
    input.type = "text";
    input.inputMode = "numeric"; // en tablets/móviles abre teclado numérico
    input.autocomplete = "off";

    // Clase por si no la trae
    input.classList.add("cash-hidden-input");

    // Creamos wrapper y botones
    const wrap = document.createElement("div");
    wrap.className = "cash-stepper";

    const btnMinus = document.createElement("button");
    btnMinus.type = "button";
    btnMinus.className = "cash-stepper-btn minus";
    btnMinus.textContent = "–";

    const btnPlus = document.createElement("button");
    btnPlus.type = "button";
    btnPlus.className = "cash-stepper-btn plus";
    btnPlus.textContent = "+";

    // Insertamos wrapper en el DOM (mantenemos el orden)
    const parent = input.parentElement;
    parent.insertBefore(wrap, input);
    wrap.appendChild(btnMinus);
    wrap.appendChild(input);
    wrap.appendChild(btnPlus);

    // Botones +/- suman/restan 1
    btnMinus.addEventListener("click", () => {
      const current = cashParseToInt(input.value);
      cashSetInputValue(input, Math.max(0, current - 1));
    });

    btnPlus.addEventListener("click", () => {
      const current = cashParseToInt(input.value);
      cashSetInputValue(input, current + 1);
    });

    // Al salir del input, normalizamos el valor a entero
    input.addEventListener("blur", () => {
      const n = cashParseToInt(input.value);
      cashSetInputValue(input, n);
    });

    // Al tocar/click: abrir tu num-pad/calculadora
    input.addEventListener("focus", () => {
      cashOpenNumPadForInput(input);
    });
    input.addEventListener("click", () => {
      cashOpenNumPadForInput(input);
    });
  });
}

/**
 * Conecta con TU modal num-pad/calculadora existente.
 * Ajusta aquí el nombre de tu función si ya existe.
 *
 * Necesitamos algo así:
 *   openNumPad({ initialValue, onOk, allowExpression: true })
 *
 * Si ya tienes una función distinta, dime su nombre y la adapto 1:1.
 */
let __cashLastFocusedInput = null;

function cashOpenNumPadForInput(input) {
  // Evita doble apertura por focus+click
  if (__cashLastFocusedInput === input) return;
  __cashLastFocusedInput = input;

  if (typeof window.openNumPad === "function") {
    const initial = String(input.value || "0");

    window.openNumPad(
      initial,
      (val) => {
        const n = cashParseToInt(val);
        cashSetInputValue(input, n);
        __cashLastFocusedInput = null;
        input.blur(); // importante para que vuelva a disparar focus la próxima vez
      },
      "Caja", // productName (puede ser "")
      "cash", // mode (qty para cantidades)
      null,
      null
    );

    return;
  }

  __cashLastFocusedInput = null;
}

document.addEventListener("DOMContentLoaded", () => {
  cashWrapInputsWithSteppers();
});

/*Abrir Cajon*/
async function openDrawerNow() {
  try {
    const printerName = await ensurePrinterSelected();
    if (!printerName) {
      toast("No hay impresora seleccionada.", "warn", "Cajón");
      return false;
    }

    if (!window.TPV_PRINT?.openCashDrawer) {
      toast(
        "No está implementado openCashDrawer (preload/main).",
        "err",
        "Cajón"
      );
      return false;
    }

    const res = await window.TPV_PRINT.openCashDrawer(printerName);
    if (!res || !res.ok) {
      toast(
        "No se pudo abrir el cajón: " + (res?.error || "error"),
        "err",
        "Cajón"
      );
      return false;
    }

    toast("Cajón abierto ✅", "ok", "Cajón");
    return true;
  } catch (e) {
    toast("Error abriendo cajón: " + (e?.message || e), "err", "Cajón");
    return false;
  }
}

async function checkFSOnline() {
  try {
    const cfg = window.RECIPOK_API || {};
    if (!cfg.baseUrl || !cfg.apiKey) return false;

    const base = cfg.baseUrl.replace(/\/+$/, "");
    const url = `${base}/facturaclientes?limit=1`;

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 3000);

    try {
      const r = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json", Token: cfg.apiKey },
        cache: "no-store",
        signal: controller.signal,
      });

      return r.ok; // ✅ no uses r.status > 0
    } finally {
      clearTimeout(t);
    }
  } catch {
    return false;
  }
}

function updateOnlineBadge(ok) {
  const dot = document.getElementById("statusDot");
  const strong = document.querySelector("#statusBar strong");
  if (dot) dot.style.background = ok ? "#22c55e" : "#ef4444";
  if (strong)
    strong.textContent = ok ? "Online Recipok" : "Sin internet (modo offline)";
}

let isOnlineFS = null; // 👈 para forzar primera actualización

async function startOnlineMonitor() {
  async function tick() {
    const ok = await checkFSOnline();

    // ✅ actualiza estado siempre
    TPV_STATE.offline = !ok;

    // ✅ actualiza badge SIEMPRE (no solo cuando cambia)
    updateOnlineBadge(ok);

    // ✅ si vuelve internet, o si hay internet y hay pendientes -> sincroniza
    try {
      if (ok && window.TPV_QUEUE?.count) {
        const c = await window.TPV_QUEUE.count();
        if ((c?.pending || 0) > 0) {
          await syncQueueNow();
        }
      }
    } catch (e) {
      console.warn("No se pudo comprobar/sincronizar cola:", e?.message || e);
    }

    if (ok) {
      // ✅ si está abierto el modal de cobro, refresca formas y repinta
      if (!payOverlay?.classList.contains("hidden")) {
        try {
          const formas = await fetchFormasPagoActivas({
            forceOnlineIfPossible: true,
          });
          payModalState.formas = formas
            .map((f) => ({
              codpago: String(f.codpago || "").trim(),
              descripcion: String(f.descripcion || f.codpago || "").trim(),
              imprimir: f.imprimir !== false,
            }))
            .filter((x) => x.codpago);

          renderPayMethods(); // repinta SIN cerrar el modal
        } catch {}
      }
    }

    // solo para tracking interno (opcional)
    isOnlineFS = ok;
  }

  await tick();
  setInterval(tick, 5000);
}

/* =============================================================
   Envío/encolado de facturas
   ============================================================= */
async function sendOrQueueFactura(payload) {
  try {
    const r = await createTicketInFacturaScripts(payload); // tu POST actual
    return { ok: true, remote: r };
  } catch (e) {
    // detecta “error de red” vs “error de validación”
    const msg = e?.message || String(e);
    const isNetwork =
      msg.includes("Failed to fetch") ||
      msg.includes("Network") ||
      msg.includes("timeout");

    if (isNetwork) {
      const localId = crypto.randomUUID();
      await window.TPV_QUEUE.enqueue({
        type: "CREATE_FACTURACLIENTE",
        localId,
        payload,
        post: {
          pagos: payload?._payBreakdown || [], // ver nota abajo
          terminal: currentTerminal
            ? { id: currentTerminal.id, codalmacen: currentTerminal.codalmacen }
            : null,
          agente: currentAgent ? { codagente: currentAgent.codagente } : null,
          codpago: payload?.codpago || "",
        },
        createdAt: Date.now(),
      });

      saveOfflineTicketForTicketsModal({
        codigo: "OFF-" + localId.slice(0, 6).toUpperCase(),
        idfactura: null,
        nombrecliente: "Venta en cola",
        total: Number(payload?.total || 0),
        codpago: String(payload?.codpago || "—"),
        fecha: new Date().toISOString().slice(0, 10),
        hora: new Date().toTimeString().slice(0, 8),
        _localId: localId,
      });

      return { ok: false, queued: true, localId };
    }

    // si es error lógico (400), mejor NO encolar
    return { ok: false, queued: false, error: msg };
  }
}

/* =============================================================
   Sincronización de la cola
   ============================================================= */
async function syncQueueNow() {
  if (window.__SYNCING__) return;
  window.__SYNCING__ = true;

  try {
    while (true) {
      const next = await window.TPV_QUEUE.next();
      if (!next?.item) break;

      const item = next.item;

      try {
        if (item.type === "CREATE_FACTURACLIENTE") {
          const resp = await createTicketInFacturaScripts(item.payload);

          const idfactura =
            resp?.idfactura || resp?.doc?.idfactura || resp?.data?.idfactura;

          if (idfactura && item.createdAt) {
            saveFacturaLocalTimestamp(idfactura, item.createdAt);
          }

          // ✅ POST-PROCESO (emitida + pagada + recibos) para tickets offline
          if (idfactura) {
            // 1) Emitir y marcar pagada
            try {
              await updateFacturaCliente(idfactura, {
                idestado: 11,
                pagada: 1,
                codpago: item.post?.codpago || item.payload?.codpago || "",
                idtpv: currentTerminal?.id || item.post?.terminal?.id || "",
                codalmacen:
                  currentTerminal?.codalmacen ||
                  item.post?.terminal?.codalmacen ||
                  "",
                codagente:
                  currentAgent?.codagente || item.post?.agente?.codagente || "",
              });
            } catch (e) {
              console.warn(
                "No se pudo emitir/pagar factura offline:",
                e?.message || e
              );
            }

            // 2) Recibos por método + cleanup
            try {
              const today = new Date().toISOString().slice(0, 10);
              const pagos = item.post?.pagos || [];
              const fc = await fetchFacturaClienteById(idfactura);

              if (fc?.codcliente && Array.isArray(pagos) && pagos.length) {
                for (const p of pagos) {
                  const importe = Number(Number(p.importe || 0).toFixed(2));
                  if (!(importe > 0)) continue;

                  await createReciboCliente({
                    idfactura,
                    codcliente: fc.codcliente,
                    codpago: p.codpago,
                    importe,
                    fechaPago: today,
                    idempresa: fc.idempresa,
                    codigofactura: fc.codigo || fc.codigofactura || "",
                    coddivisa: fc.coddivisa,
                    fecha: today,
                  });
                }

                await cleanupRecibosFactura(idfactura, pagos);
              }
            } catch (e) {
              console.warn(
                "No se pudieron crear/limpiar recibos offline:",
                e?.message || e
              );
            }

            // 3) Quitar ticket OFFLINE del modal (si lo estabas guardando)
            if (item.localId)
              removeOfflineTicketFromModalByLocalId(item.localId);
          }

          // ✅ marcamos como procesado
          await window.TPV_QUEUE.done(item.id, { resp });
        } else {
          await window.TPV_QUEUE.done(item.id, {});
        }
      } catch (e) {
        await window.TPV_QUEUE.error(item.id, e?.message || String(e));
        break; // evita bucle si FS está caído
      }
    }
  } finally {
    window.__SYNCING__ = false;
    if (typeof refreshQueueBadge === "function") refreshQueueBadge();
  }
}

const PAY_METHODS_CACHE_KEY = "tpv_cachedPayMethods_v1";
const PAY_METHODS_CACHE_TS_KEY = "tpv_cachedPayMethods_ts_v1";

const TICKETS_CACHE_KEY = "tpv_cachedTickets_v1";
const TICKETS_CACHE_TS_KEY = "tpv_cachedTickets_ts_v1";

// ===== OFFLINE tickets visibles en modal =====
const OFFLINE_TICKETS_KEY = "tpv_offlineTickets_v1";

function loadOfflineTicketsForTicketsModal() {
  try {
    const raw = localStorage.getItem(OFFLINE_TICKETS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveOfflineTicketForTicketsModal(t) {
  try {
    const curr = loadOfflineTicketsForTicketsModal();
    curr.unshift(t);
    // limita para no crecer infinito
    localStorage.setItem(
      OFFLINE_TICKETS_KEY,
      JSON.stringify(curr.slice(0, 200))
    );
  } catch (e) {
    console.warn("No se pudo guardar ticket offline:", e);
  }
}

function removeOfflineTicketFromModalByLocalId(localId) {
  try {
    const curr = loadOfflineTicketsForTicketsModal();
    const next = curr.filter(
      (x) => String(x._localId || "") !== String(localId || "")
    );
    localStorage.setItem(OFFLINE_TICKETS_KEY, JSON.stringify(next));
  } catch {}
}

// Construye un ticket imprimible MINIMO cuando no hay respuesta de FS
function buildOfflineTicketPrintData(cartSnapshot, ticketPayload, payResult) {
  const now = new Date();
  const fecha = now.toISOString().slice(0, 10);
  const hora = now.toTimeString().slice(0, 8);

  const safeItems = Array.isArray(cartSnapshot)
    ? cartSnapshot
    : Array.isArray(cartSnapshot?.items)
    ? cartSnapshot.items
    : [];

  const pagos = (payResult?.pagos || []).map((p) => ({
    codpago: p.codpago,
    descripcion: p.descripcion,
    importe: Number(p.importe || 0),
  }));

  return {
    numero: "OFFLINE",
    fecha,
    hora,
    paymentMethod: ticketPayload?.paymentMethod || pagos[0]?.codpago || "—",
    clientName: "Ventas tickets",
    terminalName: currentTerminal ? currentTerminal.name : "",
    agentName: currentAgent ? currentAgent.name : "",
    company: companyInfo ? { ...companyInfo } : null,
    lineas: safeItems.map((it) => ({
      name: it.name || it.descripcion || "Producto",
      qty: Number(it.qty || it.cantidad || 1),
      price: Number(it.price || it.pvpunitario || 0),
      grossPrice: Number(it.grossPrice || it.price || 0),
      codimpuesto: it.codimpuesto || null,
      taxRate: Number(it.taxRate || 0),
    })),
    total: Number(ticketPayload?.total || 0),
    pagos,
    cambio: Number(payResult?.cambio || 0),

    // metadatos útiles
    _offline: true,
    _localId: payResult?.localId || null,
  };
}

function saveTicketsCache(list) {
  try {
    localStorage.setItem(TICKETS_CACHE_KEY, JSON.stringify(list || []));
    localStorage.setItem(TICKETS_CACHE_TS_KEY, String(Date.now()));
  } catch (e) {
    console.warn("No se pudo guardar cache de tickets:", e);
  }
}

function loadTicketsCache() {
  try {
    const raw = localStorage.getItem(TICKETS_CACHE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function savePayMethodsCache(methods) {
  try {
    localStorage.setItem(PAY_METHODS_CACHE_KEY, JSON.stringify(methods || []));
    localStorage.setItem(PAY_METHODS_CACHE_TS_KEY, String(Date.now()));
  } catch (e) {
    console.warn("No se pudo guardar cache de formas de pago:", e);
  }
}

function loadPayMethodsCache() {
  try {
    const raw = localStorage.getItem(PAY_METHODS_CACHE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

const FACTURA_TS_KEY = "tpv_factura_ts_v1";

function loadFacturaTsMap() {
  try {
    return JSON.parse(localStorage.getItem(FACTURA_TS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function saveFacturaLocalTimestamp(idfactura, ts) {
  const map = loadFacturaTsMap();
  map[String(idfactura)] = Number(ts) || Date.now();
  localStorage.setItem(FACTURA_TS_KEY, JSON.stringify(map));
}

function getFacturaLocalTimestamp(idfactura) {
  const map = loadFacturaTsMap();
  return Number(map[String(idfactura)] || 0) || 0;
}

async function renderQueuedTicketsIfAny() {
  if (!ticketsList) return;

  // Si no hay puente de cola, no hacemos nada
  if (!window.TPV_QUEUE?.list) return;

  try {
    const q = await window.TPV_QUEUE.list();
    const pending = Array.isArray(q?.pending) ? q.pending : [];

    // filtra solo creación de factura
    const pendingFacturas = pending.filter(
      (it) => it.type === "CREATE_FACTURACLIENTE"
    );

    // Si no hay pendientes, no mostramos nada
    if (!pendingFacturas.length) return;

    // Creamos un bloque arriba (sin borrar el resto; luego renderTicketsList pondrá los normales)
    const box = document.createElement("div");
    box.className = "parked-ticket-empty";
    box.style.cssText =
      "margin:10px 0; padding:10px; border:1px dashed #f59e0b; background:#fff7ed;";

    box.innerHTML = `
      <div style="font-weight:800; margin-bottom:6px;">Pendientes (sin internet)</div>
      <div style="font-size:13px; opacity:.9;">
        Hay ${pendingFacturas.length} venta(s) en cola. Se sincronizarán al volver internet.
      </div>
    `;

    // lo metemos al inicio del contenedor ticketsList
    ticketsList.innerHTML = "";
    ticketsList.appendChild(box);

    // opcional: listar 5 últimos
    pendingFacturas.slice(0, 5).forEach((it) => {
      const row = document.createElement("div");
      row.className = "ticket-row";
      row.style.opacity = "0.85";
      const d = new Date(it.createdAt);
      const hhmm = d.toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const total = Number(it.payload?.total || 0);
      row.innerHTML = `
        <div class="ticket-left">
          <div class="ticket-num">OFFLINE</div>
          <div class="ticket-mid">
            <span class="ticket-client">Venta en cola</span>
            <span class="ticket-pay">—</span>
            <span class="ticket-id">${hhmm}</span>
          </div>
        </div>
        <div class="ticket-right">
          <div class="ticket-total">${eurES(total)}</div>
        </div>
      `;
      ticketsList.appendChild(row);
    });
  } catch (e) {
    console.warn("No se pudo listar cola:", e?.message || e);
  }
}

function getAllTicketsForUI(serverTickets) {
  const offline = loadOfflineTicketsForTicketsModal(); // tus OFF-...
  const server = Array.isArray(serverTickets) ? serverTickets : [];

  const seen = new Set();
  const out = [];

  const push = (t) => {
    const key = String(
      t.codigo || t.numero || t.idfactura || t._localId || ""
    ).trim();
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    out.push(t);
  };

  offline.forEach(push);
  server.forEach(push);

  return out;
}
