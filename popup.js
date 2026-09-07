"use strict";
const buttons = [...document.querySelectorAll("button[data-speed]")];
const status = document.getElementById("status");
let revision = 0;
function render(speed) {
  for (const button of buttons) button.setAttribute("aria-pressed", String(Number(button.dataset.speed) === speed));
  status.textContent = `Selected: ${speed}×`;
}
browser.storage.local.get("speed").then(({speed}) => {
  if (revision === 0) render([1, 1.5, 2].includes(speed) ? speed : 1);
}).catch(() => { status.textContent = "Could not read saved speed."; });
for (const button of buttons) button.addEventListener("click", async () => {
  revision++;
  const speed = Number(button.dataset.speed);
  buttons.forEach(item => { item.disabled = true; });
  try {
    await browser.storage.local.set({speed});
    render(speed);
  } catch (_) { status.textContent = "Could not save speed. Try again."; }
  finally { buttons.forEach(item => { item.disabled = false; }); }
});
