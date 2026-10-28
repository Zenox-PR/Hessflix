(() => {
  /** @type {Set<{clear(message?:string):void}>} */ const previews = new Set();
  function clear() { for (const preview of previews) preview.clear(); previews.clear(); }
  document.addEventListener('close', clear, true);
  /** @param {HTMLElement} root @param {import('./types/contracts').VideoEditorOptions} options */
  function mount(root, options) {
    root.replaceChildren(); root.className = 'admin-video-panel';
    const heading = document.createElement('h4'); heading.textContent = 'Vidéo Vidmoly';
    const state = document.createElement('p'); state.className = 'catalogue-hint';
    const video = options.state;
    state.textContent = video?.approved ? 'Vidéo validée. Visible uniquement si la fiche, la saison et l’épisode concernés sont publiés.' : video?.draft ? 'Brouillon vidéo enregistré, pas encore validé pour le public.' : 'Aucune vidéo configurée.';
    if (video?.draft && video.approved?.embedURL !== video.draft.embedURL) state.append(' Le brouillon est différent de la version publique.');
    const label = document.createElement('label'); label.textContent = 'Lien d’intégration Vidmoly (.org)';
    const url = document.createElement('input'); url.type = 'url'; url.maxLength = 200; url.placeholder = 'https://vidmoly.org/embed-xxxxxxxxxxxx.html'; url.setAttribute('aria-label', 'Lien vidéo Vidmoly');
    url.value = video?.draft?.embedURL || video?.approved?.embedURL || ''; label.append(url);
    const rightsLabel = document.createElement('label'); rightsLabel.className = 'admin-checkbox';
    const rights = document.createElement('input'); rights.type = 'checkbox'; rights.checked = !!(video?.draft?.rightsConfirmed || video?.approved?.rightsConfirmed);
    rightsLabel.append(rights, document.createTextNode('Je suis autorisé à diffuser cette vidéo.'));
    const hint = document.createElement('p'); hint.className = 'catalogue-hint'; hint.textContent = 'Enregistrer garde un brouillon privé. Vérifier ouvre le lecteur tiers sans publier. Valider remplace explicitement la vidéo publique ; retirer efface uniquement l’association, jamais le fichier chez Vidmoly.';
    const feedback = document.createElement('p'); feedback.className = 'video-editor-feedback video-notice'; feedback.setAttribute('role', 'status');
    const actions = document.createElement('div'); actions.className = 'video-controls';
    const previewRoot = document.createElement('div'); previewRoot.hidden = true;
    const preview = window.HessflixVideoPlayer?.create(previewRoot);
    if (preview) previews.add(preview);
    let busy = false;
    const errors = /** @type {Record<string,string>} */ ({ VIDEO_INVALID_URL: 'Utilisez un lien https://vidmoly.org/embed- suivi de 12 lettres/chiffres minuscules et .html, sans paramètres ni code HTML.', VIDEO_RIGHTS_REQUIRED: 'Confirmez votre autorisation de diffusion.', VIDEO_DRAFT_REQUIRED: 'Enregistrez d’abord le brouillon vidéo.' });
    /** @param {string} name @param {()=>Promise<void>} action */
    function button(name, action) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = name;
      button.addEventListener('click', async () => {
        if (busy) return; busy = true; actions.querySelectorAll('button').forEach(node => node.disabled = true);
        try { feedback.textContent = 'Vérification par le serveur…'; await action(); }
        catch (error) { const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''; feedback.textContent = errors[code] || (error instanceof Error ? error.message : 'Opération impossible. Réessayez.'); }
        finally { busy = false; actions.querySelectorAll('button').forEach(node => node.disabled = false); }
      }); actions.append(button); return button;
    }
    const api = () => { if (!window.HessflixAdminCatalogue) throw new Error('Administration indisponible. Rechargez la page.'); return window.HessflixAdminCatalogue; };
    /** @param {string} suffix @param {string} method @param {Record<string,unknown>} [body] */
    async function change(suffix, method, body = {}) {
      await api().request(options.path + suffix, method, { version: options.version(), ...body });
      preview?.clear(); await options.changed();
    }
    button('Enregistrer le brouillon vidéo', () => change('', 'PUT', { url: url.value, rightsConfirmed: rights.checked }));
    button('Vérifier le lecteur', async () => {
      const result = /** @type {{embedURL:string}} */ (await api().request('/api/admin/catalogue/video-preview', 'POST', { url: url.value, rightsConfirmed: rights.checked }));
      clear(); if (preview) previews.add(preview);
      previewRoot.hidden = false; preview?.show(result.embedURL, 'Aperçu privé'); feedback.textContent = 'Aperçu privé : aucune publication effectuée. Vérifiez vous-même la lecture et l’adéquation avec cet épisode ou ce film.';
    });
    button('Valider la vidéo', async () => { if (window.confirm('Rendre ce brouillon vidéo disponible lorsque le contenu correspondant est publié ?')) await change('/publish', 'POST'); });
    button('Retirer la vidéo', async () => { if (window.confirm('Retirer le brouillon et la vidéo validée de cette fiche, sans supprimer le fichier Vidmoly ?')) await change('', 'DELETE'); });
    button('Fermer l’aperçu', async () => { preview?.clear(); previewRoot.hidden = true; feedback.textContent = 'Aperçu fermé.'; });
    root.append(heading, state, label, rightsLabel, hint, actions, feedback, previewRoot);
  }
  window.HessflixAdminVideo = { mount, clear };
})();
