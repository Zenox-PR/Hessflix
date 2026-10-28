// Snapshot de métadonnées d'épisodes publiques TVMaze : titres, numéros et dates seulement.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const searchNames = {
  'jw-ts81342': 'The Rookie',
  'jw-ts20682': 'Attack on Titan',
  'jw-ts20233': 'Rick and Morty',
  'jw-ts17149': 'Band of Brothers',
  'jw-ts20974': 'The X-Files',
  'jw-ts259735': 'Lioness',
  'jw-ts20711': 'The Simpsons',
  'jw-ts21848': 'Lost',
  'jw-ts237578': 'Percy Jackson and the Olympians',
  'jw-ts89898': 'The Falcon and the Winter Soldier',
  'jw-ts219018': 'Ms. Marvel',
  'jw-ts246110': 'She-Hulk: Attorney at Law',
  'jw-ts317599': 'Agatha All Along',
  'jw-ts353556': 'Daredevil: Born Again',
  'jw-ts85391': 'Andor',
  'jw-ts416258': 'Shōgun',
  'jw-ts351915': '1923',
  'jw-ts21408': 'Twin Peaks',
  'jw-ts287292': 'From',
  'jw-ts75269': 'Yellowstone'
};
const normalise = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let lastRequest = 0;
async function request(url) {
  const wait = 550 - (Date.now() - lastRequest);
  if (wait > 0) await pause(wait);
  lastRequest = Date.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { 'User-Agent': 'HessflixLocalCatalogue/1.0' } });
    if (response.status === 429 || response.status >= 500) { await pause(3000 * (attempt + 1)); continue; }
    if (!response.ok) throw Error(`${response.status} ${url}`);
    return response.json();
  }
  throw Error(`Source momentanément indisponible : ${url}`);
}
function catalogue(filename) {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, filename), 'utf8'), sandbox, { filename, timeout: 3000 });
  return Object.values(sandbox.window)[0].items;
}
async function run() {
  const items = [...new Map([...catalogue('discovery-data.js'), ...catalogue('platform-catalogue-data.js')]
    .filter(item => item.kind === 'Série' || item.kind === 'Animation')
    .map(item => [item.id, item])).values()];
  const previous = fs.existsSync(path.join(root, 'episode-data.js')) ? (() => {
    const sandbox = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'episode-data.js'), 'utf8'), sandbox, { timeout: 3000 });
    return sandbox.window.HessflixEpisodes?.shows || {};
  })() : {};
  const shows = {};
  const missing = [];
  for (const item of items) {
    if (!process.argv.includes('--refresh') && previous[item.id]?.episodes?.length) { shows[item.id] = previous[item.id]; continue; }
    try {
      const direct = /^series-(\d+)$/.exec(item.id);
      let show;
      if (direct) show = await request(`https://api.tvmaze.com/shows/${direct[1]}`);
      else {
        const searched = searchNames[item.id] || item.title;
        const results = await request(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(searched)}`);
        show = results.map(result => result.show).find(candidate => normalise(candidate.name) === normalise(searched) && candidate.premiered?.slice(0, 4) === item.year);
      }
      if (!show?.id || !/^https:\/\/www\.tvmaze\.com\/shows\/\d+\//.test(show.url)) { missing.push(`${item.title} (${item.year})`); continue; }
      const episodes = await request(`https://api.tvmaze.com/shows/${show.id}/episodes`);
      const list = episodes.filter(episode => Number.isInteger(episode.season) && episode.season > 0 && Number.isInteger(episode.number) && episode.number > 0)
        .map(episode => ({ season: episode.season, number: episode.number, title: String(episode.name || `Épisode ${episode.number}`).slice(0, 150), airdate: /^\d{4}-\d{2}-\d{2}$/.test(episode.airdate) ? episode.airdate : '', runtime: Number.isInteger(episode.runtime) && episode.runtime > 0 ? episode.runtime : null }));
      if (!list.length) { missing.push(`${item.title} (${item.year}) : aucun épisode`); continue; }
      shows[item.id] = { sourceURL: show.url, episodes: list };
      console.log(`${item.title}: ${list.length} épisodes`);
    } catch (error) { missing.push(`${item.title} (${item.year}) : ${error.message}`); }
  }
  const data = { updatedAt: new Date().toISOString(), shows };
  fs.writeFileSync(path.join(root, 'episode-data.js'), '// Données TVMaze publiques, voir EPISODES.md.\nwindow.HessflixEpisodes = ' + JSON.stringify(data) + ';\n');
  fs.writeFileSync(path.join(root, 'EPISODES.md'), '# Épisodes des séries\n\nSource : [API TVMaze](https://www.tvmaze.com/api), licence CC BY-SA. Relevé : ' + data.updatedAt + '. Les numéros, titres, dates de première diffusion et durées sont des métadonnées ; ils ne prouvent pas la disponibilité d’un épisode dans un abonnement français. Aucune vidéo n’est copiée ou diffusée. Chaque série renseignée affiche un lien vers sa fiche TVMaze.\n\nActualisation manuelle : `node scripts/sync-episodes.cjs`. Les titres sans correspondance exacte de nom et d’année sont exclus.\n\nSéries avec épisodes : ' + Object.keys(shows).length + ' / ' + items.length + '.\n\nTitres non rapprochés :\n' + (missing.length ? missing.map(item => '- ' + item).join('\n') : '- Aucun') + '\n');
  console.log(`Terminé : ${Object.keys(shows).length}/${items.length}, ${missing.length} non rapprochés.`);
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
