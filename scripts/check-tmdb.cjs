// Diagnostic réel, sans afficher ni enregistrer de secret.
const fs = require('node:fs');
const path = require('node:path');
const { createTMDBClient } = require('../server/tmdb-client.cjs');
const { media, season } = require('../server/tmdb-model.cjs');
const env = path.join(__dirname, '..', '.env');
if (fs.existsSync(env)) process.loadEnvFile(env);
(async () => {
  const client = createTMDBClient();
  if (!client.configured()) { console.error('TMDB non configuré : renseignez localement TMDB_API_KEY avec votre clé v3 dans .env.'); process.exitCode=1; return; }
  try {
    const movie = await client.get('/movie/157336',{language:'fr-FR'});
    const tv = await client.get('/tv/66732',{language:'fr-FR'});
    const anime = await client.get('/tv/1429',{language:'fr-FR'});
    const episodes = await client.get('/tv/1429/season/1',{language:'fr-FR'});
    const search = await client.get('/search/movie',{language:'fr-FR',query:'Resident Evil',year:'2002',include_adult:'false'});
    if (!media(movie.data,'movie') || !media(tv.data,'tv') || !media(anime.data,'tv')?.isAnime || !season(episodes.data,1).episodes.length || !search.data.results?.length) throw new Error('INVALID_DATA');
    if (!search.data.results.some(item=>item.id===1576 && item.release_date?.startsWith('2002'))) throw new Error('RESIDENT_EVIL_NOT_FOUND');
    console.log('TMDB : films, séries, anime et saison récupérés. Recherche Resident Evil (2002), identifiant 1576, vérifiée. Aucune écriture Firestore ni aucun secret affiché.');
  } catch { console.error('Vérification TMDB échouée. Vérifiez la clé, le réseau et la disponibilité du service ; aucun détail contenant un secret n’est affiché.'); process.exitCode=1; }
})();
