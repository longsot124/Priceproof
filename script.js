const searchInput = document.getElementById("searchInput");
const resultsSection = document.getElementById("results");
const resultsBody = document.getElementById("resultsBody");
const recommendation = document.getElementById("recommendation");
const savings = document.getElementById("savings");
const searchButton = document.getElementById("searchButton");

async function searchProduct() {
  const query = searchInput.value.trim();
  if (!query) return;

  resultsBody.innerHTML = "";
  recommendation.textContent = "";
  savings.textContent = "";
  resultsSection.classList.add("hidden");

  searchButton.disabled = true;
  searchButton.textContent = "Checking prices…";

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();

    const sorted = data.results.sort((a, b) => a.price - b.price);
    const lowest = sorted[0];
    const highest = sorted[sorted.length - 1];

    recommendation.textContent = `Best deal: ${lowest.store} — $${lowest.price.toFixed(2)}`;
    savings.textContent = `You could save $${(highest.price - lowest.price).toFixed(2)}`;

    sorted.forEach((item, i) => {
      const row = document.createElement("tr");
      if (i === 0) row.classList.add("best");

      row.innerHTML = `
        <td>${item.store}${i === 0 ? '<span class="badge">Best Deal</span>' : ''}</td>
        <td>$${item.price.toFixed(2)}</td>
        <td>$${item.price.toFixed(2)}</td>
      `;
      resultsBody.appendChild(row);
    });

    resultsSection.classList.remove("hidden");
    resultsSection.scrollIntoView({ behavior: "smooth" });

  } catch {
    recommendation.textContent = "Unable to retrieve prices right now.";
    resultsSection.classList.remove("hidden");
  } finally {
    searchButton.disabled = false;
    searchButton.textContent = "Check Price";
  }
}
