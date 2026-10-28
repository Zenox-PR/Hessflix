/* Lumière diffuse : inertie légère, aucune boucle d'animation au repos. */
(() => {
  const body = document.body;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const staticScreen = matchMedia('(max-width: 650px), (hover: none), (pointer: coarse)');
  const position = {
    x: innerWidth * .6, y: innerHeight * .35,
    targetX: innerWidth * .6, targetY: innerHeight * .35
  };
  let frameId = null;
  let lastFrame = 0;
  let inPage = true;

  const canFollow = () => !reduceMotion.matches && !staticScreen.matches;
  const canAnimate = () => canFollow() && !document.hidden && inPage;

  function paint() {
    body.style.setProperty('--ambient-x', position.x.toFixed(2) + 'px');
    body.style.setProperty('--ambient-y', position.y.toFixed(2) + 'px');
  }

  function stop(state) {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    lastFrame = 0;
    body.dataset.ambientMotion = state;
  }

  function frame(timestamp) {
    frameId = null;
    if (!canAnimate()) {
      stop('suspended');
      return;
    }
    const delta = lastFrame ? Math.min(timestamp - lastFrame, 64) : 1000 / 60;
    lastFrame = timestamp;
    const ease = 1 - Math.exp(-delta / 150);
    position.x += (position.targetX - position.x) * ease;
    position.y += (position.targetY - position.y) * ease;
    const settled = Math.abs(position.targetX - position.x) < .2 &&
      Math.abs(position.targetY - position.y) < .2;
    if (settled) {
      position.x = position.targetX;
      position.y = position.targetY;
    }
    paint();
    if (settled) stop('idle');
    else frameId = requestAnimationFrame(frame);
  }

  function follow() {
    if (!canAnimate() || frameId !== null) return;
    body.dataset.ambientMotion = 'tracking';
    lastFrame = 0;
    frameId = requestAnimationFrame(frame);
  }

  function sync() {
    if (!canFollow()) {
      stop(reduceMotion.matches ? 'reduced' : 'static');
      body.style.removeProperty('--ambient-x');
      body.style.removeProperty('--ambient-y');
      return;
    }
    stop(document.hidden || !inPage ? 'suspended' : 'idle');
    position.x = position.targetX = Math.max(0, Math.min(innerWidth, position.x));
    position.y = position.targetY = Math.max(0, Math.min(innerHeight, position.y));
    paint();
  }

  window.addEventListener('pointermove', event => {
    if (!canAnimate() || event.pointerType === 'touch') return;
    position.targetX = Math.max(0, Math.min(innerWidth, event.clientX));
    position.targetY = Math.max(0, Math.min(innerHeight, event.clientY));
    follow();
  }, { passive: true });

  window.addEventListener('resize', () => {
    position.x = position.targetX = innerWidth * .6;
    position.y = position.targetY = innerHeight * .35;
    sync();
  }, { passive: true });
  window.addEventListener('blur', () => stop('suspended'));
  window.addEventListener('focus', sync);
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pagehide', () => { inPage = false; sync(); });
  window.addEventListener('pageshow', () => { inPage = true; sync(); });
  reduceMotion.addEventListener('change', sync);
  staticScreen.addEventListener('change', sync);
  sync();
})();
