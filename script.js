// ===== Priceproof Frontend (Storefront UI + results + cart drawer) =====

document.addEventListener("DOMContentLoaded", () => {
  // Search
  const form = document.getElementById("searchForm");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      searchProduct();
    });
  }

  // Back to top
  const backToTop = document.getElementById("backToTop");
  if (backToTop) {
    backToTop.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  // Table toggle
  const toggleTable = document.getElementById("toggleTable");
  if (toggleTable) {
    toggleTable.addEventListener("click", () => {
      const wrap = document.getElementById("tableWrap");
      if (!wrap) return;
      const isHidden = wrap.classList.contains("hidden");
      wrap.classList.toggle("hidden", !isHidden ? true : false);
      toggleTable.textContent = isHidden ? "Hide table" : "Show table";
    });
  }

  // Cart drawer
  wireCartDrawer();

  // Load cart from localStorage
  loadCart();
});

async function searchProduct() {
  const input = document.getElementById("searchInput");
  const query = (input?.value || "").trim();
  if (!query) return;

  const resultsSection = document.getElementById("results");
  const metaEl = document.getElementById("resultsMeta");
  const agentMount = document.getElementById("agentMount");
  const offersGrid = document.getElementById("offersGrid");
  const resultsBody = document.getElementById("resultsBody");
  const tableWrap = document.getElementById("tableWrap");
  const toggleTable = document.getElementById("toggleTable");

  if (!resultsSection || !agentMount || !offersGrid || !resultsBody) return;

  // Show results
  resultsSection.classList.remove("hidden");

  // Keep table hidden by default (clean UI)
  if (tableWrap) tableWrap.classList.add("hidden");
  if (toggleTable) toggleTable.textContent = "Show table";

  // Scroll
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });

  // Loading UI
  offersGrid.innerHTML = `<div class="panel" style="grid-column:1/-1;">
    <div class="panel-title">Searching…</div>
    <div class="panel-text">Finding the best total cost for <strong>${escapeHtml(query)}</strong></div>
  </div>`;
  resultsBody.innerHTML = `<tr><td colspan="3">Loading…</td></tr>`;
  agentMount.innerHTML = "";
  if (metaEl) metaEl.textContent = "Checking prices…";

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Meta line
    if (metaEl) {
      const source = data?.meta?.source ? ` • ${data.meta.source}` : "";
      const cached = data?.meta?.cached ? " • cached" : "";
      metaEl.textContent = `Prices checked moments ago${cached}${source}`;
    }

    // Render “agent” best pick + alternatives area
    renderAgent(data);

    // Render offer cards
    const all = [data.best_pick, ...(data.alternatives || [])].filter(Boolean);
    renderOfferCards(all, data);

    // Render table rows (optional)
    resultsBody.innerHTML = all.map(renderTableRow).join("");

  } catch (err) {
    console.error(err);
    if (metaEl) metaEl.textContent = "Unable to retrieve prices right now.";

    offersGrid.innerHTML = `<div class="panel" style="grid-column:1/-1;">
      <div class="panel-title">Something went wrong</div>
      <div class="panel-text">Try again in a moment.</div>
    </div>`;

    resultsBody.innerHTML = `<tr><td colspan="3">Error fetching results.</td></tr>`;
    agentMount.innerHTML = "";
  }
}

function renderAgent(data) {
  const agentMount = document.getElementById("agentMount");
  if (!agentMount) return;

  const best = data?.best_pick || {};
  const alts = data?.alternatives || [];

  const bestImg = best?.image
    ? `<img class="agent-img" src="${best.image}" alt="${escapeHtml(best.title || "Best pick")}">`
    : `<div class="agent-img" style="display:grid;place-items:center;opacity:.75;">🛍️</div>`;

  agentMount.innerHTML = `
    <div class="agent-wrap">
      <div class="agent-grid">
        <div class="agent-best">
          <div class="agent-kicker">✨ Best pick right now</div>

          <div class="agent-top">
            <div>
              <div class="agent-title">${escapeHtml(best.title || "Best Pick")}</div>
              <div class="agent-sub">
                <span>${escapeHtml(best.retailer || "Retailer")}</span>
                ${best.delivery ? `<span>• ${escapeHtml(best.delivery)}</span>` : ""}
                ${best.trust ? `<span class="badge">${escapeHtml(best.trust)}</span>` : ""}
              </div>
            </div>
            ${bestImg}
          </div>

          <div class="agent-price">
            <div class="agent-total">${formatMoney(best?.pricing?.total)}</div>
            <div class="agent-mini">
              Item ${formatMoney(best?.pricing?.item)} • Ship ${formatMoney(best?.pricing?.shipping)} • Est. tax ${formatMoney(best?.pricing?.tax)}
            </div>
          </div>

          <div class="agent-why">
            <strong>Why this pick:</strong>
            ${escapeHtml(data?.summary?.best_pick_reason || "Selected for the best balance of total cost and trust.")}
          </div>

          <!-- Labels restored + buttons all aurora -->
          <div class="agent-actions">
            <div class="action-block">
              <div class="action-label">Go to retailer</div>
              <a class="btn btn-aurora" href="${best?.cta?.checkout_url || best?.url || "#"}" target="_blank" rel="noopener">View deal</a>
            </div>

            <div class="action-block">
              <div class="action-label">Save for checkout</div>
              <button class="btn btn-aurora" type="button" onclick='addBestToCart(${JSON.stringify(safeCartItem(best))})'>Add to cart</button>
            </div>

            <div class="action-block">
              <div class="action-label">Track price drops</div>
              <button class="btn btn-aurora" type="button" onclick='startWatch("${escapeHtml(data.query || "")}")'>Watch price</button>
            </div>
          </div>

          <div class="agent-foot">
            ${escapeHtml(data?.disclosures?.pricing_note || "")}
          </div>
        </div>

        <div class="agent-side">
          <div class="agent-kicker">🧠 Smart alternatives</div>

          ${
            alts.length
              ? alts.slice(0, 3).map(renderAltMini).join("")
              : `
                <div class="alt-empty">
                  <div class="t1">No alternatives found.</div>
                  <div class="t2">Try a more specific search (ex: “ps5 slim digital”).</div>
                </div>
              `
          }

          <div class="alt-empty" style="margin-top:12px;">
            <div class="t1">🔔 Price Watch</div>
            <div class="t2">V1 saves locally for now. Alerts come later.</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderAltMini(o) {
  const url = o?.cta?.checkout_url || o?.url || "#";
  return `
    <div class="alt-empty" style="text-align:left;">
      <div class="t1">${escapeHtml(o.label || "Alternative")} — ${formatMoney(o?.pricing?.total)}</div>
      <div class="t2">${escapeHtml(o.retailer || "")}${o.delivery ? ` • ${escapeHtml(o.delivery)}` : ""}</div>
      <div style="margin-top:10px;">
        <a class="btn btn-aurora full" href="${url}" target="_blank" rel="noopener">View deal</a>
      </div>
    </div>
  `;
}

function renderOfferCards(all, data) {
  const offersGrid = document.getElementById("offersGrid");
  if (!offersGrid) return;

  if (!all.length) {
    offersGrid.innerHTML = `<div class="panel" style="grid-column:1/-1;">
      <div class="panel-title">No offers found.</div>
      <div class="panel-text">Try a different query.</div>
    </div>`;
    return;
  }

  offersGrid.innerHTML = all.map((o, idx) => {
    const url = o?.cta?.checkout_url || o?.url || "#";
    const img = o?.image
      ? `<img class="offer-img" src="${o.image}" alt="${escapeHtml(o.title || "Offer")}">`
      : `<div class="offer-img" style="display:grid;place-items:center;opacity:.75;">🛍️</div>`;

    const trust = o?.trust ? `<span class="badge">${escapeHtml(o.trust)}</span>` : "";
    const delivery = o?.delivery ? `<span class="badge">${escapeHtml(o.delivery)}</span>` : "";

    return `
      <div class="offer-card">
        <div class="offer-top">
          ${img}
          <div>
            <div class="offer-title">${escapeHtml(o.title || "")}</div>
            <div class="offer-sub">
              <span>${escapeHtml(o.retailer || "")}</span>
              ${trust}
              ${delivery}
            </div>
          </div>
        </div>

        <div class="offer-price">
          <div class="offer-total">${formatMoney(o?.pricing?.total)}</div>
          <div class="offer-mini">Item ${formatMoney(o?.pricing?.item)}</div>
        </div>

        <div class="offer-actions">
          <a class="btn btn-aurora" href="${url}" target="_blank" rel="noopener">View deal</a>
          <button class="btn btn-aurora" type="button" onclick='addToCart(${JSON.stringify(safeCartItem(o))})'>Add</button>
        </div>
      </div>
    `;
  }).join("");
}

function renderTableRow(o) {
  const retailer = escapeHtml(o.retailer || "Unknown");
  const title = escapeHtml(o.title || "");
  const condition = escapeHtml(o.condition || "");
  const item = formatMoney(o?.pricing?.item);
  const total = formatMoney(o?.pricing?.total);

  return `
    <tr>
      <td><strong>${retailer}</strong><div style="opacity:.85;margin-top:4px;">${title}${condition ? ` • ${condition}` : ""}</div></td>
      <td>${item}</td>
      <td><strong>${total}</strong></td>
    </tr>
  `;
}

/* -------------------------
   CART (local v1)
------------------------- */

function wireCartDrawer() {
  const cartBtn = document.getElementById("cartBtn");
  const overlay = document.getElementById("cartOverlay");
  const drawer = document.getElementById("cartDrawer");
  const closeBtn = document.getElementById("cartClose");

  const open = () => {
    if (!overlay || !drawer) return;
    overlay.classList.remove("hidden");
    drawer.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
    drawer.setAttribute("aria-hidden", "false");
    renderCart();
  };

  const close = () => {
    if (!overlay || !drawer) return;
    overlay.classList.add("hidden");
    drawer.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
    drawer.setAttribute("aria-hidden", "true");
  };

  if (cartBtn) cartBtn.addEventListener("click", open);
  if (overlay) overlay.addEventListener("click", close);
  if (closeBtn) closeBtn.addEventListener("click", close);
}

function safeCartItem(o) {
  return {
    id: o?.id || `item-${Math.random().toString(16).slice(2)}`,
    title: o?.title || "Item",
    retailer: o?.retailer || "Retailer",
    price: Number(o?.pricing?.total || o?.pricing?.item || 0),
    image: o?.image || null,
    url: o?.cta?.checkout_url || o?.url || "#"
  };
}

function addBestToCart(item) {
  addToCart(item);
  // open cart so it feels responsive
  const cartBtn = document.getElementById("cartBtn");
  cartBtn?.click();
}

function addToCart(item) {
  const cart = getCart();
  cart.push(item);
  setCart(cart);
  bumpCartCount(cart.length);
  renderCart();
}

function removeFromCart(id) {
  const cart = getCart().filter((x) => x.id !== id);
  setCart(cart);
  bumpCartCount(cart.length);
  renderCart();
}

function bumpCartCount(n) {
  const badge = document.getElementById("cartCount");
  if (badge) badge.textContent = String(n);
}

function getCart() {
  try {
    return JSON.parse(localStorage.getItem("pp_cart") || "[]");
  } catch {
    return [];
  }
}

function setCart(cart) {
  localStorage.setItem("pp_cart", JSON.stringify(cart));
}

function loadCart() {
  const cart = getCart();
  bumpCartCount(cart.length);
}

function renderCart() {
  const cartItems = document.getElementById("cartItems");
  const subtotalEl = document.getElementById("cartSubtotal");
  if (!cartItems || !subtotalEl) return;

  const cart = getCart();
  const subtotal = cart.reduce((s, it) => s + (Number(it.price) || 0), 0);
  subtotalEl.textContent = formatMoney(subtotal);

  if (!cart.length) {
    cartItems.innerHTML = `<div class="panel" style="margin:0;">
      <div class="panel-title">Cart is empty</div>
      <div class="panel-text">Add an offer and we’ll keep it here.</div>
    </div>`;
    return;
  }

  cartItems.innerHTML = cart.map((it) => `
    <div class="cart-item">
      ${
        it.image
          ? `<img src="${it.image}" alt="${escapeHtml(it.title)}">`
          : `<div style="width:54px;height:54px;border-radius:14px;border:1px solid rgba(255,255,255,.12);display:grid;place-items:center;opacity:.75;">🛍️</div>`
      }
      <div>
        <div class="cart-item-title">${escapeHtml(it.title)}</div>
        <div class="cart-item-sub">${escapeHtml(it.retailer)}</div>
      </div>
      <div class="cart-item-right">
        <div class="cart-item-price">${formatMoney(it.price)}</div>
        <button class="cart-item-remove" type="button" onclick="removeFromCart('${escapeHtml(it.id)}')">Remove</button>
      </div>
    </div>
  `).join("");
}

/* -------------------------
   Watch (local v1)
------------------------- */

function startWatch(query) {
  const payload = {
    query,
    under: "",
    includeUsed: true,
    createdAt: new Date().toISOString()
  };
  localStorage.setItem("priceproof_watch", JSON.stringify(payload));
  alert("✅ Watch started! (Saved locally for now.)");
}

/* -------------------------
   Helpers
------------------------- */

function formatMoney(n) {
  const num = Number(n);
  if (!isFinite(num)) return "—";
  return num.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
