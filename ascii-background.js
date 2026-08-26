import { renderNoiseBackground } from "./vendor/asciify-engine.js";

const consoleElement = document.querySelector("#console");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const frameInterval = 1000 / 15;
const preferenceKey = "decisive.asciiBackgroundEnabled";
const renderOptions = {
  color: "#a0a0a0",
  accentColor: "#d2d2d2",
  chars: " .,:;+=xX#%@",
  fontSize: 16,
  octaves: 2,
  scale: 0.52,
  speed: 2.15,
  accentThreshold: 0.9,
  mouseWarp: 0
};

let stopBackground = () => {};
let backgroundEnabled = true;

try {
  backgroundEnabled = localStorage.getItem(preferenceKey) !== "false";
} catch {}

const mountBackground = () => {
  stopBackground();

  if (!consoleElement || !backgroundEnabled || reducedMotion.matches) return;

  const canvas = document.createElement("canvas");
  canvas.className = "ascii-canvas";
  canvas.style.opacity = "0.36";
  consoleElement.prepend(canvas);

  const context = canvas.getContext("2d", {
    alpha: true,
    desynchronized: true
  });

  if (!context) {
    canvas.remove();
    return;
  }

  let width = 1;
  let height = 1;
  let frameId = 0;
  let loopRunning = false;
  let lastFrame = -Infinity;
  const startTime = performance.now();

  const resize = () => {
    const rect = consoleElement.getBoundingClientRect();
    const dpr = 1;

    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    canvas.width = Math.max(1, Math.ceil(width * dpr));
    canvas.height = Math.max(1, Math.ceil(height * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const resizeObserver = new ResizeObserver(resize);

  const stopLoop = () => {
    if (!loopRunning) return;
    loopRunning = false;
    cancelAnimationFrame(frameId);
  };

  const draw = (timestamp) => {
    if (timestamp - lastFrame >= frameInterval) {
      lastFrame = timestamp;
      renderNoiseBackground(
        context,
        width,
        height,
        (timestamp - startTime) / 1000,
        undefined,
        renderOptions
      );
    }

    frameId = requestAnimationFrame(draw);
  };

  const startLoop = () => {
    if (loopRunning || document.hidden || !document.hasFocus()) return;
    loopRunning = true;
    frameId = requestAnimationFrame(draw);
  };

  const handleVisibilityChange = () => {
    lastFrame = -Infinity;
    if (document.hidden) stopLoop();
    else startLoop();
  };

  const handleFocus = () => {
    lastFrame = -Infinity;
    startLoop();
  };

  const handleBlur = () => stopLoop();

  resizeObserver.observe(consoleElement);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("focus", handleFocus);
  window.addEventListener("blur", handleBlur);
  resize();
  startLoop();

  stopBackground = () => {
    stopLoop();
    resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("focus", handleFocus);
    window.removeEventListener("blur", handleBlur);
    canvas.remove();
    stopBackground = () => {};
  };
};

mountBackground();
const handlePreferenceChange = (event) => {
  backgroundEnabled = event.detail?.enabled !== false;
  mountBackground();
};
window.addEventListener("decisive:ascii-background", handlePreferenceChange);
reducedMotion.addEventListener("change", mountBackground);
window.addEventListener("pagehide", () => {
  stopBackground();
  window.removeEventListener("decisive:ascii-background", handlePreferenceChange);
  reducedMotion.removeEventListener("change", mountBackground);
}, { once: true });
