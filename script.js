// ===== Priceproof Frontend (Agent UI + smooth results) =====

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("searchForm");
  const backToTop = document.getElementById("backToTop");

  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      searchProduct();
    });
  }

  if (backToTop) {
    backToTop.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }
});

async function searchProduct() {
  const input = document.getElementById("searchInput");
  const query = (input?.value || "").trim();
  if (!query) return;

  const resultsSection = document.getElementById("results");
  const resultsBody = document.getElementById("resultsBody");
  const metaEl = document.getElementById("resultsMeta");

  if (!resultsSection || !resultsBody) return;

  resultsSection.classList.remove("hidden");

  // Smooth scroll to results
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });

  // Loading state
  resultsBody.innerHTML = `
    <tr>
      <td colspan="3" style="padding:18px; opacity:0.9; font-weight:800;">
        Loading best prices for "<strong>${escapeHtml(query)}</strong>"…
      </td>
    </tr>
  `;

  // Clear previous agent UI
  const existingBox = document.getElementById("agentBox");
  if (existingBox) existingBox.remove();

  if (metaEl) metaEl.textContent = "Checking prices…";

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (metaEl) {
      const source = data?.meta?.source ? ` • ${data.meta.source}` : "";
      const cached = data?.meta?.cached ? " • cached" : "";
      metaEl.textContent = `Prices checked moments ago${cached}${source}`;
    }

    renderAgentResults(data);

    // Table: best + alternatives
    const all = [data.best_pick, ...(data.alternatives || [])].filter(Boolean);

    resultsBody.innerHTML = all
      .map((o) => {
        const total = formatMoney(o?.pricing?.total);
        const item = formatMoney(o?.pricing?.item);
        const retailer = escapeHtml(o.retailer || "Unknown");
        const title = escapeHtml(o.title || "");
        const condition = escapeHtml(o.condition || "");
        const url = o?.cta?.checkout_url || o?.url || "#";

        return `
          <tr>
            <td>
              <strong>${retailer}</strong>
              <div style="opacity:0.85; font-weight:750; margin-top:2px;">
                ${title ? `${title}` : ""}
                ${condition ? ` • ${condition}` : ""}
              </div>
              <div style="margin-top:6px;">
                <a href="${url}" target="_blank" rel="noopener" style="font-weight:950; color: rgba(88,160,255,.98); text-decoration:none;">
                  View on ${retailer} →
                </a>
              </div>
            </td>
            <td>${item}</td>
            <td><strong>${total}</strong></td>
          </tr>
        `;
      })
      .join("");

  } catch (err) {
    if (metaEl) metaEl.textContent = "Unable to retrieve prices right now.";

    resultsBody.innerHTML = `
      <tr>
        <td colspan="3" style="padding:18px;">
          <strong>Something went wrong while fetching prices.</strong><br/>
          <span style="opacity:0.85; font-weight:750;">Try again in a moment.</span>
        </td>
      </tr>
    `;
    console.error(err);
  }
}

function renderAgentResults(data) {
  const resultsSection = document.getElementById("results");
  if (!resultsSection) return;

  const table = resultsSection.querySelector("table");
  if (!table) return;

  let agentBox = document.getElementById("agentBox");
  if (!agentBox) {
    agentBox = document.createElement("div");
    agentBox.id = "agentBox";
    agentBox.style.margin = "18px 0 22px 0";
    resultsSection.querySelector(".section-card").insertBefore(agentBox, table.parentElement);
  }

  const best = data?.best_pick || {};
  const alts = data?.alternatives || [];

  const bestImg = best?.image
    ? `<img class="agent-image" src="${best.image}" alt="${escapeHtml(best.title || "Best pick")}">`
    : "";

  agentBox.innerHTML = `
    <div class="agent-grid">
      <div class="agent-best">
        <div class="agent-kicker">✨ Best pick right now</div>

        <div class="agent-toprow">
          <div>
            <div class="agent-title">${escapeHtml(best.title || "Best Pick")}</div>
            <div class="agent-meta">
              <span>${escapeHtml(best.retailer || "")}</span>
              ${best.delivery ? `<span>• ${escapeHtml(best.delivery)}</span>` : ""}
              ${best.trust ? `<span class="badge">${escapeHtml(best.trust)}</span>` : ""}
            </div>
          </div>
          ${bestImg}
        </div>

        <div class="agent-price">
          <div class="agent-total">${formatMoney(best?.pricing?.total)}</div>
          <div class="agent-breakdown">
            Item ${formatMoney(best?.pricing?.item)}
            • Ship ${formatMoney(best?.pricing?.shipping)}
            • Est. tax ${formatMoney(best?.pricing?.tax)}
          </div>
        </div>

        <div class="agent-why">
          ${escapeHtml(data?.summary?.best_pick_reason || "Selected for the best balance of total cost and trust.")}
        </div>

        <div class="agent-actions">
          <a class="btn-primary" href="${best?.cta?.checkout_url || best?.url || "#"}" target="_blank" rel="noopener">
            View deal
          </a>
          <button class="btn-ghost" type="button" onclick="addToCart('${escapeHtml(best.id || "best")}')">
            Add to cart
          </button>
          <button class="btn-ghost" type="button" onclick="startWatch('${escapeHtml(data.query || "")}')">
            Watch price
          </button>
        </div>

        <div class="agent-footnote">
          ${escapeHtml(data?.disclosures?.pricing_note || "")}
        </div>
      </div>

      <div class="agent-alts">
        <div class="agent-kicker">🧠 Smart alternatives</div>
        ${
          alts.length
            ? alts.map(renderAltCard).join("")
            : `<div style="opacity:0.85; font-weight:850;">No alternatives found.</div>`
        }

        <div class="watch-box">
          <div class="watch-title">Keep watching this for you</div>

          <div class="watch-row">
            <label class="watch-label">Notify me under</label>
            <input id="watchPrice" class="watch-input" placeholder="$ (optional)" />
          </div>

          <label class="watch-check">
            <input id="watchUsed" type="checkbox" checked />
            Include used/refurb options
          </label>

          <button class="btn-primary full" type="button" onclick="saveWatch('${escapeHtml(data.query || "")}')">
            Start Watch
          </button>

          <div class="watch-note">V1 saves locally for now. Alerts come later.</div>
        </div>
      </div>
    </div>
  `;
}

function renderAltCard(o) {
  const total = formatMoney(o?.pricing?.total);
  const img = o?.image
    ? `<img class="agent-image" style="width:64px;height:64px;border-radius:14px;" src="${o.image}" alt="${escapeHtml(o.title || "Alternative")}">`
    : "";

  return `
    <div class="alt-card">
      <div class="alt-top">
        <div>
          <div class="alt-label">${escapeHtml(o.label || "Alternative")}</div>
          <div class="alt-retailer">${escapeHtml(o.retailer || "")}${o.delivery ? ` • ${escapeHtml(o.delivery)}` : ""}</div>
        </div>
        <div style="display:flex; gap:10px; align-items:flex-start;">
          <div class="alt-total">${total}</div>
          ${img}
        </div>
      </div>
      <div class="alt-tradeoff">${escapeHtml(o.tradeoff || "")}</div>
      <a class="btn-ghost full" href="${o?.cta?.checkout_url || o?.url || "#"}" target="_blank" rel="noopener">
        View deal
      </a>
    </div>
  `;
}

function startWatch(query) {
  const el = document.querySelector(".watch-box");
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

function saveWatch(query) {
  const priceEl = document.getElementById("watchPrice");
  const usedEl = document.getElementById("watchUsed");

  const payload = {
    query,
    under: (priceEl?.value || "").trim(),
    includeUsed: !!usedEl?.checked,
    createdAt: new Date().toISOString()
  };

  localStorage.setItem("priceproof_watch", JSON.stringify(payload));
  alert("✅ Watch started! (Saved locally for now.)");
}

function addToCart(id) {
  // V1: just count locally (later: real cart + checkout)
  const badge = document.getElementById("cartCount");
  const current = Number(badge?.textContent || 0);
  if (badge) badge.textContent = String(current + 1);
}

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
