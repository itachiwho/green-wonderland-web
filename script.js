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
  getFirestore, collection, getDocs, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// Init
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Helpers
const $ = (id) => document.getElementById(id);
const money = (n) => { try { return "$" + Number(n).toLocaleString(); } catch { return "$" + n; } };
const escapeHtml = (s) => (s || "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;'}[c]));
const setStatus = (msg, isErr = false) => { const el=$("status"); el.textContent = msg; el.style.color = isErr ? "var(--warn)" : "var(--muted)"; };

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
document.getElementById("btnClear").onclick = () => { 
  clearAllUI(); 
};

function clearAllUI() {
  // clear cart
  state.cart = {};
  // reset discount
  state.discountPct = 0;
  const disc = document.getElementById("discount");
  if (disc) disc.value = 0;
  // reset search & filter
  const search = document.getElementById("search");
  const filter = document.getElementById("filterCat");
  if (search) search.value = "";
  if (filter) filter.value = "";
  // re-render
  renderCart();
  renderCatalog();
  // clear status text
  setStatus("");
}

// -------- AUTH ----------
$("btnLogin").onclick = async () => {
  setStatus("");
  const email = $("email").value.trim();
  const password = $("password").value;
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
};

$("btnLogout").onclick = async () => { 
  await signOut(auth); 
};

onAuthStateChanged(auth, async (user) => {
  state.user = user || null;
  $("btnLogout").disabled = !user;
  $("btnLogin").disabled = !!user;
  $("email").disabled = !!user;
  $("password").disabled = !!user;
  const tag = $("sellerNameTag");
  if (user) {
    $("authState").textContent = `Signed in: ${user.email}`;
    state.displayName = user.displayName || "(no name)";
    tag.classList.remove("hidden");
    tag.textContent = state.displayName;
    await loadCatalogOnce();
  } else {
    $("authState").textContent = "Not signed in";
    state.displayName = null;
    tag.classList.add("hidden");
    // clear UI when signed out
    clearAllUI();
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
  sel.innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  sel.onchange = renderCatalog;
  $("search").oninput = renderCatalog;
}

function renderCatalog() {
  const q = ($("search").value || "").toLowerCase().trim();
  const cat = $("filterCat").value;
  const list = $("catalog");
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
// Define handy presets your staff can add in one click
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
  if (!BUNDLES.length) return;
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
  // plus/minus
  c.querySelectorAll("button.ghost").forEach(b => {
    b.onclick = () => {
      const id = b.dataset.id, op = b.dataset.op;
      const ln = state.cart[id]; if (!ln) return;
      ln.qty = Math.max(0, ln.qty + (op === "+" ? 1 : -1));
      if (ln.qty === 0) delete state.cart[id];
      renderCart();
    };
  });
  // direct input
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
discountInput.oninput = () => {
  state.discountPct = clamp(Number(discountInput.value || 0), 0, 90);
  calcTotals();
};
// Handy shortcuts: 0/5/10/15%
(function mountDiscountPresets(){
  const parent = discountInput.parentElement;
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

function calcTotals() {
  const entries = Object.values(state.cart);
  const subtotal = entries.reduce((s, x) => s + x.unitPrice * x.qty, 0);
  const discountAmt = Math.round(subtotal * (state.discountPct / 100));
  const total = Math.max(0, subtotal - discountAmt);
  $("subtotal").textContent = money(subtotal);
  $("discountAmt").textContent = money(discountAmt);
  $("total").textContent = money(total);
  return { subtotal, discountAmt, total };
}

function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }

// -------- SAVE & SEND ----------
$("btnSave").onclick = async () => {
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

// 🔹 NEW: Save the sale record to Firestore (for history)
try {
  await addDoc(collection(db, "sales"), {
    sellerUid: state.user.uid,
    sellerName: state.displayName || state.user.email,
    subtotal,
    discount: discountPct,
    total,
    ts: serverTimestamp(),       // server-side timestamp (accurate)
    lineItems                    // full list of sold items
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
    $("btnSave").disabled = false;
  }
};

// ---- Keyboard QoL: Enter triggers Save when logged in ----
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && state.user) {
    const active = document.activeElement;
    const isTyping = active && (active.tagName === "INPUT" || active.tagName === "SELECT");
    if (!isTyping) $("btnSave").click();
  }
});
