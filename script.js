async function searchProduct() {
  const input = document.getElementById("searchInput");
  const query = (input?.value || "").trim();

  if (!query) return;

  const resultsSection = document.getElementById("results");
  const resultsBody = document.getElementById("resultsBody");
  const recommendation = document.getElementById("recommendation");
  const savings = document.getElementById("savings");

  // Safety: if any element is missing, don’t crash
  if (!resultsSection || !resultsBody) return;

  // Show results section + loading state
  resultsSection.classList.remove("hidden");
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });

  resultsBody.innerHTML = `
    <tr>
      <td colspan="3" style="padding:18px; opacity:0.9;">
        Loading best prices for "<strong>${escapeHtml(query)}</strong>"…
      </td>
    </tr>
  `;
  if (recommendation) recommendation.textContent = "";
  if (savings) savings.textContent = "";

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Render Best Pick + Alternatives into a clean UI block above the table
    renderAgentResults(data);

    // Also keep a simple table (optional) showing all offers (best + alternatives)
    const all = [data.best_pick, ...(data.alternatives || [])];
    resultsBody.innerHTML = all
      .map((o) => {
        const total = formatMoney(o?.pricing?.total);
        const item = formatMoney(o?.pricing?.item);
        return `
          <tr>
            <td>
              <strong>${escapeHtml(o.retailer || "Unknown")}</strong>
              <div style="opacity:0.8;font-size:0.9rem;">
                ${escapeHtml(o.condition || "")}${o.delivery ? ` • ${escapeHtml(o.delivery)}` : ""}
              </div>
            </td>
            <td>${item}</td>
            <td><strong>${total}</strong></td>
          </tr>
        `;
      })
      .join("");

  } catch (err) {
    resultsBody.innerHTML = `
      <tr>
        <td colspan="3" style="padding:18px;">
          <strong>Something went wrong while fetching prices.</strong><br/>
          <span style="opacity:0.85;">Try again in a moment.</span>
        </td>
      </tr>
    `;
    console.error(err);
  }
}

function renderAgentResults(data) {
  const resultsSection = document.getElementById("results");
  if (!resultsSection) return;

  // Create or reuse a container above the table
  let agentBox = document.getElementById("agentBox");
  if (!agentBox) {
    agentBox = document.createElement("div");
    agentBox.id = "agentBox";
    agentBox.style.margin = "18px 0 22px 0";
    resultsSection.insertBefore(agentBox, resultsSection.querySelector("table"));
  }

  const best = data.best_pick;
  const alts = data.alternatives || [];

  agentBox.innerHTML = `
    <div class="agent-grid">
      <div class="agent-best">
        <div class="agent-header">
          <div class="agent-kicker">Best pick right now</div>
          <div class="agent-title">${escapeHtml(best.title || "Best Pick")}</div>
          <div class="agent-meta">
            <span>${escapeHtml(best.retailer || "")}</span>
            ${best.delivery ? `<span>• ${escapeHtml(best.delivery)}</span>` : ""}
            ${best.trust ? `<span class="badge">${escapeHtml(best.trust)}</span>` : ""}
          </div>
        </div>

        <div class="agent-price">
          <div class="agent-total">${formatMoney(best?.pricing?.total)}</div>
          <div class="agent-breakdown">
            Item ${formatMoney(best?.pricing?.item)} • Ship ${formatMoney(best?.pricing?.shipping)} • Est. tax ${formatMoney(best?.pricing?.tax)}
          </div>
        </div>

        <div class="agent-why">
          ${escapeHtml(data?.summary?.best_pick_reason || "Selected for the best balance of total cost and trust.")}
        </div>

        <div class="agent-actions">
          <a class="btn-primary" href="${best?.cta?.checkout_url || "#"}" target="_blank" rel="noopener">Buy via Priceproof</a>
          <button class="btn-ghost" type="button" onclick="startWatch('${escapeHtml(data.query || "")}')">Watch price</button>
        </div>

        <div class="agent-footnote">
          ${escapeHtml(data?.disclosures?.pricing_note || "")}
        </div>
      </div>

      <div class="agent-alts">
        <div class="agent-kicker">Smart alternatives</div>
        ${alts.length ? alts.map(renderAltCard).join("") : `<div style="opacity:0.85;">No alternatives found.</div>`}

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
          <button class="btn-primary full" type="button" onclick="saveWatch('${escapeHtml(data.query || "")}')">Start Watch</button>
          <div class="watch-note">V1 saves locally for now. Alerts come later.</div>
        </div>
      </div>
    </div>
  `;
}

function renderAltCard(o) {
  const total = formatMoney(o?.pricing?.total);
  return `
    <div class="alt-card">
      <div class="alt-top">
        <div>
          <div class="alt-label">${escapeHtml(o.label || "Alternative")}</div>
          <div class="alt-retailer">${escapeHtml(o.retailer || "")} ${o.delivery ? `• ${escapeHtml(o.delivery)}` : ""}</div>
        </div>
        <div class="alt-total">${total}</div>
      </div>
      <div class="alt-tradeoff">${escapeHtml(o.tradeoff || "")}</div>
      <a class="btn-ghost full" href="${o?.cta?.checkout_url || "#"}" target="_blank" rel="noopener">Buy via Priceproof</a>
    </div>
  `;
}

function startWatch(query) {
  // Simple UX: jump to the watch box
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

  // Save locally for now (later: save to DB and send emails/texts)
  localStorage.setItem("priceproof_watch", JSON.stringify(payload));

  alert("✅ Watch started! (Saved locally for now.)");
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
