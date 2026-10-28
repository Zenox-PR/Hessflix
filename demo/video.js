(() => {
  window.HessflixTitleVideo = { mount() {
    const section = document.getElementById('video-section');
    if (!section) return;
    section.hidden = false;
    document.getElementById('video-selection').textContent = 'Aucune vidéo diffusée dans cette démonstration.';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'title-primary'; button.textContent = 'Essayer le bouton de lecture';
    const message = document.createElement('p'); message.setAttribute('role', 'status');
    button.addEventListener('click', () => { message.textContent = 'Lecture indisponible dans cette démonstration. Vous pouvez explorer la fiche et les épisodes.'; });
    document.getElementById('video-controls').append(button);
    document.getElementById('video-mount').append(message);
  } };
})();
