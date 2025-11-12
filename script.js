// --------- REQUIRED: set these two before deploying ----------
const WORKER_URL = "https://green-wonderland-api.stainwho.workers.dev"; // <-- your Worker base URL (no trailing slash)
const firebaseConfig = {
  apiKey: "AIzaSyCaHTCkK7A9GVO23geBmnenZ5n6w0GIrkA",
  authDomain: "green-wonderland.firebaseapp.com",
  projectId: "green-wonderland",
  storageBucket: "green-wonderland.firebasestorage.app",
  messagingSenderId: "474148961917",
  appId: "1:474148961917:web:8066003abb9f73fd8bbb14"
};
// --------------------------------------------------------------

// Firebase SDK (CDN, no build step)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getFirestore, collection, getDocs, addDoc, serverTimestamp,
  query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// Init
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Helpers
const $ = (id) => document.getElementById(id);
const money = (n) => { try { return "$" + Number(n).toLocaleString(); } catch { return "$" + n; } };
const escapeHtml = (s) => (s || "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;'}[c]));
const setStatus = (msg, isErr = false) => { const el=$("status"); if (!el) return; el.textContent = msg; el.style.color = isErr ? "var(--warn)" : "var(--muted)"; };
// History helpers
const setHistStatus = (msg)=> { const el=$("histStatus"); if (el) el.textContent = msg || ""; };
const setHistSummary = (msg)=> { const el=$("histSummary"); if (el) el.textContent = msg || ""; };

// Format like "DD-MM-YYYY | h:mm AM" in Dhaka (client-side view)
function formatDhakaLocal(dateLike) {
  const tz = "Asia/Dhaka";
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const dGB = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric"
  }).format(d); // "DD/MM/YYYY"
  const [dd, mm, yyyy] = dGB.split("/");
  const datePart = `${dd}-${mm}-${yyyy}`;
  const timePart = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true
  }).format(d);
  return `${datePart} | ${timePart}`;
}

// App state
const state = {
  items: [],         // catalog from Firestore
  cart: {},          // { id: { id,name,unitPrice,qty } }
  discountPct: 0,
  user: null,
  displayName: null,
  saving: false
};

// ---- Clear everything (cart, discount, search, filter, status) ----
const btnClear = $("btnClear");
if (btnClear) {
  btnClear.onclick = () => { clearAllUI(); };
}
function clearAllUI() {
  state.cart = {};
  state.discountPct = 0;
  const disc = $("discount"); if (disc) disc.value = 0;
  const search = $("search"); if (search) search.value = "";
  const filter = $("filterCat"); if (filter) filter.value = "";
  renderCart();
  renderCatalog();
  setStatus("");
}

// ---- Header navigation (hash routing) ----
const btnHistory = $("btnHistory");
if (btnHistory) {
  btnHistory.onclick = () => { location.hash = "#history"; };
}
const btnBackBilling = $("btnBackBilling");
if (btnBackBilling) {
  btnBackBilling.onclick = () => { location.hash = "#billing"; };
}

// -------- AUTH ----------
$("btnLogin")?.addEventListener("click", async () => {
  setStatus("");
  const email = $("email")?.value?.trim();
  const password = $("password")?.value;
  if (!email || !password) return setStatus("Enter email & password.", true);
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    state.user = cred.user;
    if (!state.user.displayName) {
      const rp = prompt("Enter your RP seller name (shown on Discord):", "");
      if (rp && rp.length >= 2) await updateProfile(state.user, { displayName: rp });
    }
    setStatus("Signed in.");
  } catch (e) {
    setStatus("Sign-in failed: " + (e?.message || e), true);
  }
});

$("btnLogout")?.addEventListener("click", async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, async (user) => {
  state.user = user || null;
  if ($("btnLogout")) $("btnLogout").disabled = !user;
  if ($("btnLogin")) $("btnLogin").disabled = !!user;
  if ($("email")) $("email").disabled = !!user;
  if ($("password")) $("password").disabled = !!user;

  const tag = $("sellerNameTag");
  if (user) {
    if ($("authState")) $("authState").textContent = `Signed in: ${user.email}`;
    state.displayName = user.displayName || "(no name)";
    tag?.classList.remove("hidden");
    if (tag) tag.textContent = state.displayName;

    await loadCatalogOnce();
    // If user is already on #history, load it; otherwise skip until they navigate
    if ((location.hash || "").toLowerCase() === "#history") {
      await loadHistory();
    }
  } else {
    if ($("authState")) $("authState").textContent = "Not signed in";
    state.displayName = null;
    tag?.classList.add("hidden");

    // clear UI when signed out & force back to billing view
    clearAllUI();
    const listHist = $("history");
    if (listHist) listHist.innerHTML = `<div class="muted">Sign in to view.</div>`;
    setHistSummary("");
    setHistStatus("");
    location.hash = "#billing";
  }
});

// -------- CATALOG ----------
let catalogLoaded = false;
async function loadCatalogOnce() {
  if (catalogLoaded) return;
  try {
    const snap = await getDocs(collection(db, "items"));
    state.items = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(x => x.isActive)
      .sort((a,b)=> (a.category||"").localeCompare(b.category||"") || (a.name||"").localeCompare(b.name||""));
    catalogLoaded = true;
    renderFilters();
    renderCatalog();
    renderBundles(); // QoL: quick bundles
  } catch (e) {
    setStatus("Failed to load catalog: " + (e?.message || e), true);
  }
}

function renderFilters() {
  const cats = Array.from(new Set(state.items.map(i => i.category))).sort();
  const sel = $("filterCat");
  if (!sel) return;
  sel.innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  sel.onchange = renderCatalog;
  const search = $("search");
  if (search) search.oninput = renderCatalog;
}

function renderCatalog() {
  const searchEl = $("search");
  const q = (searchEl?.value || "").toLowerCase().trim();
  const cat = $("filterCat")?.value || "";
  const list = $("catalog");
  if (!list) return;

  list.innerHTML = "";

  // QoL: pin popular items (quick-add row)
  const quick = pickQuickItems(["geek-bar-basic","geek-bar-flavour","penjamin","joint-wild-haze-1x"]);
  if (quick.length) {
    const bar = document.createElement("div");
    bar.className = "row";
    bar.style.margin = "0 0 8px 0";
    bar.innerHTML = `<span class="muted">Quick add:</span>` + quick.map(it => {
      return `<button class="ghost" data-quick="${it.id}">+ ${escapeHtml(it.name)} (${money(it.unitPrice)})</button>`;
    }).join(" ");
    list.appendChild(bar);
    bar.querySelectorAll("[data-quick]").forEach(b => b.onclick = () => addToCart(b.dataset.quick));
  }

  const filtered = state.items.filter(it => {
    const byCat = !cat || it.category === cat;
    const hay = (it.name + " " + (it.aliases || []).join(" ")).toLowerCase();
    const bySearch = !q || hay.includes(q);
    return byCat && bySearch;
  });

  if (!filtered.length) {
    list.innerHTML += `<div class="muted">No items match.</div>`;
    return;
  }

  filtered.forEach(it => {
    const row = document.createElement("div");
    row.className = "grid";
    row.innerHTML = `
      <div>${escapeHtml(it.name)} <span class="muted">(${escapeHtml(it.category||"")})</span></div>
      <div class="right">${money(it.unitPrice||0)}</div>
      <div class="right">
        <button data-id="${it.id}" class="addBtn">+</button>
      </div>
    `;
    list.appendChild(row);
  });
  list.querySelectorAll(".addBtn").forEach(btn => btn.onclick = () => addToCart(btn.dataset.id));
}

function pickQuickItems(ids) {
  const found = [];
  ids.forEach(id => {
    const it = state.items.find(x => x.id === id);
    if (it) found.push(it);
  });
  return found;
}

// -------- BUNDLES (QoL) --------
const BUNDLES = [
  { name: "Starter Pack", items: [
      { id: "geek-bar-basic", qty: 1 },
      { id: "joint-wild-haze-1x", qty: 1 },
      { id: "penjamin", qty: 1 }
  ]},
  { name: "Party Combo", items: [
      { id: "geek-bar-flavour", qty: 2 },
      { id: "joint-og-kush-1x", qty: 2 },
      { id: "brownie-1x", qty: 2 }
  ]}
];

function renderBundles() {
  const list = $("catalog");
  if (!list || !BUNDLES.length) return;
  const wrap = document.createElement("div");
  wrap.className = "row";
  wrap.style.margin = "8px 0 10px 0";
  wrap.innerHTML = `<span class="muted">Bundles:</span> ` + BUNDLES.map(b => `<button class="ghost bundleBtn" data-b="${escapeHtml(b.name)}">${escapeHtml(b.name)}</button>`).join(" ");
  list.prepend(wrap);
  list.querySelectorAll(".bundleBtn").forEach(btn => {
    btn.onclick = () => {
      const b = BUNDLES.find(x => x.name === btn.dataset.b);
      if (!b) return;
      b.items.forEach(x => { for (let i=0;i<x.qty;i++) addToCart(x.id); });
    };
  });
}

// -------- CART ----------
function addToCart(id) {
  const it = state.items.find(x => x.id === id);
  if (!it) return;
  const existing = state.cart[id] || { id, name: it.name, unitPrice: it.unitPrice, qty: 0 };
  existing.qty += 1;
  state.cart[id] = existing;
  renderCart();
}

function renderCart() {
  const c = $("cart");
  if (!c) return;
  const entries = Object.values(state.cart);
  if (!entries.length) { c.innerHTML = `<div class="muted">Cart is empty.</div>`; calcTotals(); return; }
  c.innerHTML = "";
  entries.forEach(line => {
    const row = document.createElement("div");
    row.className = "grid";
    row.innerHTML = `
      <div>${escapeHtml(line.name)}</div>
      <div class="qty">
        <button class="ghost" data-id="${line.id}" data-op="-">−</button>
        <input data-id="${line.id}" class="qtyInput" type="number" min="0" step="1" value="${line.qty}">
        <button class="ghost" data-id="${line.id}" data-op="+">+</button>
      </div>
      <div class="right">${money(line.unitPrice * line.qty)}</div>
    `;
    c.appendChild(row);
  });
  c.querySelectorAll("button.ghost").forEach(b => {
    b.onclick = () => {
      const id = b.dataset.id, op = b.dataset.op;
      const ln = state.cart[id]; if (!ln) return;
      ln.qty = Math.max(0, ln.qty + (op === "+" ? 1 : -1));
      if (ln.qty === 0) delete state.cart[id];
      renderCart();
    };
  });
  c.querySelectorAll(".qtyInput").forEach(inp => {
    inp.onchange = () => {
      const id = inp.dataset.id;
      const ln = state.cart[id]; if (!ln) return;
      ln.qty = Math.max(0, parseInt(inp.value || "0", 10));
      if (ln.qty === 0) delete state.cart[id];
      renderCart();
    };
  });
  calcTotals();
}

// Discount presets (QoL)
const discountInput = $("discount");
if (discountInput) {
  discountInput.oninput = () => {
    state.discountPct = clamp(Number(discountInput.value || 0), 0, 90);
    calcTotals();
  };
  (function mountDiscountPresets(){
    const parent = discountInput.parentElement;
    if (!parent) return;
    const mk = (v)=> {
      const b = document.createElement("button");
      b.className = "ghost";
      b.style.padding = "6px 10px";
      b.textContent = v+"%";
      b.onclick = () => { discountInput.value = v; state.discountPct = v; calcTotals(); };
      return b;
    };
    [0,5,10,15].forEach(v => parent.appendChild(mk(v)));
  })();
}

function calcTotals() {
  const entries = Object.values(state.cart);
  const subtotal = entries.reduce((s, x) => s + x.unitPrice * x.qty, 0);
  const discountAmt = Math.round(subtotal * (state.discountPct / 100));
  const total = Math.max(0, subtotal - discountAmt);
  $("subtotal") && ( $("subtotal").textContent = money(subtotal) );
  $("discountAmt") && ( $("discountAmt").textContent = money(discountAmt) );
  $("total") && ( $("total").textContent = money(total) );
  return { subtotal, discountAmt, total };
}

function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }

// -------- SAVE & SEND ----------
$("btnSave")?.addEventListener("click", async () => {
  if (state.saving) return;
  setStatus("");
  if (!state.user) return setStatus("Please sign in first.", true);
  const entries = Object.values(state.cart);
  if (!entries.length) return setStatus("Cart is empty.", true);

  const { subtotal, total } = calcTotals();
  const discountPct = state.discountPct;
  const lineItems = entries.map(e => ({
    itemId: e.id,
    nameSnap: e.name,
    unitPriceSnap: e.unitPrice,
    qty: e.qty
  }));

  try {
    state.saving = true;
    $("btnSave").disabled = true;

    const idToken = await state.user.getIdToken();
    const res = await fetch(`${WORKER_URL}/sale`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${idToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sellerUid: state.user.uid,
        sellerName: state.displayName || state.user.email,
        subtotal,
        discount: discountPct,
        total,
        tsISO: new Date().toISOString(),
        lineItems
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data?.error ? `${data.error}: ${data?.details || ""}` : `HTTP ${res.status}`);
    }

    setStatus("✅ Saved & posted to Discord.");

    // Log the sale to Firestore for history (non-fatal if it fails)
    try {
      await addDoc(collection(db, "sales"), {
        sellerUid: state.user.uid,
        sellerName: state.displayName || state.user.email,
        subtotal,
        discount: discountPct,
        total,
        ts: serverTimestamp(),
        lineItems
      });
    } catch (e) {
      console.warn("Failed to log sale:", e);
      setStatus("✅ Posted to Discord. (Note: failed to log history, will retry next time)");
    }

    // finally clear everything
    clearAllUI();
  } catch (e) {
    setStatus("❌ Failed to save: " + (e?.message || e), true);
  } finally {
    state.saving = false;
    if ($("btnSave")) $("btnSave").disabled = false;
  }
});

// -------- HISTORY (loader + renderer) --------
async function loadHistory() {
  setHistStatus("Loading…");
  setHistSummary("");
  const list = $("history");
  if (!state.user) {
    if (list) list.innerHTML = `<div class="muted">Sign in to view.</div>`;
    setHistStatus("");
    return;
  }

  const hrs = Number(($("histRange")?.value) || 24);
  const start = new Date(Date.now() - hrs * 60 * 60 * 1000);

  try {
    const qy = query(
      collection(db, "sales"),
      where("sellerUid", "==", state.user.uid),
      where("ts", ">=", start),
      orderBy("ts", "desc"),
      limit(100)
    );

    const snap = await getDocs(qy);
    const rows = [];
    let totalSum = 0;

    snap.forEach(docSnap => {
      const d = docSnap.data();
      const when = d.ts?.toDate ? d.ts.toDate() : new Date();
      totalSum += Number(d.total || 0);
      rows.push({
        id: docSnap.id,
        when,
        total: Number(d.total || 0),
        subtotal: Number(d.subtotal || 0),
        discount: Number(d.discount || 0),
        seller: d.sellerName || "(unknown)",
        lineItems: Array.isArray(d.lineItems) ? d.lineItems : []
      });
    });

    renderHistory(rows, totalSum, hrs);
    setHistStatus("");
  } catch (e) {
    console.error(e);
    setHistStatus("Failed to load history.");
  }
}

function renderHistory(rows, totalSum, hrs) {
  const list = $("history");
  if (!list) return;
  if (!rows.length) {
    list.innerHTML = `<div class="muted">No sales found in the last ${hrs} hours.</div>`;
    setHistSummary(`0 sales | Total $0`);
    return;
  }

  setHistSummary(`${rows.length} sale${rows.length>1?'s':''} | Total ${money(totalSum)}`);

  list.innerHTML = "";
  rows.forEach(r => {
    const li = document.createElement("div");
    li.className = "history-row";
    const itemsText = r.lineItems.map(li => `${li.nameSnap || li.itemId} ×${li.qty}`).join(", ");
    li.innerHTML = `
      <div class="history-left">
        <div class="history-title">${escapeHtml(r.seller)} — ${escapeHtml(itemsText)}</div>
        <div class="history-meta">${formatDhakaLocal(r.when)}</div>
      </div>
      <div class="right history-total">${money(r.total)}</div>
    `;
    list.appendChild(li);
  });
}

// History UI events (bind once)
const histRangeSel = $("histRange");
const btnHistRefresh = $("btnHistRefresh");
if (histRangeSel) histRangeSel.onchange = () => loadHistory();
if (btnHistRefresh) btnHistRefresh.onclick = () => loadHistory();

// -------- Router (hash) --------
function showView(name) {
  const billing = $("viewBilling");
  const history = $("viewHistory");
  if (!billing || !history) return;

  if (name === "history") {
    billing.classList.add("hidden");
    history.classList.remove("hidden");
    if (state.user) {
      loadHistory();
    } else {
      const listHist = $("history");
      if (listHist) listHist.innerHTML = `<div class="muted">Sign in to view.</div>`;
      setHistSummary("");
      setHistStatus("");
    }
  } else {
    history.classList.add("hidden");
    billing.classList.remove("hidden");
  }
}

function handleHashChange() {
  const h = (location.hash || "").toLowerCase();
  if (h === "#history") return showView("history");
  return showView("billing");
}

window.addEventListener("hashchange", handleHashChange);
if (!location.hash) {
  location.hash = "#billing";
} else {
  handleHashChange();
}

// ---- Keyboard QoL: Enter triggers Save when logged in ----
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && state.user) {
    const active = document.activeElement;
    const isTyping = active && (active.tagName === "INPUT" || active.tagName === "SELECT");
    if (!isTyping) $("btnSave")?.click();
  }
});
