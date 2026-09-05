(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 打字机 ---------- */
  var typed = document.getElementById("typed");
  if (typed) {
    var text = "./explore --curiosity";
    if (reduced) {
      typed.textContent = text;
    } else {
      var i = 0;
      (function step() {
        typed.textContent = text.slice(0, ++i);
        if (i < text.length) {
          setTimeout(step, 55 + Math.random() * 55);
        }
      })();
    }
  }

  /* ---------- 滚动渐显 ---------- */
  var items = document.querySelectorAll(".reveal");
  if (reduced || !("IntersectionObserver" in window)) {
    items.forEach(function (el) { el.classList.add("in"); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
  items.forEach(function (el) { io.observe(el); });
})();
