// An iframe load is not a playback-success signal. Vidmoly has not supplied a
// documented player-events API; do not infer progress or trust postMessage data.
(() => {
  /** @param {unknown} value @returns {value is string} */
  const valid = value => typeof value === 'string' && /^https:\/\/vidmoly\.org\/embed-[a-z0-9]{12}\.html$/.test(value);
  /** @param {HTMLElement} root */
  function create(root) {
    let timer = 0;
    /** @type {HTMLIFrameElement|null} */ let frame = null;
    /** @type {(()=>void)|null} */ let unsubscribe = null;
    /** @param {string} [message] */
    function clear(message = '') {
      clearTimeout(timer);
      unsubscribe?.(); unsubscribe = null;
      frame?.remove(); frame = null; root.replaceChildren();
      if (message) { const text = document.createElement('p'); text.className = 'video-notice'; text.textContent = message; root.append(text); }
    }
    /** @param {string} url @param {string} title */
    function show(url, title) {
      clear();
      if (!valid(url)) { clear('Cette adresse de lecteur n’est pas autorisée.'); return; }
      const screen = document.createElement('div'); screen.className = 'video-screen';
      const status = document.createElement('p'); status.className = 'video-notice'; status.setAttribute('role', 'status');
      status.textContent = 'Ouverture du lecteur externe Vidmoly…';
      const iframe = document.createElement('iframe'); frame = iframe;
      let failed = false;
      iframe.title = 'Lecteur Vidmoly — ' + title;
      iframe.referrerPolicy = 'strict-origin'; iframe.allowFullscreen = true;
      iframe.allow = 'fullscreen; picture-in-picture; encrypted-media';
      // No top-level navigation, popups, forms or downloads from third parties.
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
      iframe.addEventListener('load', () => {
        clearTimeout(timer);
        if (failed) return;
        status.textContent = 'Lecteur externe chargé. Si la vidéo ne démarre pas ou affiche une erreur, réessayez ; les informations de la fiche restent accessibles.';
      });
      iframe.addEventListener('error', () => { failed = true; clearTimeout(timer); status.textContent = 'Le lecteur ne peut pas être chargé. Vérifiez votre connexion ou réessayez plus tard.'; });
      const blocked = (/** @type {SecurityPolicyViolationEvent} */ event) => {
        if (event.violatedDirective === 'frame-src') {
          failed = true; clearTimeout(timer); screen.hidden = true; iframe.remove(); frame = null;
          status.textContent = 'Le lecteur ou sa redirection est bloqué par la sécurité. Vidmoly peut refuser un lecteur isolé. Vous pouvez essayer directement sur Vidmoly ; les informations de la fiche restent disponibles.';
        }
      };
      document.addEventListener('securitypolicyviolation', blocked);
      unsubscribe = () => document.removeEventListener('securitypolicyviolation', blocked);
      timer = window.setTimeout(() => { status.textContent = 'Le lecteur met du temps à répondre. Vous pouvez réessayer ou consulter les autres informations de la fiche.'; }, 15000);
      const external = document.createElement('a'); external.href = url; external.target = '_blank'; external.rel = 'noopener noreferrer'; external.textContent = 'Essayer sur Vidmoly ↗'; external.className = 'video-external';
      iframe.src = url; screen.append(iframe); root.append(screen, status, external);
    }
    return { show, clear };
  }
  window.HessflixVideoPlayer = { create, valid };
})();
