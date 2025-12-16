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

  // Estado actual de la caja (para cálculo interno, no para rellenar inputs)
  currentCashBreakdown: [],

  // Totales de la sesión (los rellenaremos cuando exista lógica de ventas)
  cashSalesTotal: 0, // Ingresos en efectivo
  cashMovementsTotal: 0, // Movimientos de caja (entradas/salidas)
  totalSales: 0, // Total ventas (cualquier forma de pago)
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

// ===== Referencias básicas =====
const searchInput = document.getElementById("searchInput");
const searchClearBtn = document.getElementById("searchClearBtn");
const searchKeyboardBtn = document.getElementById("searchKeyboardBtn");

// Terminal / caja
const terminalNameEl = document.getElementById("terminalName");
const agentNameEl = document.getElementById("agentName");

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
    const cat = categories.find((c) => c.id === p.category);
    const tile = document.createElement("div");
    tile.className = "product-tile";
    tile.style.background = cat ? cat.color : "#555";

    // Precio mostrado al público = precio neto * (1 + IVA)
    const taxRate = getTaxRateForProduct(p);
    const priceGross = (p.price || 0) * (1 + taxRate / 100);

    tile.innerHTML = `
      <div class="product-img-wrapper">
        ${
          p.imageUrl
            ? `<img src="${p.imageUrl}" alt="${p.name}" class="product-img">`
            : ""
        }
      </div>
      <div class="product-name">${p.name}</div>
      ${
        p.secondaryName
          ? `<div class="product-secondary">${p.secondaryName}</div>`
          : ""
      }
      <div class="product-price">${priceGross.toFixed(2)} €</div>
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
      secondaryName: product.secondaryName || "", // ✅ AÑADIR
      price: priceNet,
      taxRate,
      grossPrice: priceGross,
      codimpuesto: product.codimpuesto || null,
      qty: quantity,
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

function renderCart() {
  const container = document.getElementById("cartLines");
  if (!container) return;
  container.innerHTML = "";

  let total = 0;

  cart.forEach((item) => {
    const unitPrice =
      typeof item.grossPrice === "number" ? item.grossPrice : item.price || 0;
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
    <span class="qty-display">${item.qty}</span>
    <button class="qty-btn" data-action="plus" data-id="${item.id}">+</button>
    <button class="qty-btn qty-edit" data-action="edit" data-id="${
      item.id
    }">⌨</button>
  </div>

  <div class="cart-line-total">
    <span>${lineTxt}</span>
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

function openNumPad(initialValue, onConfirm, productName) {
  numPadCurrentValue = initialValue != null ? String(initialValue) : "";
  if (numPadCurrentValue === "" || numPadCurrentValue === "0") {
    numPadCurrentValue = "";
  }
  numPadOnConfirm = onConfirm;

  if (numPadProductName) {
    numPadProductName.textContent = productName ? ` - ${productName}` : "";
  }

  updateNumPadDisplay();
  if (numPadOverlay) {
    numPadOverlay.classList.remove("hidden");
  }
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
  if (numPadCurrentValue.length < 5) {
    numPadCurrentValue += digit;
    updateNumPadDisplay();
  }
}

function numPadBackspace() {
  if (numPadCurrentValue.length > 0) {
    numPadCurrentValue = numPadCurrentValue.slice(0, -1);
    updateNumPadDisplay();
  }
}

function numPadClearAll() {
  numPadCurrentValue = "";
  updateNumPadDisplay();
}

function numPadConfirm() {
  let value = parseInt(numPadCurrentValue, 10);
  if (isNaN(value) || value <= 0) {
    value = 1;
  }
  if (typeof numPadOnConfirm === "function") {
    numPadOnConfirm(value);
  }
  closeNumPad();
}

if (numPadOverlay) {
  numPadOverlay.addEventListener("click", (e) => {
    if (handleOverlayOutsideClick(e, ".num-pad", closeNumPad)) return;

    const btn = e.target.closest("[data-key]");
    if (!btn) return;

    const key = btn.getAttribute("data-key");

    if (key >= "0" && key <= "9") {
      numPadAddDigit(key);
    } else if (key === "back") {
      numPadBackspace();
    } else if (key === "clear") {
      numPadClearAll();
    } else if (key === "cancel") {
      closeNumPad();
    } else if (key === "ok") {
      numPadConfirm();
    }
  });
}

window.addEventListener("keydown", (e) => {
  if (numPadVisible) {
    if (e.key >= "0" && e.key <= "9") {
      e.preventDefault();
      numPadAddDigit(e.key);
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

function openQwertyForInput(inputEl) {
  const emailRow = document.getElementById("qwertyEmailRow");
  if (emailRow) {
    emailRow.classList.toggle("hidden", qwertyMode !== "email");
  }

  qwertyTargetInput = inputEl || null;
  qwertyCurrentValue = inputEl && inputEl.value ? inputEl.value : "";
  updateQwertyDisplay();
  if (qwertyOverlay) qwertyOverlay.classList.remove("hidden");
  qwertyVisible = true;
}

function closeQwerty() {
  const emailRow = document.getElementById("qwertyEmailRow");
  if (emailRow) emailRow.classList.add("hidden");

  if (qwertyOverlay) {
    qwertyOverlay.classList.add("hidden");
  }
  qwertyVisible = false;
  qwertyMode = "text"; // ← importante
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

    const deleteBtn = e.target.closest(".line-delete-btn");
    if (deleteBtn) {
      const id = parseInt(deleteBtn.getAttribute("data-id"), 10);
      updateCartItemQuantity(id, 0);
    }
  });
}

// ===== Estado (texto de estado abajo) =====
function setStatusText(text) {
  const statusBar = document.getElementById("statusBar");
  if (!statusBar) return;
  const strong = statusBar.querySelector("strong");
  if (strong) strong.textContent = text;
}

function updateParkedCountBadge() {
  const badge = document.getElementById("parkedCountBadge");
  if (!badge) return;
  const n = parkedTickets.length;
  badge.textContent = n;
}

function getCartTotal(items) {
  return (items || []).reduce((sum, item) => {
    const unit =
      typeof item.grossPrice === "number" ? item.grossPrice : item.price || 0;
    return sum + unit * (item.qty || 1);
  }, 0);
}

function parkCurrentCart() {
  if (!cart || cart.length === 0) {
    toast("No hay productos para aparcar.", "warn", "Aparcar");
    return;
  }

  parkedCounter += 1;

  const snapshot = cart.map((item) => ({ ...item }));
  const total = getCartTotal(snapshot);

  // Nombre del cliente (o texto del input)
  const clientName = cartClientInput
    ? cartClientInput.value || "Cliente"
    : "Cliente";

  parkedTickets.push({
    id: parkedCounter,
    createdAt: new Date(),
    items: snapshot,
    total,
    clientName, // 👈 nuevo campo
  });

  cart = [];
  renderCart();
  updateParkedCountBadge();

  setStatusText("Ticket aparcado.");
  toast("Ticket aparcado ✅", "ok", "Aparcar");
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

  parkedTickets.forEach((t, index) => {
    const div = document.createElement("div");
    div.className = "parked-ticket-item";
    div.dataset.index = index;

    const fecha = t.createdAt ? new Date(t.createdAt) : new Date(); // por si acaso

    const hora = fecha.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const totalTexto = t.total != null ? t.total.toFixed(2) + " €" : "—";

    const numLineas = (t.items || []).length;

    div.innerHTML = `
  <div class="parked-ticket-main">
    <span>Ticket #${t.id}</span>
    <span>${totalTexto}</span>
  </div>
  <div class="parked-ticket-sub">
    <span>${hora}</span>
    <span>${numLineas} línea${numLineas === 1 ? "" : "s"}</span>
  </div>
  ${
    t.clientName
      ? `<div class="parked-ticket-sub"><span>${t.clientName}</span></div>`
      : ""
  }
`;

    div.onclick = () => {
      restoreParkedCartByIndex(index);
      closeParkedModal();
    };

    parkedTicketsList.appendChild(div);
  });
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

  cart = (ticket.items || []).map((i) => ({ ...i }));
  renderCart();

  parkedTickets.splice(index, 1);
  updateParkedCountBadge();
  setStatusText("Ticket aparcado recuperado.");
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
}

// ---- Apertura / cierre de caja ----
function openCashOpenDialog(mode = "open") {
  if (!cashOpenOverlay) return;
  if (!currentTerminal) {
    toast("Selecciona un terminal primero.", "warn", "Caja");
    return;
  }

  cashDialogMode = mode;

  // Cambiar título y texto del botón según modo
  const titleEl = cashOpenOverlay.querySelector("h2");
  if (titleEl) {
    titleEl.textContent =
      mode === "open" ? "Apertura de caja" : "Cierre de caja";
  }
  if (cashOpenOkBtn) {
    cashOpenOkBtn.textContent = mode === "open" ? "Abrir caja" : "Cerrar caja";
  }

  // Label del resumen principal
  if (cashSummaryMainLabel) {
    cashSummaryMainLabel.textContent =
      mode === "open" ? "Dinero inicial:" : "Conteo de caja:";
  }

  // Mostrar/ocultar resumen extendido
  if (cashCloseSummary) {
    cashCloseSummary.style.display = mode === "close" ? "block" : "none";
  }

  // Poner nombre del terminal
  if (cashOpenTerminalName) {
    cashOpenTerminalName.textContent = currentTerminal.name;
  }

  const inputs = cashOpenOverlay.querySelectorAll(".cash-cell input");

  if (mode === "open") {
    // Apertura: empezamos siempre en 0
    inputs.forEach((inp) => {
      inp.value = "0";
    });
  } else {
    // Cierre: también empezamos en 0 (el trabajador cuenta desde cero)
    inputs.forEach((inp) => {
      inp.value = "0";
    });
  }

  // Recalcular total según valores actuales
  updateCashOpenTotal();

  cashOpenOverlay.classList.remove("hidden");
}

function hideCashOpenDialog() {
  if (!cashOpenOverlay) return;
  cashOpenOverlay.classList.add("hidden");
}

function updateCashOpenTotal() {
  if (!cashOpenOverlay || !cashOpenTotalEl) return;

  let total = 0;
  const inputs = cashOpenOverlay.querySelectorAll(".cash-cell input");
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

function confirmCashOpening() {
  cashSession.open = true;
  cashSession.openedAt = new Date().toISOString();

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

function confirmCashClosing() {
  cashSession.open = false;

  hideCashOpenDialog();
  updateCashButtonLabel();

  // Dejar TPV y agente "des-seleccionados"
  currentTerminal = null;
  currentAgent = null;
  if (terminalNameEl) terminalNameEl.textContent = "---";
  if (agentNameEl) agentNameEl.textContent = "---";

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

// ===== Formas de pago (FacturaScripts) =====
async function fetchFormasPagoActivas() {
  const data = await fetchApiResource("formapagos");
  const list = Array.isArray(data) ? data : [];
  return list.filter((p) => p && p.activa !== false);
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
  const inputs = cashOpenOverlay.querySelectorAll(".cash-cell input");
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
  cashOpenOkBtn.onclick = () => {
    if (cashDialogMode === "open") {
      confirmCashOpening();
    } else {
      confirmCashClosing();
    }
  };
}

// Botón abrir/cerrar caja (header "Caja")
if (cashHeaderBtn) {
  cashHeaderBtn.onclick = async () => {
    // ✅ Si está BLOQUEADO u OFFLINE, siempre permitir reintentar sin reiniciar
    if (TPV_STATE.locked || TPV_STATE.offline) {
      await forceReconnectFlow(); // abre modal email y revalida clients.json
      return;
    }

    // Comportamiento normal
    if (cashSession.open) {
      openCashOpenDialog("close");
      return;
    }

    await refreshTerminalsAndAgents();

    if (terminals.length === 0) {
      if (!currentTerminal)
        setCurrentTerminal({ id: "demo", name: "TPV demo" });
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
    ] = await Promise.all([
      fetchApiResource("familias"),
      fetchApiResource("productos"),
      fetchApiResource("tpvterminales"),
      fetchApiResource("variantes"),
      fetchApiResource("empresas"),
    ]);

    companyInfo =
      Array.isArray(empresasData) && empresasData[0] ? empresasData[0] : null;
    await loadCompanyLogoUrl();

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
    const descripcionBase = item.name || "";
    const descripcion = descripcionBase.trim() || "Producto TPV";

    const linea = {
      descripcion,
      cantidad: item.qty || 1,
      // Precio NETO sin IVA (lo que nos da Recipok)
      pvpunitario: item.price || 0,
    };

    // Código de impuesto para que FacturaScripts aplique el IVA correcto
    if (item.codimpuesto) {
      linea.codimpuesto = item.codimpuesto;
    }

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
    const unit =
      typeof item.grossPrice === "number" ? item.grossPrice : item.price || 0;
    return sum + unit * (item.qty || 1);
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
    const cartSnapshot = cart.map((item) => ({ ...item }));
    const totalCart = getCartTotal(cartSnapshot);

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
      ticketPayload.pagada = 1;
      ticketPayload.codpago = primary ? primary.codpago : null;
      ticketPayload.pagos = pagos; // si el endpoint lo admite, perfecto
    }

    const apiResponse = await createTicketInFacturaScripts(ticketPayload);

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

    cashSession.cashSalesTotal = (cashSession.cashSalesTotal || 0) + efectivo;
    cashSession.totalSales = (cashSession.totalSales || 0) + totalVenta;

    // 6) Vaciar carrito
    cart = [];
    renderCart();

    setStatusText("Venta cobrada");

    toast(
      lastTicket.numero
        ? `Venta cobrada ✅ (${ticketPayload.paymentMethod} - ${lastTicket.numero})`
        : `Venta cobrada ✅ (${ticketPayload.paymentMethod})`,
      "ok",
      "Cobrar"
    );
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
      alert("No hay ningún ticket para imprimir.");
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
const payOpenDrawerBtn = document.getElementById("payOpenDrawerBtn");

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
    v = a + "." + (b || "").slice(0, 2);
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
    throw new Error("No hay formas de pago activas en FacturaScripts.");
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

    // botón abrir cajón (de momento placeholder)
    if (payOpenDrawerBtn) {
      payOpenDrawerBtn.onclick = () => {
        toast(
          "Abrir cajón: lo implementamos al conectar ESC/POS o driver.",
          "info",
          "Cajón"
        );
      };
    }
  });
}

// Botón aparcar ticket
const parkBtn = document.getElementById("parkBtn");
if (parkBtn) {
  parkBtn.onclick = () => {
    parkCurrentCart();
  };
}

// Botón ver/recuperar aparcados
const parkedListBtn = document.getElementById("parkedListBtn");
if (parkedListBtn) {
  parkedListBtn.onclick = () => {
    openParkedModal();
  };
}

// Botón "Tickets" (histórico) aún sin funcionalidad
const ticketsListBtn = document.getElementById("ticketsListBtn");
if (ticketsListBtn) {
  ticketsListBtn.onclick = () => {
    alert(
      "El listado de tickets se implementará más adelante, a partir de FacturaScripts."
    );
  };
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
  if (!emailInput || !emailOkBtn) return;

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
    // Aquí decides: ¿permitir usar lo guardado o forzar email?
    // Yo recomiendo permitir lo guardado SOLO si pasa validate ping.
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
        return null;
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
        return null; // ✅ no romper el arranque
      }

      const resolved = await resolveCompanyByEmail(email); // usa clients.json (vuelve a cargarlo, es ok pero luego optimizamos)
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
      if (!resolved) return;
      if (resolved.blocked) throw new Error("Cuenta desactivada");
      saveResolvedCompany(resolved);
      applyResolved(resolved);
      await validateBaseUrlOrThrow(resolved.baseUrl, resolved.apiKey);
      return;
    }

    if (client.active === false) {
      TPV_STATE.locked = true;
      TPV_STATE.offline = false;
      updateCashButtonLabel();
      showMessageModal(
        "Acceso bloqueado",
        "Tu cuenta de TPV está desactivada. Contacta con soporte."
      );
      return null; // ✅ no romper el arranque
    }

    // Existe y está activa: resolvemos desde email (que construye baseUrl/apiKey)
    try {
      const resolved = await resolveCompanyByEmail(savedEmail);
      saveResolvedCompany(resolved);
      applyResolved(resolved);
      await validateBaseUrlOrThrow(resolved.baseUrl, resolved.apiKey);
      return;
    } catch (e) {
      console.warn("Email activo pero fallo al validar. Pidiendo email...", e);
      const resolved2 = await askAndResolve();
      if (!resolved2) return;
      if (resolved2.blocked) throw new Error("Cuenta desactivada");
      saveResolvedCompany(resolved2);
      applyResolved(resolved2);
      await validateBaseUrlOrThrow(resolved2.baseUrl, resolved2.apiKey);
      return;
    }
  }

  // 2) Si no hay email guardado: pedirlo
  const resolved = await askAndResolve();
  if (!resolved) return;
  if (resolved.blocked) throw new Error("Cuenta desactivada");

  saveResolvedCompany(resolved);
  applyResolved(resolved);
  await validateBaseUrlOrThrow(resolved.baseUrl, resolved.apiKey);
}

async function fetchFacturaClienteById(idfactura) {
  const cfg = window.RECIPOK_API || {};
  if (!cfg.baseUrl || !cfg.apiKey) throw new Error("Config API no definida");

  const base = cfg.baseUrl.replace(/\/+$/, "");
  const url = `${base}/facturaclientes?limit=50&order=desc`;

  const res = await fetch(url, {
    headers: { Accept: "application/json", Token: cfg.apiKey },
    cache: "no-store",
  });

  if (!res.ok)
    throw new Error(`No se pudo cargar facturaclientes: HTTP ${res.status}`);

  const data = await res.json().catch(() => []);
  if (!Array.isArray(data)) return null;

  return data.find((f) => Number(f.idfactura) === Number(idfactura)) || null;
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

function askEmailWithModal() {
  return new Promise((resolve) => {
    if (!emailOverlay || !emailInput || !emailOkBtn || !emailCancelBtn) {
      // fallback por si no existe el modal (en Electron a veces prompt no sirve, pero mejor que nada)
      const e = window.prompt(
        "Introduce el email de tu empresa para activar el TPV:"
      );
      resolve(e || "");
      return;
    }

    if (emailError) emailError.textContent = "";
    emailInput.value = "";
    emailOverlay.classList.remove("hidden");
    emailInput.focus();

    emailOkBtn.disabled = true;
    emailInput.addEventListener("input", updateEmailModalValidation);
    updateEmailModalValidation();

    if (emailKeyboardBtn) {
      emailKeyboardBtn.onclick = () => {
        qwertyMode = "email";
        openQwertyForInput(emailInput);
      };
    }

    const cleanup = () => {
      emailOkBtn.onclick = null;
      emailCancelBtn.onclick = null;
      emailInput.onkeydown = null;
      emailInput.removeEventListener("input", updateEmailModalValidation);
    };

    emailCancelBtn.onclick = () => {
      cleanup();
      emailOverlay.classList.add("hidden");
      resolve("");
    };

    emailOkBtn.onclick = () => {
      const val = (emailInput.value || "").trim();
      if (!isValidEmailFormat(val)) {
        updateEmailModalValidation();
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
window.addEventListener("DOMContentLoaded", () => {
  renderCart();
  updateCashButtonLabel();
  updateParkedCountBadge();

  bootstrapCompany().then(loadDataFromApi);
});

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
