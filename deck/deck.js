(() => {
  const slides = [...document.querySelectorAll(".slide")];
  const notes = document.querySelector(".notes");
  const hudN = document.getElementById("hud-n");
  let i = Math.max(0, Math.min(slides.length - 1, parseInt(location.hash.slice(1) || "1", 10) - 1));

  function show(n) {
    i = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach((s, k) => {
      s.classList.toggle("active", k === i);
      s.classList.toggle("past", k < i);
    });
    location.hash = String(i + 1);
    hudN.textContent = `${i + 1} / ${slides.length}`;
    document.getElementById("notes-n").textContent = `slide ${i + 1}`;
    document.getElementById("notes-body").innerHTML = window.NOTES[String(i + 1)] || "<p><em>No notes for this slide.</em></p>";
    animate(slides[i]);
  }

  // the hash chain: draw the honest row, then let the tamper row turn red block by block
  function animate(slide) {
    const svg = slide.querySelector(".hash svg");
    if (!svg) return;
    const groups = [...svg.querySelectorAll("rect[stroke='var(--danger)'], path.d-arrow.d-danger, text[fill='var(--danger)'], g[transform*='rotate']")];
    groups.forEach((el) => { el.style.transition = "none"; el.style.opacity = "0"; });
    groups.forEach((el, k) => setTimeout(() => { el.style.transition = "opacity .35s"; el.style.opacity = "1"; }, 700 + k * 90));
  }

  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    const k = e.key;
    if (["ArrowRight", " ", "PageDown", "Enter"].includes(k)) { e.preventDefault(); show(i + 1); }
    else if (["ArrowLeft", "PageUp", "Backspace"].includes(k)) { e.preventDefault(); show(i - 1); }
    else if (k === "Home") show(0);
    else if (k === "End") show(slides.length - 1);
    else if (k.toLowerCase() === "n") notes.hidden = !notes.hidden;
    else if (k.toLowerCase() === "f") { document.body.classList.toggle("presenting"); (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}); }
    else if (k.toLowerCase() === "l") { const b = document.body; b.dataset.theme = b.dataset.theme === "light" ? "dark" : "light"; }
    else if (k.toLowerCase() === "g") { const n = parseInt(prompt("Go to slide"), 10); if (n) show(n - 1); }
  });
  // click or tap on the right half goes forward, left half back
  document.querySelector(".deck").addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    show(e.clientX > innerWidth / 2 ? i + 1 : i - 1);
  });
  window.addEventListener("hashchange", () => {
    const n = parseInt(location.hash.slice(1), 10);
    if (n && n - 1 !== i) show(n - 1);
  });
  show(i);
})();
