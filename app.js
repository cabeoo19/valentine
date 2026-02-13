(() => {
  const prefersReducedMotion =
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

  // ---------- Utilities ----------
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  function qs(sel, parent = document) {
    const el = parent.querySelector(sel);
    if (!el) throw new Error(`Missing element: ${sel}`);
    return el;
  }

  function qsa(sel, parent = document) {
    return [...parent.querySelectorAll(sel)];
  }

  function setHidden(el, hidden) {
    if (hidden) el.setAttribute("hidden", "");
    else el.removeAttribute("hidden");
  }

  function focusFirstFocusable(container) {
    const focusables = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusables[0];
    if (first) first.focus();
  }

  function trapFocus(modal, event) {
    if (event.key !== "Tab") return;
    const focusables = [
      ...modal.querySelectorAll(
        'button, [href], [tabindex]:not([tabindex="-1"])',
      ),
    ].filter(
      (el) => !el.hasAttribute("disabled") && !el.getAttribute("aria-hidden"),
    );
    if (focusables.length === 0) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;

    if (event.shiftKey) {
      if (active === first || !modal.contains(active)) {
        event.preventDefault();
        last.focus();
      }
      return;
    }

    if (active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // ---------- FX Canvas (confetti/hearts) ----------
  const fxCanvas = document.getElementById("fx");
  const fxCtx = fxCanvas?.getContext?.("2d");
  let fxDpr = 1;
  let fxRunning = false;
  let fxLastTs = 0;

  // Emoji rain (subtle background)
  const rainIcons = ["🍫", "🌹", "💗", "🍬", "✨", "💝", "🍓"];
  const rainDrops = [];
  let rainEnabled = false;

  // Keep the center of the screen mostly clear: icons fall on two side bands.
  function sideBandWidth() {
    return clamp(Math.round(window.innerWidth * 0.22), 140, 280);
  }

  function sideBounds(side) {
    const pad = 10;
    const band = sideBandWidth();
    if (side === "right") {
      return [
        Math.max(pad, window.innerWidth - band + pad),
        window.innerWidth - pad,
      ];
    }
    return [pad, Math.max(pad + 1, band - pad)];
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function desiredRainCount() {
    // Keep it light for performance.
    const byWidth = Math.floor(window.innerWidth / 44);
    return clamp(byWidth, 12, 30);
  }

  function resetDrop(drop, { startAbove = false, keepSide = false } = {}) {
    drop.icon = rainIcons[(Math.random() * rainIcons.length) | 0];
    drop.size = rand(18, 30);
    if (!keepSide || (drop.side !== "left" && drop.side !== "right")) {
      drop.side = Math.random() < 0.5 ? "left" : "right";
    }
    const [minX, maxX] = sideBounds(drop.side);
    drop.x = rand(minX, maxX);
    // Start some drops already on-screen so it's visible immediately.
    drop.y = startAbove
      ? rand(-120, window.innerHeight * 0.35)
      : rand(0, window.innerHeight);
    drop.vy = rand(55, 140);
    drop.vx = rand(-6, 6);
    drop.phase = rand(0, Math.PI * 2);
    drop.vphase = rand(0.8, 1.6);
    drop.alpha = rand(0.22, 0.42);
  }

  function syncRainDrops({ reseed = false } = {}) {
    if (!rainEnabled) return;
    const target = desiredRainCount();
    while (rainDrops.length < target) {
      const d = {};
      // side will be balanced after we reach target
      resetDrop(d, { startAbove: true });
      rainDrops.push(d);
    }
    if (rainDrops.length > target) rainDrops.length = target;

    // Balance sides (difference <= 1) while keeping randomness.
    if (rainDrops.length > 0) {
      const n = rainDrops.length;
      const leftWanted = Math.floor(n / 2);
      const rightWanted = n - leftWanted;
      const sides = [];
      for (let i = 0; i < leftWanted; i++) sides.push("left");
      for (let i = 0; i < rightWanted; i++) sides.push("right");
      shuffleInPlace(sides);

      for (let i = 0; i < n; i++) {
        const d = rainDrops[i];
        d.side = sides[i];
        const [minX, maxX] = sideBounds(d.side);
        if (typeof d.x !== "number" || d.x < minX || d.x > maxX) {
          d.x = rand(minX, maxX);
        }
      }
    }

    if (reseed) {
      for (const d of rainDrops) {
        resetDrop(d, { startAbove: true, keepSide: true });
      }
    }
  }

  function renderFxFrame(dt, advance) {
    if (!fxCtx) return;
    fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);

    // Emoji rain layer (subtle)
    if (rainEnabled && rainDrops.length > 0) {
      fxCtx.save();
      fxCtx.textAlign = "center";
      fxCtx.textBaseline = "middle";

      for (const d of rainDrops) {
        if (advance) {
          d.y += d.vy * dt;
          d.x += d.vx * dt;
          d.phase += d.vphase * dt;

          // Keep within its side band (bounce on edges)
          const [minX, maxX] = sideBounds(d.side || "left");
          if (d.x < minX) {
            d.x = minX;
            d.vx = Math.abs(d.vx);
          }
          if (d.x > maxX) {
            d.x = maxX;
            d.vx = -Math.abs(d.vx);
          }
        }

        // Gentle sway
        const sway = Math.sin(d.phase) * 10;
        const [minX, maxX] = sideBounds(d.side || "left");
        const clampedX = clamp(d.x + sway, minX, maxX);
        const x = clampedX * fxDpr;
        const y = d.y * fxDpr;

        fxCtx.globalAlpha = d.alpha;
        fxCtx.font = `${Math.round(d.size * fxDpr)}px ui-sans-serif, system-ui, "Apple Color Emoji", "Segoe UI Emoji"`;
        fxCtx.fillText(d.icon, x, y);

        if (advance) {
          if (d.y > window.innerHeight + 36) {
            resetDrop(d, { startAbove: true, keepSide: true });
          }
          // no full-width wrap; we keep drops constrained to side bands
        }
      }

      fxCtx.restore();
      fxCtx.globalAlpha = 1;
    }

    for (let i = fxParticles.length - 1; i >= 0; i--) {
      const p = fxParticles[i];
      p.vy += p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.a = Math.max(0, p.a - p.va);

      fxCtx.globalAlpha = p.a;
      fxCtx.fillStyle = p.color;
      const px = p.x * fxDpr;
      const py = p.y * fxDpr;
      if (p.kind === "heart") {
        drawHeart(fxCtx, px, py, p.r * 2.6 * fxDpr, p.color, p.rot);
      } else {
        fxCtx.save();
        fxCtx.translate(px, py);
        fxCtx.rotate(p.rot);
        fxCtx.fillRect(
          -p.r * fxDpr,
          -p.r * fxDpr,
          p.r * 2.2 * fxDpr,
          p.r * 1.4 * fxDpr,
        );
        fxCtx.restore();
      }

      if (p.a <= 0 || p.y > window.innerHeight + 120) {
        fxParticles.splice(i, 1);
      }
    }

    fxCtx.globalAlpha = 1;
  }

  function resizeFx() {
    if (!fxCanvas || !fxCtx) return;
    fxDpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    fxCanvas.width = Math.floor(window.innerWidth * fxDpr);
    fxCanvas.height = Math.floor(window.innerHeight * fxDpr);
    fxCanvas.style.width = "100%";
    fxCanvas.style.height = "100%";

    // Keep rain density consistent after resize.
    syncRainDrops();
  }
  window.addEventListener("resize", resizeFx, { passive: true });
  resizeFx();

  const fxParticles = [];

  function spawnConfetti({ x, y, count = 90, spread = 3.6 }) {
    if (!fxCtx || prefersReducedMotion) return;
    const palette = ["#E63946", "#FF7FA3", "#FFD9A6", "#FFFFFF"];
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = (1.2 + Math.random() * 4.0) * spread;
      fxParticles.push({
        kind: Math.random() < 0.18 ? "heart" : "rect",
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 2.0 * spread,
        g: 0.12 * spread,
        r: 2 + Math.random() * 4,
        rot: Math.random() * Math.PI * 2,
        vr: (-0.12 + Math.random() * 0.24) * spread,
        a: 1,
        va: 0.012 + Math.random() * 0.02,
        color: palette[(Math.random() * palette.length) | 0],
      });
    }
  }

  function drawHeart(ctx, x, y, size, color, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(size / 10, size / 10);
    ctx.beginPath();
    ctx.moveTo(0, 3);
    ctx.bezierCurveTo(-6, -3, -10, 0, -10, 4);
    ctx.bezierCurveTo(-10, 10, -2, 12, 0, 16);
    ctx.bezierCurveTo(2, 12, 10, 10, 10, 4);
    ctx.bezierCurveTo(10, 0, 6, -3, 0, 3);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  function startFxLoop() {
    if (!fxCtx) return;
    if (fxRunning) return;
    fxRunning = true;
    fxLastTs = performance.now();
    requestAnimationFrame(fxTick);
  }

  function fxTick(ts) {
    if (!fxCtx) return;
    const dtMs = clamp(ts - fxLastTs, 0, 34);
    fxLastTs = ts;
    const dt = dtMs / 1000;

    renderFxFrame(dt, true);

    if ((rainEnabled && rainDrops.length > 0) || fxParticles.length > 0) {
      requestAnimationFrame(fxTick);
    } else {
      fxRunning = false;
    }
  }

  function ensureFxLoop() {
    if (!fxCtx) return;
    startFxLoop();
  }

  // Start emoji rain by default.
  // Animate continuously (user wants repeating falling icons).
  // Confetti/sounds still respect prefersReducedMotion via their own guards.
  if (fxCtx) {
    rainEnabled = true;
    syncRainDrops({ reseed: true });
    startFxLoop();
  }

  // ---------- Sound (optional, tiny) ----------
  let audioCtx;
  function clickSound(freq = 740, dur = 0.03, gain = 0.06) {
    if (prefersReducedMotion) return;
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      const t0 = audioCtx.currentTime;
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "square";
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.01);
    } catch {
      // ignore
    }
  }

  // ---------- Section 1: Chocolate modal ----------
  const chocolateMessages = [
    "Happy Valentine! Em là thanh socola ngọt nhất trên cuộc đời này đó hihi.",
    "Mỗi ngày bên em là anh lại đc thêm 1 viên socola ngọt ngào.",
    "Em làm tim mình tan chảy <3",
    "Cảm ơn em vì luôn ở đây với anh.",
    "Gửi em một nụ hunn và một cái ôm.",
    "Chúc em Valentine năm nào cx có anh hihi!",
    "Sự đáng iuu của em ... 💥💥💥",
    "Hãy cùng nhau ăn hết hộp này nhé :)💥💥💥",
    "Moazz moazz!",
    "Yêu em nhiều.",
  ];

  const chocoButtons = qsa(".choco__piece");
  const chocoModal = qs("#chocoModal");
  const chocoMsg = qs("#chocoMsg");
  const chocoGif = qs("#chocoGif");
  const chocoClose = qs("#chocoClose");
  let chocoIndex = 0;
  let lastActive = null;

  // Optional: Use Giphy GIFs per chocolate.
  // Paste either:
  // - the Giphy *page* URL (example: https://giphy.com/gifs/... ) OR
  // - a direct GIF URL (example: https://media*.giphy.com/media/.../giphy.gif)
  // If a slot is empty or resolution fails, it falls back to local lightweight SVG.
  const chocoGiphyPageUrls = [
    "https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExajQwcDhzdTFzZm82NXhjd2t4aXZlZmQ2ZjdtencwdGg3b3I5bnQ1ZiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/D2t94jSqtrVe0/giphy.gif",
    "https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExY29tNTFrZXcwMDRybjI4NHlrcnl0YTJ6MHc4a3Bic2h1cHEzYjJxMyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/k6SImaefvartv71xUc/giphy.gif",
    "https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExMHJoc28xbGpsbDNlYXY0OWxwY3RiN21oOWVzd3M3NXFsc2pwdzB3ZiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/d37mEpcaGP3pudPoho/giphy.gif",
    "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExeXVpdTk2dHVnNm1lZ291ODM3Ymg2bXg5dnozbGdvaHI5Njg1MHUyZSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/KEf7gXqvQ8B3SWnUid/giphy.gif",
    "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExbXVtN2lvNnNlZ21lbGlodDAyMTVmMDFtbmd3YzA0MWd1NGM4aXQwYiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/DdJ9RsY88uBarMvVsb/giphy.gif",
    "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExejY1bW4xNDFiNTU2MHo5bWNrcTh5OWZuMzVlaDF2c2JmbGdiZDNqNCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/nE59vl2e7rWzbskQZ9/giphy.gif",
    "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExNmtvbGM1NzNhdzB1ajFoYTZhend1eTl1MmR0dWxscDh3eGRnZDRsOCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/5aLrlDiJPMPFS/giphy.gif",
    "https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExYWY0Zmp2ZnQxYXduYmIyYWF5Z2Z6czBlbDF0cHdybTV6Mjd5Y2ozdSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/Xxe4icuwQFnlCKJRgB/giphy.gif",
    "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExbG1qczlxNDNzdGZqejhyNHIyZG4xdWVkNjF1c2JxYm9jbGhua2MzeCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/R26ERFVcOuANi3EWfT/giphy.gif",
    "https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExNTB5Nmp5anI3ZjZiNG1kMDBzeGIzNjN4OTJ0cnlraWRhYmtqd2g2NSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/l5HeyboYQp9zdzkrq2/giphy.gif",
  ];

  const chocoGifs = [
    "assets/choco-0.svg",
    "assets/choco-1.svg",
    "assets/choco-2.svg",
    "assets/choco-3.svg",
    "assets/choco-4.svg",
    "assets/choco-5.svg",
    "assets/choco-6.svg",
    "assets/choco-7.svg",
    "assets/choco-8.svg",
    "assets/choco-9.svg",
  ];

  function preloadImage(url) {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
  }

  // Preload very lightly (SVGs are tiny), but only after first interaction.
  let chocoPreloaded = false;

  const giphyResolvedCache = new Map();
  let chocoOpenToken = 0;

  async function resolveGiphyDirectImageUrl(giphyPageUrl) {
    if (!giphyPageUrl) return null;
    if (giphyResolvedCache.has(giphyPageUrl)) {
      return giphyResolvedCache.get(giphyPageUrl);
    }

    // If user provided a direct image URL, use it as-is.
    if (/\.(gif|webp|png|jpg|jpeg)(\?.*)?$/i.test(giphyPageUrl)) {
      giphyResolvedCache.set(giphyPageUrl, giphyPageUrl);
      return giphyPageUrl;
    }

    try {
      const endpoint = `https://giphy.com/services/oembed?url=${encodeURIComponent(giphyPageUrl)}`;
      const res = await fetch(endpoint, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        cache: "force-cache",
      });
      if (!res.ok) throw new Error(`oEmbed failed: ${res.status}`);
      const data = await res.json();
      const url =
        typeof data?.thumbnail_url === "string" ? data.thumbnail_url : null;
      // Giphy's oEmbed thumbnail_url is typically an animated .gif on media.giphy.com.
      if (!url) throw new Error("Missing thumbnail_url");
      giphyResolvedCache.set(giphyPageUrl, url);
      return url;
    } catch {
      giphyResolvedCache.set(giphyPageUrl, null);
      return null;
    }
  }

  function selectChocolate(index) {
    chocoButtons.forEach((b) => b.removeAttribute("data-selected"));
    const btn = chocoButtons[index];
    if (btn) btn.setAttribute("data-selected", "true");
  }

  function openChocoModal(index) {
    chocoIndex = clamp(index, 0, chocolateMessages.length - 1);
    lastActive = document.activeElement;
    selectChocolate(chocoIndex);

    chocoMsg.textContent = chocolateMessages[chocoIndex];
    const token = ++chocoOpenToken;
    const fallback = chocoGifs[chocoIndex] || "assets/heart-loop.svg";
    chocoGif.setAttribute("src", fallback);

    const giphyPageUrl = chocoGiphyPageUrls[chocoIndex];
    if (giphyPageUrl) {
      resolveGiphyDirectImageUrl(giphyPageUrl).then((directUrl) => {
        if (token !== chocoOpenToken) return; // user opened another chocolate
        if (directUrl) chocoGif.setAttribute("src", directUrl);
      });
    }

    if (!chocoPreloaded) {
      chocoPreloaded = true;
      // Defer preloading to avoid blocking the initial render.
      const warmup = async () => {
        chocoGifs.forEach(preloadImage);
        // Resolve & preload giphy URLs (only if provided)
        for (const url of chocoGiphyPageUrls) {
          if (!url) continue;
          const direct = await resolveGiphyDirectImageUrl(url);
          if (direct) preloadImage(direct);
        }
      };
      if ("requestIdleCallback" in window) {
        window.requestIdleCallback(() => {
          warmup();
        });
      } else {
        setTimeout(() => {
          warmup();
        }, 80);
      }
    }

    setHidden(chocoModal, false);
    document.body.style.overflow = "hidden";
    focusFirstFocusable(chocoModal);
  }

  function closeChocoModal() {
    setHidden(chocoModal, true);
    document.body.style.overflow = "";
    chocoButtons.forEach((b) => b.removeAttribute("data-selected"));
    chocoOpenToken++;
    if (lastActive && lastActive.focus) lastActive.focus();
  }

  chocoButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = Number(btn.getAttribute("data-choco") || 0);
      openChocoModal(index);
    });
  });

  chocoClose.addEventListener("click", closeChocoModal);
  chocoModal.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.getAttribute && t.getAttribute("data-close") === "true")
      closeChocoModal();
  });
  document.addEventListener("keydown", (e) => {
    if (!chocoModal.hasAttribute("hidden")) {
      if (e.key === "Escape") closeChocoModal();
      trapFocus(chocoModal, e);
    }
  });

  // ---------- Section 2: YES/NO deterministic game ----------
  const yesBtn = qs("#yesBtn");
  const noBtn = qs("#noBtn");
  const loveQuestion = qs("#loveQuestion");
  const loveSub = qs("#loveSub");
  const loveAfter = qs("#loveAfter");
  const shareBtn = qs("#shareBtn");
  const a11yLive = qs("#a11yLive");

  const noTexts = [
    "Are you sure???",
    "thinkk!!!",
    "stopppp",
    "aaaaaaaaa",
    "pleaseee?",
    "last chance!",
    "ok fine…",
  ]; // deterministic cycle
  let noClicks = 0;
  let yesScale = 1;
  let noScale = 1;
  let loveLocked = false;

  function applyButtonScales() {
    yesBtn.style.transform = `scale(${yesScale})`;
    noBtn.style.transform = `scale(${noScale})`;
  }

  function checkCovered() {
    const yesRect = yesBtn.getBoundingClientRect();
    const noRect = noBtn.getBoundingClientRect();
    const covered =
      yesRect.left <= noRect.left &&
      yesRect.top <= noRect.top &&
      yesRect.right >= noRect.right &&
      yesRect.bottom >= noRect.bottom;

    if (covered) {
      noBtn.disabled = true;
      noBtn.style.opacity = "0";
      noBtn.style.pointerEvents = "none";
      a11yLive.textContent = "NO đã biến mất.";
    }
  }

  noBtn.addEventListener("click", () => {
    if (loveLocked || noBtn.disabled) return;
    noClicks++;

    clickSound(620, 0.03, 0.05);
    noBtn.classList.remove("no-shake");
    // trigger reflow to restart animation
    void noBtn.offsetWidth;
    noBtn.classList.add("no-shake");

    yesScale = clamp(yesScale * 1.08, 1, 3.2);
    noScale = clamp(noScale * 0.92, 0.18, 1);

    const text = noTexts[(noClicks - 1) % noTexts.length];
    noBtn.textContent = text;
    a11yLive.textContent = `NO: ${text}`;

    applyButtonScales();
    // wait a tick for transforms to apply before bbox check
    requestAnimationFrame(checkCovered);
  });

  yesBtn.addEventListener("click", () => {
    if (loveLocked) return;
    loveLocked = true;
    loveQuestion.textContent = "Hihi A cũm iu em moazz";
    loveSub.textContent = "";
    a11yLive.textContent = "Đã chọn YES.";

    setHidden(loveAfter, false);
    yesBtn.disabled = true;
    noBtn.disabled = true;
    noBtn.style.opacity = "0";

    const r = yesBtn.getBoundingClientRect();
    spawnConfetti({
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
      count: 160,
      spread: 3.8,
    });
    ensureFxLoop();
  });

  shareBtn.addEventListener("click", async () => {
    const text = "Hihi A cũm iu em moazz";
    try {
      await navigator.clipboard.writeText(text);
      a11yLive.textContent = "Đã copy nội dung để share.";
    } catch {
      a11yLive.textContent = "Không copy được trên trình duyệt này.";
    }
  });

  // ---------- Section 3: Rigged wheel (always Túi sách) ----------
  const wheelDisc = qs("#wheelDisc");
  const spinBtn = qs("#spinBtn");
  const prizeModal = qs("#prizeModal");
  const prizeClose = qs("#prizeClose");
  const claimBtn = qs("#claimBtn");

  const sectorCount = 5;
  const sectorSize = 360 / sectorCount;
  const prizeIndex = 2; // 0 Ô tô, 1 Xe cút kít, 2 Túi sách, 3 iPhone 19, 4 1 căn nhà
  let wheelRotation = 0;
  let spinning = false;

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function easeInCubic(t) {
    return t * t * t;
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function easeOutPower(t, p = 6) {
    // Monotonic deceleration: speed continuously decreases as t increases.
    return 1 - Math.pow(1 - t, p);
  }

  function spinProfile(t) {
    // accel -> cruise -> decel (looks more dramatic than pure easeInOut)
    const accelT = 0.18;
    const cruiseT = 0.72;
    const accelP = 0.12;
    const cruiseP = 0.86;

    if (t <= 0) return 0;
    if (t >= 1) return 1;
    if (t < accelT) {
      const u = t / accelT;
      return accelP * easeInCubic(u);
    }
    if (t < cruiseT) {
      const u = (t - accelT) / (cruiseT - accelT);
      return accelP + (cruiseP - accelP) * u;
    }
    const u = (t - cruiseT) / (1 - cruiseT);
    return cruiseP + (1 - cruiseP) * easeOutCubic(u);
  }

  function setWheelRotation(deg) {
    wheelRotation = deg;
    wheelDisc.style.transform = `rotate(${deg}deg)`;
  }

  function openPrizeModal() {
    setHidden(prizeModal, false);
    document.body.style.overflow = "hidden";
    focusFirstFocusable(prizeModal);
  }

  function closePrizeModal() {
    setHidden(prizeModal, true);
    document.body.style.overflow = "";
    spinBtn.focus();
  }

  prizeClose.addEventListener("click", closePrizeModal);
  claimBtn.addEventListener("click", () => {
    const r = claimBtn.getBoundingClientRect();
    spawnConfetti({
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
      count: 120,
      spread: 3.1,
    });
    ensureFxLoop();
    closePrizeModal();
  });

  prizeModal.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.getAttribute && t.getAttribute("data-close") === "true")
      closePrizeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (!prizeModal.hasAttribute("hidden")) {
      if (e.key === "Escape") closePrizeModal();
      trapFocus(prizeModal, e);
    }
  });

  function sectorCenterAngle(index) {
    return index * sectorSize + sectorSize / 2;
  }

  function computeRiggedStopAngle() {
    // We want the "Túi sách" sector to end under the pointer at top.
    // If sector 0 is centered at top when rotation=0, then we need rotation such that:
    // (rotation + centerAngle(prize)) % 360 == 0  => rotation == 360 - centerAngle(prize)
    const center = sectorCenterAngle(prizeIndex);
    const within = Math.random() * (sectorSize * 0.6) - sectorSize * 0.3; // keep inside sector
    return (360 - (center + within) + 360) % 360;
  }

  function playTickIfCrossed(prevDeg, nextDeg) {
    // Tick every time a sector boundary is crossed.
    const prev = Math.floor((((prevDeg % 360) + 360) % 360) / sectorSize);
    const next = Math.floor((((nextDeg % 360) + 360) % 360) / sectorSize);
    if (prev !== next) clickSound(980, 0.015, 0.045);
  }

  function animateWheelTo(targetDeg, durationMs = 4200) {
    return new Promise((resolve) => {
      const start = performance.now();
      const from = wheelRotation;
      const to = targetDeg;
      let prev = from;

      const step = (now) => {
        const t = clamp((now - start) / durationMs, 0, 1);
        const eased = prefersReducedMotion ? t : spinProfile(t);
        const deg = from + (to - from) * eased;
        setWheelRotation(deg);
        if (!prefersReducedMotion) playTickIfCrossed(prev, deg);
        prev = deg;

        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };

      requestAnimationFrame(step);
    });
  }

  function animateWheelToWithEasing(targetDeg, durationMs, easingFn) {
    return new Promise((resolve) => {
      const start = performance.now();
      const from = wheelRotation;
      const to = targetDeg;
      let prev = from;

      const step = (now) => {
        const t = clamp((now - start) / durationMs, 0, 1);
        const eased = prefersReducedMotion ? t : easingFn(t);
        const deg = from + (to - from) * eased;
        setWheelRotation(deg);
        if (!prefersReducedMotion) playTickIfCrossed(prev, deg);
        prev = deg;

        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };

      requestAnimationFrame(step);
    });
  }

  spinBtn.addEventListener("click", async () => {
    if (spinning) return;
    spinning = true;
    spinBtn.disabled = true;
    wheelDisc.classList.add("is-spinning");

    const finalOffset = computeRiggedStopAngle();
    // Slower overall spin (user preference): fewer revs + longer timing.
    const extraSpins = 7 + Math.floor(Math.random() * 3);
    const currentMod = ((wheelRotation % 360) + 360) % 360;
    const deltaToOffset = (finalOffset - currentMod + 360) % 360;
    const targetFinal = wheelRotation + extraSpins * 360 + deltaToOffset;

    if (prefersReducedMotion) {
      await animateWheelToWithEasing(targetFinal, 2500, (t) =>
        easeOutPower(t, 4),
      );
    } else {
      // Single-phase: continuously slows down until stop (no cruise).
      const totalDegrees = Math.max(0, targetFinal - wheelRotation);
      // Tune for a clearly "slow down more and more" feel.
      const durationMs = clamp((totalDegrees / 360) * 2400, 14000, 26000);
      await animateWheelToWithEasing(targetFinal, durationMs, (t) =>
        easeOutPower(t, 7),
      );
    }

    // Snap exactly to the final angle (avoid any perceived drift).
    setWheelRotation(targetFinal);
    wheelDisc.classList.remove("is-spinning");

    // Show result ONLY after the wheel has clearly stopped and the final frame is painted.
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    if (!prefersReducedMotion) {
      // A clearer "settle" pause so users see the wheel stop first.
      await new Promise((resolve) => setTimeout(resolve, 650));
    }

    // Always wins "Túi sách"
    openPrizeModal();
    const r = wheelDisc.getBoundingClientRect();
    spawnConfetti({
      x: r.left + r.width / 2,
      y: r.top + 40,
      count: 140,
      spread: 3.6,
    });
    ensureFxLoop();

    spinning = false;
    spinBtn.disabled = false;
  });

  // ---------- Small a11y/perf touches ----------
  // Prevent iOS overscroll glow from feeling janky.
  document.addEventListener(
    "touchmove",
    () => {
      // no-op (keeps passive behavior)
    },
    { passive: true },
  );
})();
