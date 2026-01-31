// Priceproof script.js (works with server.js pp-v5 / /api/search)

document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector(".search-box");
  const input = document.getElementById("searchInput");

  // Ensure Enter works even if form markup changes
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      searchProduct();
    });
  }

  // Extra safety: Enter key triggers search
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        searchProduct();
      }
    });
  }
});

async function searchProduct() {
  const input = document.getElementById("searchInput");
  const query = (input?.value || "").trim();
  if (!query) return;

  const resultsSection = document.getElementById("results");
  const resultsBody = document.getElementById("resultsBody");
  const recommendation = document.getElementById("recommendation");
  const savings = document.getElementById("savings");

  if (!resultsSection || !resultsBody) return;

  // show results section
  resultsSection.classList.remove("hidden");

  // scroll to results
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });

  // loading row
  resultsBody.innerHTML = `
    <tr>
      <td colspan="3" style="padding:18px; opacity:0.95;">
        Loading best prices for "<strong>${escapeHtml(query)}</strong>"…
      </td>
    </tr>
  `;

  if (recommendation) recommendation.textContent = "Prices checked moments ago";
  if (savings) savings.textContent = "";

  // Also clear agent UI until we get data
  ensureAgentBox(true);

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Render agent box (best pick + alternatives)
    renderAgentResults(data);

    // Render table (best + alternatives)
    const all = [
      data.best_pick,
      ...((data.alternatives || []).map((a) => a) || []),
    ].filter(Boolean);

    if (!all.length) {
      resultsBody.innerHTML = `
        <tr>
          <td colspan="3" style="padding:18px;">
            <strong>No results found.</strong><br/>
            <span style="opacity:0.85;">Try a more specific search (brand + model).</span>
          </td>
        </tr>
      `;
      return;
    }

    resultsBody.innerHTML = all
      .map((o) => {
        const total = formatMoney(o?.pricing?.total);
        const item = formatMoney(o?.pricing?.item);

        const img = o?.image
          ? `<img src="${o.image}" alt="" class="thumb" loading="lazy" />`
          : `<div class="thumb placeholder"></div>`;

        const title = o?.title || `${o?.retailer || "Retailer"} listing`;

        return `
          <tr>
            <td>
              <div class="row-flex">
                ${img}
                <div>
                  <div class="row-title">${escapeHtml(title)}</div>
                  <div class="row-meta">
                    <strong>${escapeHtml(o?.retailer || "Retailer")}</strong>
                    ${o?.condition ? ` • ${escapeHtml(o.condition)}` : ""}
                    ${o?.delivery ? ` • ${escapeHtml(o.delivery)}` : ""}
                  </div>
                  ${
                    o?.url
                      ? `<a class="row-link" href="${o.url}" target="_blank" rel="noopener">View on ${escapeHtml(o?.retailer || "store")} →</a>`
                      : ""
                  }
                </div>
              </div>
            </td>
            <td>${item}</td>
            <td><strong>${total}</strong></td>
          </tr>
        `;
      })
      .join("");

  } catch (err) {
    console.error(err);
    resultsBody.innerHTML = `
      <tr>
        <td colspan="3" style="padding:18px;">
          <strong>Unable to retrieve prices right now.</strong><br/>
          <span style="opacity:0.85;">Try again in a moment.</span>
        </td>
      </tr>
    `;
    // clear agent box if error
    ensureAgentBox(false);
  }
}

/* ---------- Agent UI ---------- */

function ensureAgentBox(showLoading) {
  const resultsSection = document.getElementById("results");
  if (!resultsSection) return null;

  let agentBox = document.getElementById("agentBox");
  if (!agentBox) {
    agentBox = document.createElement("div");
    agentBox.id = "agentBox";
    agentBox.style.margin = "18px 0 22px 0";
    const table = resultsSection.querySelector("table");
    if (table) resultsSection.insertBefore(agentBox, table);
    else resultsSection.appendChild(agentBox);
  }

  if (showLoading) {
    agentBox.innerHTML = `
      <div class="agent-grid">
        <div class="agent-best" style="opacity:0.95;">
          <div class="agent-kicker">Best pick right now</div>
          <div style="margin-top:10px; opacity:0.85;">Loading recommendation…</div>
        </div>
        <div class="agent-alts" style="opacity:0.95;">
          <div class="agent-kicker">Smart alternatives</div>
          <div style="margin-top:10px; opacity:0.85;">Loading options…</div>
        </div>
      </div>
    `;
  } else {
    agentBox.innerHTML = "";
  }

  return agentBox;
}

function renderAgentResults(data) {
  const resultsSection = document.getElementById("results");
  if (!resultsSection) return;

  const agentBox = ensureAgentBox(false);
  if (!agentBox) return;

  const best = data?.best_pick;
  const alts = data?.alternatives || [];

  if (!best) {
    agentBox.innerHTML = `
      <div style="opacity:0.9; padding: 12px 0;">
        No best pick available.
      </div>
    `;
    return;
  }

  const bestTitle = best.title || "Best Pick";
  const bestRetailer = best.retailer || "Retailer";
  const bestTotal = formatMoney(best?.pricing?.total);

  agentBox.innerHTML = `
    <div class="agent-grid">
      <div class="agent-best">
        <div class="agent-header">
          <div class="agent-kicker">Best pick right now</div>
          <div class="agent-title">${escapeHtml(bestTitle)}</div>
          <div class="agent-meta">
            <span>${escapeHtml(bestRetailer)}</span>
            ${best.delivery ? `<span>• ${escapeHtml(best.delivery)}</span>` : ""}
            ${best.trust ? `<span class="badge">${escapeHtml(best.trust)}</span>` : ""}
          </div>
        </div>

        <div class="agent-price">
          <div class="agent-total">${bestTotal}</div>
          <div class="agent-breakdown">
            Item ${formatMoney(best?.pricing?.item)}
            ${best?.pricing?.shipping != null ? ` • Ship ${formatMoney(best?.pricing?.shipping)}` : ""}
            ${best?.pricing?.tax != null ? ` • Est. tax ${formatMoney(best?.pricing?.tax)}` : ""}
          </div>
        </div>

        <div class="agent-why">
          ${escapeHtml(data?.summary?.best_pick_reason || "Selected for the best balance of total cost and trust.")}
        </div>

        <div class="agent-actions">
          <a class="btn-primary" href="${best?.cta?.checkout_url || best?.url || "#"}" target="_blank" rel="noopener">
            ${escapeHtml(best?.cta?.primary_label || "View deal")}
          </a>
          <button class="btn-ghost" type="button" onclick="startWatch()">
            Watch price
          </button>
        </div>

        <div class="agent-footnote">
          ${escapeHtml(data?.disclosures?.pricing_note || "")}
        </div>
      </div>

      <div class="agent-alts">
        <div class="agent-kicker">Smart alternatives</div>
        ${
          alts.length
            ? alts.map(renderAltCard).join("")
            : `<div style="opacity:0.85; margin-top:10px;">No alternatives found.</div>`
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
          <button class="btn-primary full" type="button" onclick="saveWatch('${escapeHtml(data?.query || "")}')">
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
  const label = o?.label || (o?.condition && o.condition.toLowerCase().includes("used") ? "Used/refurb option" : "Alternative");
  const retailer = o?.retailer || "Retailer";

  return `
    <div class="alt-card">
      <div class="alt-top">
        <div>
          <div class="alt-label">${escapeHtml(label)}</div>
          <div class="alt-retailer">
            ${escapeHtml(retailer)}
            ${o?.delivery ? ` • ${escapeHtml(o.delivery)}` : ""}
          </div>
        </div>
        <div class="alt-total">${total}</div>
      </div>
      ${o?.tradeoff ? `<div class="alt-tradeoff">${escapeHtml(o.tradeoff)}</div>` : ""}
      <a class="btn-ghost full" href="${o?.cta?.checkout_url || o?.url || "#"}" target="_blank" rel="noopener">
        View deal
      </a>
    </div>
  `;
}

function startWatch() {
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
    createdAt: new Date().toISOString(),
  };

  localStorage.setItem("priceproof_watch", JSON.stringify(payload));
  alert("✅ Watch started! (Saved locally for now.)");
}

/* ---------- Utilities ---------- */

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
