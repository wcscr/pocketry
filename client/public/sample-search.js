// Enhance the static list on the catalog page. Every design is present in the HTML.
const search = document.querySelector("#sample-query");
const status = document.querySelector("#sample-search-status");
const normalize = (text) => text.toLowerCase()
  .replace(/([0-9])(mm|cm|ft|in)\b/g, "$1 $2")
  .match(/[a-z0-9]+/g) ?? [];

const entries = Array.from(document.querySelectorAll(".sample-list > li"), (row) => ({
  row,
  text: normalize(row.querySelector("h3").textContent + " " + row.querySelector("p").textContent + " " + row.dataset.keywords),
}));

function filterSamples() {
  const terms = normalize(search.value);
  let matches = 0;
  for (const { row, text } of entries) {
    const visible = terms.every(term => /[0-9]/.test(term)
      ? text.includes(term)
      : text.some(word => word.startsWith(term)));
    row.hidden = !visible;
    if (visible) matches += 1;
  }
  status.textContent = matches === 0
    ? "No sample designs match. Try another tool, model, or feature."
    : `${matches} ${matches === 1 ? "design" : "designs"}`;
}

search.addEventListener("input", filterSamples);
filterSamples();
document.querySelector("#sample-search").hidden = false;
