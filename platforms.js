// Nombre de titres dans notre sélection FR vérifiée, pas le catalogue intégral du service.
const platforms = [
  { id: 'netflix', name: 'Netflix', color: '#e50914' },
  { id: 'prime-video', name: 'Prime Video', color: '#00a8e1' },
  { id: 'paramount', name: 'Paramount+', color: '#0064ff' },
  { id: 'disney', name: 'Disney+', color: '#183f94' },
  { id: 'marvel', name: 'Marvel Studios', color: '#ed1d24' }
];
const platformGrid = document.querySelector('#platform-cards');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const touchPointer = window.matchMedia('(hover: none)');
platformGrid.innerHTML = platforms.map(platform => `
  <a href="${platform.id}.html" class="platform-card" style="--platform-color:${platform.color}" aria-label="Explorer l’univers ${platform.name}">
    <span class="platform-fallback" hidden>${platform.name}</span>
    <img class="platform-logo" src="assets/platforms/${platform.id}.png" alt="${platform.name}" decoding="async">
    <video class="platform-preview" data-src="assets/platforms/${platform.id}.mp4" muted loop playsinline preload="none" aria-hidden="true" tabindex="-1" disablepictureinpicture></video>
    <span class="platform-count">${window.MovixPlatformCatalogue?.providers[platform.id]?.itemIds.length ?? '—'} TITRES · SÉLECTION FR</span>
  </a>`).join('');

const platformControllers = [];
platformGrid.querySelectorAll('.platform-card').forEach(card => {
  const video = card.querySelector('video');
  const logo = card.querySelector('img');
  let active = false;
  let generation = 0;
  let hovered = false;
  let focused = false;
  logo.addEventListener('error', () => { logo.hidden = true; card.querySelector('.platform-fallback').hidden = false; });

  function stop() {
    active = false;
    generation += 1;
    card.classList.remove('is-playing', 'is-active');
    video.pause();
    if (video.readyState >= 1) video.currentTime = 0;
  }
  function start() {
    if (active || reducedMotion.matches || document.hidden) return;
    platformControllers.forEach(controller => { if (controller.card !== card) controller.reset(); });
    active = true;
    const request = ++generation;
    card.classList.add('is-active');
    video.muted = true;
    if (!video.getAttribute('src')) video.src = video.dataset.src;
    if (video.readyState >= 1) video.currentTime = 0;
    video.play().then(() => {
      if (active && generation === request) card.classList.add('is-playing');
      else if (!active) video.pause();
    }).catch(() => {
      if (generation === request) stop(); // Le logo reste visible si la lecture échoue.
    });
  }
  function update() { if (hovered || focused) start(); else stop(); }
  function reset() { hovered = false; focused = false; stop(); }
  card.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') { hovered = true; update(); } });
  card.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse') { hovered = false; update(); } });
  card.addEventListener('focus', () => { focused = card.matches(':focus-visible'); update(); });
  card.addEventListener('blur', () => { focused = false; update(); });
  card.addEventListener('click', stop);
  card.addEventListener('keydown', event => {
    if (event.key === 'Escape') reset();
  });
  video.addEventListener('error', stop);
  platformControllers.push({ card, reset });
});
document.addEventListener('visibilitychange', () => { if (document.hidden) platformControllers.forEach(controller => controller.reset()); });
reducedMotion.addEventListener('change', () => platformControllers.forEach(controller => controller.reset()));
document.querySelector('#platform-hint').textContent = touchPointer.matches
  ? 'Touchez une plateforme pour explorer son univers'
  : 'Survolez pour animer · Cliquez pour explorer';
