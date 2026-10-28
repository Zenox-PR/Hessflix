// Récupération explicite des images publiques ; aucun identifiant Firebase nécessaire.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const repository = 'movixstream/MovixOpenSource';
const prefix = 'public/avatars/';
const labels = {
  aot: 'L’Attaque des Titans', bananya: 'Bananya', black_butler: 'Black Butler',
  bbt: 'The Big Bang Theory', disney: 'Disney', disney_channel: 'Disney Channel',
  disney_classics: 'Les classiques Disney', disney_princess: 'Les princesses Disney',
  ice_age: 'L’Âge de glace', kids: 'Pour les petits', marvel: 'Marvel', mickey: 'Mickey',
  mickey_and_friends: 'Mickey et ses amis', pixar: 'Pixar', simpsons: 'Les Simpson',
  the_simpsons: 'Les Simpson', starwars: 'Star Wars', star_wars: 'Star Wars'
};
function title(value) {
  return labels[value] || value.replace(/[_-]+/g, ' ').replace(/\b\p{L}/gu, letter => letter.toLocaleUpperCase('fr'));
}
async function main() {
  const response = await fetch(`https://api.github.com/repos/${repository}/git/trees/main?recursive=1`, { headers: { 'User-Agent': 'Movix-avatar-catalogue' } });
  if (!response.ok) throw new Error(`Catalogue GitHub indisponible (${response.status})`);
  const tree = await response.json();
  if (tree.truncated || !/^[a-f0-9]{40}$/.test(tree.sha)) throw new Error('Arbre GitHub incomplet');
  const entries = tree.tree.filter(entry => entry.type === 'blob' && entry.path.startsWith(prefix) && entry.path.endsWith('.png'));
  const categories = [
    { id: 'crunchyroll', name: 'Crunchyroll', groups: [] }, { id: 'disney-plus', name: 'Disney+', groups: [] },
    { id: 'hbo', name: 'HBO', groups: [] }, { id: 'netflix', name: 'Netflix', groups: [] },
    { id: 'prime-video', name: 'Prime Video', groups: [] }, { id: 'classiques', name: 'Classiques', groups: [] }
  ];
  const categoryIds = { crunchyroll: 'crunchyroll', 'disney+': 'disney-plus', hbo: 'hbo', netflix: 'netflix', prime_video: 'prime-video' };
  let downloaded = 0;
  let cursor = 0;
  function blobHash(buffer) { return crypto.createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex'); }
  async function worker() {
    while (cursor < entries.length) {
      const entry = entries[cursor++];
      const relative = entry.path.slice(prefix.length);
      const parts = relative.split('/');
      if (parts.some(part => part === '.' || part === '..' || /[\\\0]/.test(part))) throw new Error('Chemin d’image invalide');
      const destination = path.resolve(root, 'assets', 'avatars', ...parts);
      const assetRoot = path.join(root, 'assets', 'avatars') + path.sep;
      if (!destination.startsWith(assetRoot)) throw new Error('Destination hors des avatars');
      const previous = path.resolve(root, '..', 'Images_MovixOpenSource', 'public', 'avatars', ...parts);
      let buffer;
      for (const candidate of [destination, previous]) {
        if (fs.existsSync(candidate)) {
          const cached = fs.readFileSync(candidate);
          if (blobHash(cached) === entry.sha) { buffer = cached; break; }
        }
      }
      if (!buffer) {
        const url = `https://raw.githubusercontent.com/${repository}/${tree.sha}/${entry.path.split('/').map(encodeURIComponent).join('/')}`;
        const image = await fetch(url);
        if (!image.ok) throw new Error(`Image indisponible : ${relative} (${image.status})`);
        buffer = Buffer.from(await image.arrayBuffer()); downloaded++;
      }
      const raster = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        || buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
        || (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP')
        || /^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6));
      if (blobHash(buffer) !== entry.sha || !raster) throw new Error(`Image non vérifiée : ${relative}`);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      if (!fs.existsSync(destination) || blobHash(fs.readFileSync(destination)) !== entry.sha) fs.writeFileSync(destination, buffer);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  for (const entry of entries.sort((a, b) => a.path.localeCompare(b.path, 'fr'))) {
    const relative = entry.path.slice(prefix.length);
    const parts = relative.split('/');
    const category = categories.find(item => item.id === (categoryIds[parts[0]] || 'classiques'));
    const groupId = parts.length > 2 ? parts.slice(0, -1).join('/') : parts[0];
    let group = category.groups.find(item => item.id === groupId);
    if (!group) { group = { id: groupId, name: title(parts.length > 2 ? parts.at(-2) : parts[0]), avatars: [] }; category.groups.push(group); }
    const encoded = parts.map(encodeURIComponent).join('/');
    group.avatars.push({ name: title(parts.at(-1).replace(/\.png$/, '').replace(/[-_]avatar$/, '')), src: `assets/avatars/${encoded}`, photoURL: `https://raw.githubusercontent.com/${repository}/${tree.sha}/${prefix}${encoded}` });
  }
  const catalogue = { commit: tree.sha, total: entries.length, categories };
  fs.writeFileSync(path.join(root, 'avatar-catalogue.js'), `// Généré par scripts/sync-avatars.cjs à partir du dépôt public indiqué dans assets/avatars/SOURCES.md.\nwindow.MovixAvatars = ${JSON.stringify(catalogue)};\n`);
  fs.writeFileSync(path.join(root, 'assets', 'avatars', 'SOURCES.md'), `# Avatars\n\nSource : https://github.com/${repository}/tree/${tree.sha}/public/avatars\n\n${entries.length} images PNG récupérées et vérifiées par leur empreinte Git. Les noms, personnages et illustrations appartiennent à leurs titulaires respectifs. Respecter la licence du dépôt et les droits associés aux médias.\n\nLa galerie utilise ces copies locales. Le profil Firebase conserve l’URL HTTPS de la version source pour rester portable entre les environnements ; l’interface la résout vers sa copie locale.\n\nActualisation explicite : node scripts/sync-avatars.cjs\n`);
  console.log(`${entries.length} avatars vérifiés, ${downloaded} téléchargements, ${categories.length} catégories. Commit ${tree.sha}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
