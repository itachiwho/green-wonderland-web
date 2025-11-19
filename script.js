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
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getFirestore, collection, getDocs, addDoc, serverTimestamp,
  query, where, orderBy, limit, getDoc, doc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// Init
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Helpers
const $ = (id) => document.getElementById(id);
const money = (n) => { try { return "$" + Number(n).toLocaleString(); } catch { return "$" + n; } };
const escapeHtml = (s) =>
  (s || "").replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;'
  }[c]));
const setStatus = (msg, isErr = false) => {
  const el = $("status");
  if (!el) return;
  el.textContent = msg;
  el.style.color = isErr ? "var(--warn)" : "var(--muted)";
};
// History helpers
const setHistStatus = (msg)=> {
  const el = $("histStatus");
  if (el) el.textContent = msg || "";
};
const setHistSummary = (msg)=> {
  const el = $("histSummary");
  if (el) el.textContent = msg || "";
};

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
  saving: false,
  isAdmin: false,
  sellers: []        // [{uid, name}]
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

// ---- Simple view helper for login-shell split ----
function updateShellVisibility(isLoggedIn) {
  const viewLogin = $("viewLogin");   // new login page container
  const appShell  = $("appShell");    // wrapper for header + main (you'll add in index.html)

  if (!viewLogin || !appShell) {
    // If these don't exist yet, do nothing (backwards compatible)
    return;
  }

  if (isLoggedIn) {
    viewLogin.classList.add("hidden");
    appShell.classList.remove("hidden");
  } else {
    appShell.classList.add("hidden");
    viewLogin.classList.remove("hidden");
  }
}

// ---- Header navigation (hash routing) ----
$("btnHistory")?.addEventListener("click", () => { location.hash = "#history"; });
$("btnBackBilling")?.addEventListener("click", () => { location.hash = "#billing"; });

// -------- AUTH ----------

// Shared login function (used by both header login & new login form)
async function handleLogin(email, password) {
  setStatus("");
  if (!email || !password) {
    setStatus("Enter email & password.", true);
    return;
  }
  try {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    state.user = cred.user;
    setStatus("Signed in.");
  } catch (e) {
    console.error(e);
    setStatus("Sign-in failed: " + (e?.message || e), true);
  }
}

// Old header login (if those elements exist)
$("btnLogin")?.addEventListener("click", async () => {
  const email = $("email")?.value;
  const password = $("password")?.value;
  await handleLogin(email, password);
});

// New login form (animated box) — uses #loginEmail, #loginPassword, #btnLoginMain
$("btnLoginMain")?.addEventListener("click", async (e) => {
  e.preventDefault();
  const email = $("loginEmail")?.value;
  const password = $("loginPassword")?.value;
  await handleLogin(email, password);
});

// Also allow Enter key inside login form
["loginEmail", "loginPassword"].forEach(id => {
  const el = $(id);
  if (el) {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        $("btnLoginMain")?.click();
      }
    });
  }
});

$("btnLogout")?.addEventListener("click", async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, async (user) => {
  state.user = user || null;

  const tag = $("sellerNameTag");
  const logoutBtn = $("btnLogout");

  if (user) {
    // ---- NEW LOGIN PAGE MODE ----
    updateShellVisibility(true);
  } else {
    updateShellVisibility(false);
    // ... rest of your logged-out logic ...
  }

    // 🔚 Auth has resolved, show the correct screen
  document.body.classList.remove("auth-pending");
  });
    // If old header login exists, hide the auth inputs/pill
    ["authState", "email", "password", "btnLogin"].forEach(id => {
      const el = $(id);
      if (el) {
        el.classList.add("hidden");
        if (id === "email" || id === "password") el.disabled = true;
      }
    });

    if (logoutBtn) {
      logoutBtn.disabled = false;
      logoutBtn.classList.remove("hidden");
    }

    await loadCatalogOnce();
    await initAdminAndSellers(); // this sets state.displayName and sellerNameTag

    // If user is already on #history, load it; otherwise skip until they navigate
    if ((location.hash || "").toLowerCase() === "#history") {
      await loadHistory();
    }
  } else {
    // Signed out
    updateShellVisibility(false);

    // Show header login again if those elements exist
    ["authState", "email", "password", "btnLogin"].forEach(id => {
      const el = $(id);
      if (el) {
        el.classList.remove("hidden");
        if (id === "email" || id === "password") {
          el.disabled = false;
          el.value = "";
        }
      }
    });

    if ($("authState")) $("authState").textContent = "Not signed in";

    if (logoutBtn) {
      logoutBtn.disabled = true;
    }

    state.displayName = null;
    tag?.classList.add("hidden");

    // clear UI when signed out & force back to billing view
    clearAllUI();
    const listHist = $("history");
    if (listHist) listHist.innerHTML = `<div class="muted">Sign in to view.</div>`;
    setHistSummary("");
    setHistStatus("");
    const sellerSel = $("histSeller");
    if (sellerSel) { sellerSel.classList.add("hidden"); sellerSel.value = "me"; }
    state.isAdmin = false;
    state.sellers = [];
    location.hash = "#billing";
  }
});

// -------- ADMIN DETECTION + SELLER LIST ----------
async function initAdminAndSellers() {
  state.isAdmin = false;
  const sellerSel = $("histSeller");
  if (sellerSel) {
    sellerSel.classList.add("hidden");
    sellerSel.innerHTML =
      `<option value="me" selected>My sales</option><option value="all">All sellers (admin)</option>`;
  }

  if (!state.user) return;

  try {
    // Check my doc in /users/{uid}
    const meDoc = await getDoc(doc(db, "users", state.user.uid));
    const meData = meDoc.exists() ? meDoc.data() : {};
    const role = meData.role || null;
    state.isAdmin = (role === "admin");

    // displayName priority: Firestore > Auth > email > "(no name)"
    const nameFromFirestore = meData.displayName;
    const nameFromAuth = state.user.displayName;
    const fallback = state.user.email;
    state.displayName = nameFromFirestore || nameFromAuth || fallback || "(no name)";

    // Update the seller name tag in the Cart header
    const tag = $("sellerNameTag");
    if (tag) {
      tag.classList.remove("hidden");
      tag.textContent = state.displayName;
    }

    if (!state.isAdmin) return; // nothing else to do for non-admins

    // Load sellers list for admins
    const snap = await getDocs(collection(db, "users"));
    state.sellers = [];
    const opts = [
      `<option value="me" selected>My sales</option>`,
      `<option value="all">All sellers (admin)</option>`
    ];
    snap.forEach(d => {
      const u = d.data() || {};
      // show active users; if isActive missing, treat as active
      if (u.isActive === false) return;
      const name = u.displayName || u.email || d.id;
      state.sellers.push({ uid: d.id, name });
      opts.push(`<option value="${d.id}">${escapeHtml(name)}</option>`);
    });
    if (sellerSel) {
      sellerSel.innerHTML = opts.join("");
      sellerSel.classList.remove("hidden");
      sellerSel.onchange = () => loadHistory();
    }
  } catch (e) {
    console.warn("Failed to init admin/sellers:", e);
  }
}

// -------- CATALOG ----------
let catalogLoaded = false;
async function loadCatalogOnce() {
  if (catalogLoaded) return;
  try {
    const snap = await getDocs(collection(db, "items"));
    state.items = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(x => x.isActive)
      .sort((a,b)=>
        (a.category||"").localeCompare(b.category||"") ||
        (a.name||"").localeCompare(b.name||"")
      );
    catalogLoaded = true;
    renderFilters();
    renderCatalog();
  } catch (e) {
    setStatus("Failed to load catalog: " + (e?.message || e), true);
  }
}

function renderFilters() {
  const cats = Array.from(new Set(state.items.map(i => i.category))).sort();
  const sel = $("filterCat");
  if (!sel) return;
  sel.innerHTML = '<option value="">All Categories</option>' +
    cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  sel.onchange = renderCatalog;
  const search = $("search");
  if (search) search.oninput = renderCatalog;
}

function renderCatalog() {
  const searchEl = $("search");
  const q = (searchEl?.value || "").toLowerCase().trim();
  const catFilter = $("filterCat")?.value || "";
  const list = $("catalog");
  if (!list) return;

  list.innerHTML = "";

  // Filter items by search & category
  const filtered = state.items.filter(it => {
    const byCat = !catFilter || it.category === catFilter;
    const hay = (it.name + " " + (it.aliases || []).join(" ")).toLowerCase();
    const bySearch = !q || hay.includes(q);
    return byCat && bySearch;
  });

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.style.gridColumn = "1 / -1";
    empty.textContent = "No items match.";
    list.appendChild(empty);
    return;
  }

  // Group by category
  const groups = new Map();
  filtered.forEach(it => {
    const cat = it.category || "Other";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(it);
  });

  // Order: known categories first, then others alphabetically
  const knownOrder = ["Geek Bar","Refill","Exclusive","Bong","Joint 1x","Joint 5x"];
  const allCats = Array.from(groups.keys());
  const orderedCats = [];

  knownOrder.forEach(name => {
    if (allCats.includes(name)) {
      orderedCats.push(name);
    }
  });

  const remaining = allCats.filter(c => !knownOrder.includes(c)).sort();
  remaining.forEach(c => orderedCats.push(c));

  // Render each category as a card
  orderedCats.forEach(catName => {
    const items = groups.get(catName) || [];
    const card = document.createElement("div");
    card.className = "cat-card";

    card.innerHTML = `
      <div class="cat-header">
        <div class="cat-title">${escapeHtml(catName)}</div>
        <div class="cat-sub">${items.length} item${items.length > 1 ? "s" : ""}</div>
      </div>
      <div class="cat-items"></div>
    `;

    const itemsContainer = card.querySelector(".cat-items");

    items.forEach(it => {
      const row = document.createElement("div");
      row.className = "item-row";
      row.innerHTML = `
        <div class="item-main">
          <div class="item-name">${escapeHtml(it.name)}</div>
          <div class="item-price">${money(it.unitPrice || 0)}</div>
          <button class="item-add" data-id="${it.id}">+</button>
        </div>
      `;
      itemsContainer.appendChild(row);
    });

    list.appendChild(card);
  });

  // Attach add-to-cart handlers for all item + buttons
  list.querySelectorAll(".item-add").forEach(btn => {
    btn.onclick = () => addToCart(btn.dataset.id);
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
  if (!entries.length) {
    c.innerHTML = `<div class="muted">Cart is empty.</div>`;
    calcTotals();
    return;
  }
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

  // Determine which seller to view
  const sellerSel = $("histSeller");
  let mode = sellerSel ? sellerSel.value : "me";
  if (!state.isAdmin) mode = "me";

  // Build query
  let qy;
  if (state.isAdmin && mode === "all") {
    // All sellers in time window (no composite index needed)
    qy = query(
      collection(db, "sales"),
      where("ts", ">=", start),
      orderBy("ts", "desc"),
      limit(200)
    );
  } else {
    // Specific seller (me or chosen uid)
    const uid = (state.isAdmin && mode !== "me") ? mode : state.user.uid;
    qy = query(
      collection(db, "sales"),
      where("sellerUid", "==", uid),
      where("ts", ">=", start),
      orderBy("ts", "desc"),
      limit(200)
    );
  }

  try {
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

    renderHistory(rows, totalSum, hrs, mode);
    setHistStatus("");
  } catch (e) {
    console.error(e);
    setHistStatus("Failed to load history.");
  }
}

function renderHistory(rows, totalSum, hrs, mode) {
  const list = $("history");
  if (!list) return;
  if (!rows.length) {
    list.innerHTML = `<div class="muted">No sales found in the last ${hrs} hours.</div>`;
    setHistSummary(
      `0 sales | Total $0${
        state.isAdmin
          ? (mode==='all' ? " | View: All" : mode==='me' ? " | View: Me" : " | View: Seller")
          : ""
      }`
    );
    return;
  }

  const viewLabel = state.isAdmin ? (mode==='all' ? "All" : mode==='me' ? "Me" : "Seller") : "Me";
  setHistSummary(
    `${rows.length} sale${rows.length>1?'s':''} | Total ${money(totalSum)}${
      state.isAdmin ? ` | View: ${viewLabel}` : ""
    }`
  );

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
$("histRange")?.addEventListener("change", () => loadHistory());
$("btnHistRefresh")?.addEventListener("click", () => loadHistory());

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
