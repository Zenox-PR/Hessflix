// Catalogue de découverte : métadonnées publiques, aucun secret ni flux vidéo.
const fs = require('node:fs');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');
const root = path.resolve(__dirname, '..');
// Titre source, titre français, année, identifiant IMDb, genres, saga, résumé original.
const films = [
  ['Interstellar', 'Interstellar', 2014, 'tt0816692', ['Science-fiction','Aventure'], '', 'Un ancien pilote traverse l’espace pour chercher un avenir à l’humanité, tandis que sa fille poursuit ses recherches sur Terre.'],
  ['Inception', 'Inception', 2010, 'tt1375666', ['Science-fiction','Thriller'], '', 'Un spécialiste des rêves reçoit une mission inhabituelle : faire naître une idée dans l’esprit de sa cible.'],
  ['The Dark Knight', 'The Dark Knight', 2008, 'tt0468569', ['Action','Thriller'], 'batman', 'À Gotham, Batman affronte un adversaire qui transforme la ville en terrain de jeu et met ses convictions à l’épreuve.'],
  ['The Shawshank Redemption', 'Les Évadés', 1994, 'tt0111161', ['Drame'], '', 'Un banquier condamné à la prison noue une amitié durable et refuse d’abandonner l’espoir de retrouver sa liberté.'],
  ['The Green Mile', 'La Ligne verte', 1999, 'tt0120689', ['Drame','Fantastique'], '', 'Dans le couloir de la mort, un gardien rencontre un prisonnier dont les dons bouleversent toutes ses certitudes.'],
  ['Fight Club', 'Fight Club', 1999, 'tt0137523', ['Drame','Thriller'], '', 'Un employé insomniaque rencontre un vendeur de savon et participe à un club clandestin qui prend une ampleur inattendue.'],
  ['The Matrix', 'Matrix', 1999, 'tt0133093', ['Action','Science-fiction'], 'matrix', 'Un informaticien découvre que sa réalité cache un système bien plus vaste, et qu’il pourrait en changer les règles.'],
  ['Gladiator', 'Gladiator', 2000, 'tt0172495', ['Action','Aventure'], '', 'Un général romain déchu devient gladiateur et cherche à retrouver sa dignité dans les arènes de l’Empire.'],
  ['Seven', 'Seven', 1995, 'tt0114369', ['Thriller','Crime'], '', 'Deux inspecteurs suivent la piste d’un meurtrier dont les crimes composent une terrible mise en scène.'],
  ['The Prestige', 'Le Prestige', 2006, 'tt0482571', ['Thriller','Mystère'], '', 'Deux illusionnistes rivaux poussent leur art toujours plus loin, au prix de secrets et de sacrifices.'],
  ['Shutter Island', 'Shutter Island', 2010, 'tt1130884', ['Thriller','Mystère'], '', 'Un enquêteur arrive dans un hôpital isolé pour retrouver une patiente disparue, mais l’île semble garder d’autres secrets.'],
  ['Whiplash', 'Whiplash', 2014, 'tt2582802', ['Drame','Musique'], '', 'Un jeune batteur ambitieux affronte les exigences extrêmes d’un professeur décidé à révéler son potentiel.'],
  ['Dune', 'Dune', 2021, 'tt1160419', ['Science-fiction','Aventure'], 'dune', 'Paul Atréides rejoint Arrakis avec sa famille et découvre une planète au cœur d’un conflit pour le pouvoir.'],
  ['Dune: Part Two', 'Dune : Deuxième Partie', 2024, 'tt15239678', ['Science-fiction','Aventure'], 'dune', 'Aux côtés des Fremen, Paul poursuit son chemin sur Arrakis, partagé entre ses sentiments et son destin.'],
  ['The Lord of the Rings: The Fellowship of the Ring', 'Le Seigneur des anneaux : La Communauté de l’anneau', 2001, 'tt0120737', ['Fantastique','Aventure'], 'lord-of-the-rings', 'Frodon quitte la Comté avec un anneau dangereux et rejoint une communauté chargée de le détruire.'],
  ['The Lord of the Rings: The Two Towers', 'Le Seigneur des anneaux : Les Deux Tours', 2002, 'tt0167261', ['Fantastique','Aventure'], 'lord-of-the-rings', 'La Communauté est dispersée. Chaque compagnon poursuit sa route alors que les forces de l’ombre se rassemblent.'],
  ['The Lord of the Rings: The Return of the King', 'Le Seigneur des anneaux : Le Retour du roi', 2003, 'tt0167260', ['Fantastique','Aventure'], 'lord-of-the-rings', 'Tandis que les royaumes préparent leur dernière bataille, Frodon et Sam approchent du terme de leur voyage.'],
  ["Harry Potter and the Sorcerer's Stone", 'Harry Potter à l’école des sorciers', 2001, 'tt0241527', ['Fantastique','Famille'], 'harry-potter', 'Un jeune garçon apprend qu’il est sorcier et découvre une école où l’attendent l’amitié, la magie et un mystérieux secret.'],
  ['Harry Potter and the Prisoner of Azkaban', 'Harry Potter et le Prisonnier d’Azkaban', 2004, 'tt0304141', ['Fantastique','Famille'], 'harry-potter', 'La troisième rentrée de Harry est marquée par une évasion et par de nouvelles révélations sur son passé.'],
  ['Spider-Man: No Way Home', 'Spider-Man : No Way Home', 2021, 'tt10872600', ['Action','Fantastique'], 'spider-man', 'Peter Parker tente de protéger ses proches, mais un sort bouleverse les frontières entre plusieurs univers.'],
  ['Spider-Man: Into the Spider-Verse', 'Spider-Man : New Generation', 2018, 'tt4633694', ['Animation','Action','Famille'], 'spider-man', 'Miles Morales découvre ses pouvoirs et rencontre des héros venus d’autres dimensions pour défendre son monde.'],
  ['Spider-Man: Across the Spider-Verse', 'Spider-Man : Across the Spider-Verse', 2023, 'tt9362722', ['Animation','Action','Famille'], 'spider-man', 'Miles retrouve Gwen et découvre une communauté de héros dont la mission remet ses choix en question.'],
  ['Toy Story', 'Toy Story', 1995, 'tt0114709', ['Animation','Famille','Comédie'], '', 'L’arrivée d’un nouveau jouet bouleverse la place du cow-boy Woody dans la chambre d’Andy.'],
  ['Coco', 'Coco', 2017, 'tt2380307', ['Animation','Famille','Musique'], '', 'Un jeune musicien voyage au pays de ses ancêtres et cherche à comprendre une histoire familiale longtemps cachée.'],
  ['Inside Out', 'Vice-versa', 2015, 'tt2096673', ['Animation','Famille'], 'inside-out', 'Dans l’esprit de Riley, ses émotions doivent apprendre à travailler ensemble pour l’accompagner dans une nouvelle vie.'],
  ['Inside Out 2', 'Vice-versa 2', 2024, 'tt22022452', ['Animation','Famille'], 'inside-out', 'L’adolescence de Riley fait entrer de nouvelles émotions dans le quartier général, à commencer par l’Anxiété.'],
  ['How to Train Your Dragon', 'Dragons', 2010, 'tt0892769', ['Animation','Aventure','Famille'], '', 'Un jeune Viking se lie d’amitié avec un dragon et remet en question les traditions de son village.'],
  ['Kung Fu Panda', 'Kung Fu Panda', 2008, 'tt0441773', ['Animation','Action','Famille'], '', 'Un panda passionné de kung-fu est choisi pour une mission à laquelle personne, pas même lui, ne le croit préparé.'],
  ['The Batman', 'The Batman', 2022, 'tt1877830', ['Action','Thriller','Crime'], 'batman', 'Batman enquête sur une série de crimes qui dévoile les liens cachés entre les puissants de Gotham.'],
  ['Mad Max: Fury Road', 'Mad Max : Fury Road', 2015, 'tt1392190', ['Action','Aventure'], '', 'Dans un monde désertique, Max rejoint la fuite de Furiosa et d’un groupe poursuivi par un tyran.'],
  ['The Martian', 'Seul sur Mars', 2015, 'tt3659388', ['Science-fiction','Aventure'], '', 'Un astronaute laissé sur Mars doit utiliser ses connaissances pour survivre pendant que la Terre organise son retour.'],
  ['Avatar', 'Avatar', 2009, 'tt0499549', ['Science-fiction','Aventure'], 'avatar', 'Sur Pandora, un ancien soldat découvre la culture des Na’vis et se retrouve partagé entre deux mondes.'],
  ['Avatar: The Way of Water', 'Avatar : La Voie de l’eau', 2022, 'tt1630029', ['Science-fiction','Aventure','Famille'], 'avatar', 'La famille Sully trouve refuge auprès d’un peuple des récifs alors qu’une ancienne menace revient sur Pandora.'],
  ['Jurassic Park', 'Jurassic Park', 1993, 'tt0107290', ['Aventure','Science-fiction'], '', 'Des visiteurs découvrent un parc peuplé de dinosaures, jusqu’à ce que les systèmes de sécurité cessent de les protéger.'],
  ['Pirates of the Caribbean: The Curse of the Black Pearl', 'Pirates des Caraïbes : La Malédiction du Black Pearl', 2003, 'tt0325980', ['Aventure','Fantastique'], 'pirates', 'Jack Sparrow et Will Turner prennent la mer pour retrouver un navire dont l’équipage cache une étrange malédiction.'],
  ["Pirates of the Caribbean: Dead Man's Chest", 'Pirates des Caraïbes : Le Secret du coffre maudit', 2006, 'tt0383574', ['Aventure','Fantastique'], 'pirates', 'Une dette rattrape Jack Sparrow et entraîne ses compagnons dans une nouvelle course sur les océans.'],
  ['Home Alone', 'Maman, j’ai raté l’avion !', 1990, 'tt0099785', ['Famille','Comédie'], '', 'Oublié à la maison pendant les vacances, Kevin doit se débrouiller seul et défendre son territoire contre deux cambrioleurs.']
];
const shows = [
  ['Breaking Bad', 'Breaking Bad', ['Thriller','Crime','Drame']], ['Better Call Saul', 'Better Call Saul', ['Crime','Drame']],
  ['Game of Thrones', 'Game of Thrones', ['Fantastique','Aventure']], ['Chernobyl', 'Chernobyl', ['Drame']],
  ['Stranger Things', 'Stranger Things', ['Science-fiction','Mystère']], ['Dark', 'Dark', ['Science-fiction','Thriller']],
  ['Severance', 'Severance', ['Science-fiction','Thriller']], ['The Last of Us', 'The Last of Us', ['Aventure','Drame']],
  ['Fallout', 'Fallout', ['Science-fiction','Aventure']], ['Peaky Blinders', 'Peaky Blinders', ['Crime','Drame']],
  ['Sherlock', 'Sherlock', ['Mystère','Thriller']], ['Arcane', 'Arcane', ['Animation','Fantastique']],
  ['The Bear', 'The Bear', ['Drame','Comédie']], ['Planet Earth', 'Planète Terre', ['Documentaire','Famille']]
];
const summaries = {
  'Breaking Bad': 'Un professeur de chimie malade s’associe à un ancien élève et s’enfonce dans un monde criminel dont il perd peu à peu le contrôle.',
  'Better Call Saul': 'Avant de devenir Saul Goodman, Jimmy McGill tente de construire sa carrière d’avocat entre ambitions, combines et loyautés fragiles.',
  'Game of Thrones': 'Plusieurs familles se disputent le pouvoir sur Westeros, tandis qu’une menace ancienne grandit au-delà des frontières.',
  Chernobyl: 'Après une catastrophe nucléaire, des scientifiques et des travailleurs tentent de comprendre la situation et de limiter ses conséquences.',
  'Stranger Things': 'La disparition d’un garçon ouvre une enquête qui entraîne ses amis à la rencontre d’expériences secrètes et d’un monde parallèle.',
  Dark: 'Dans une petite ville allemande, des disparitions révèlent des liens entre plusieurs familles et différentes époques.',
  Severance: 'Des employés acceptent de séparer leurs souvenirs professionnels et personnels, avant de découvrir les secrets de leur entreprise.',
  'The Last of Us': 'Un homme et une adolescente traversent un territoire bouleversé par une pandémie, et apprennent à compter l’un sur l’autre.',
  Fallout: 'Une habitante d’un abri souterrain découvre la surface et les communautés qui tentent de survivre après une guerre nucléaire.',
  'Peaky Blinders': 'À Birmingham, une famille ambitieuse développe son influence entre paris, affaires clandestines et rivalités.',
  Sherlock: 'Un détective à l’esprit brillant et son nouveau colocataire enquêtent sur des affaires énigmatiques dans le Londres contemporain.',
  Arcane: 'Deux sœurs se retrouvent prises dans les tensions entre une cité prospère et les quartiers qui vivent dans son ombre.',
  'The Bear': 'Un cuisinier revient à Chicago pour reprendre un établissement familial et tenter de transformer son équipe.',
  'Planet Earth': 'Un voyage à travers les paysages et les écosystèmes de la planète, au plus près de la vie sauvage.'
};
const collections = [
  ['harry-potter', 'Harry Potter', 'Entrez dans le monde des sorciers.', '#443b87'],
  ['lord-of-the-rings', 'Le Seigneur des anneaux', 'Un voyage en Terre du Milieu.', '#596343'],
  ['dune', 'Dune', 'L’appel d’Arrakis.', '#b87840'], ['spider-man', 'Spider-Man', 'D’une dimension à l’autre.', '#ba3549'],
  ['batman', 'Batman', 'Les ombres de Gotham.', '#364655'], ['avatar', 'Avatar', 'Explorez les mondes de Pandora.', '#197a9b'],
  ['pirates', 'Pirates des Caraïbes', 'Le large vous attend.', '#75563f'], ['inside-out', 'Vice-versa', 'Toutes vos émotions.', '#ba7d9e']
];
const tmdbIds = [157336,27205,155,278,497,550,603,98,807,1124,11324,244786,438631,693134,120,121,122,671,673,634649,324857,569094,862,354912,150540,1022789,10191,950,414906,76341,286217,19995,76600,329,22,58,771];
async function fetchOK(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(45000), headers: { 'User-Agent': 'MovixLocalDiscovery/1.0' } });
  if (!response.ok) throw new Error(`Source indisponible : ${new URL(url).hostname} (${response.status})`);
  return response;
}
async function main() {
  const directory = path.join(root, 'assets', 'discovery'); fs.mkdirSync(directory, { recursive: true });
  const ratingsResponse = await fetchOK('https://datasets.imdbws.com/title.ratings.tsv.gz');
  const ratingsBuffer = Buffer.from(await ratingsResponse.arrayBuffer());
  const text = (ratingsBuffer[0] === 31 && ratingsBuffer[1] === 139 ? gunzipSync(ratingsBuffer) : ratingsBuffer).toString('utf8');
  const wanted = new Set(films.map(film => film[3])), ratings = new Map();
  for (const line of text.split('\n')) { const split = line.indexOf('\t'); if (wanted.has(line.slice(0, split))) { const [id, score, votes] = line.trim().split('\t'); ratings.set(id, { score: Number(score), votes: Number(votes) }); } }
  const entries = [];
  async function image(url, id) {
    const buffer = Buffer.from(await (await fetchOK(url)).arrayBuffer());
    const extension = buffer[0] === 137 && buffer[1] === 80 ? '.png' : buffer[0] === 255 && buffer[1] === 216 ? '.jpg' : buffer.toString('ascii', 0, 4) === 'RIFF' ? '.webp' : null;
    if (!extension) throw new Error('Format d’affiche non reconnu');
    const relative = `assets/discovery/${id}${extension}`; fs.writeFileSync(path.join(root, relative), buffer); return relative;
  }
  let cursor = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (cursor < films.length) {
      const index = cursor++;
      const [english, title, year, imdb, genres, collection, overview] = films[index];
      const rating = ratings.get(imdb);
      if (!rating) { console.log(`Note absente : ${title}`); continue; }
      const id = 'movie-' + imdb;
      try {
        const pageURL = `https://www.themoviedb.org/movie/${tmdbIds[index]}`;
        const html = await (await fetchOK(pageURL)).text();
        const posterURL = html.match(/https:\/\/(?:media|image)\.themoviedb\.org\/t\/p\/w500\/[A-Za-z0-9]+\.(?:jpg|png)/)?.[0];
        if (!posterURL) throw new Error('Affiche publique absente');
        entries.push({ id, title, kind: 'Film', year: String(year), rating: rating.score.toFixed(1).replace('.', ','), votes: rating.votes, genres, collection, overview, image: await image(posterURL.replace('/w500/', '/w342/'), id), sourceURL: `https://www.imdb.com/title/${imdb}/`, imageSource: pageURL, ratingSource: 'IMDb', poster: 'linear-gradient(145deg,#33303b,#14141a)' });
      } catch (error) { console.log(`Affiche non récupérée : ${title} (${error.message})`); }
    }
  }));
  for (const [query, title, genres] of shows) {
    const show = await (await fetchOK('https://api.tvmaze.com/singlesearch/shows?q=' + encodeURIComponent(query))).json();
    if (!show.image?.medium || !show.rating?.average) continue;
    const id = 'series-' + show.id;
    entries.push({ id, title, kind: 'Série', year: show.premiered.slice(0,4), rating: Number(show.rating.average).toFixed(1).replace('.', ','), genres, overview: summaries[query], image: await image(show.image.medium, id), sourceURL: show.url.replace(/^http:/, 'https:'), ratingSource: 'TVMaze', poster: 'linear-gradient(145deg,#33303b,#14141a)' });
  }
  if (entries.filter(item => item.kind === 'Film').length < 20 || entries.filter(item => item.kind === 'Série').length < 10) throw new Error('Catalogue insuffisant : conserver la version précédente.');
  entries.sort((a,b) => a.id.localeCompare(b.id));
  const snapshot = new Date().toISOString().slice(0,10);
  const data = { updatedAt: snapshot, items: entries, collections: collections.map(([id,title,description,color]) => ({id,title,description,color})).filter(collection => entries.some(item => item.collection === collection.id)) };
  fs.writeFileSync(path.join(root, 'discovery-data.js'), '// Généré par scripts/sync-discovery.cjs. Sources dans assets/discovery/SOURCES.md.\nwindow.MovixDiscovery = ' + JSON.stringify(data) + ';\n');
  fs.writeFileSync(path.join(directory, 'SOURCES.md'), `# Catalogue de découverte\n\nRelevé : ${snapshot}. ${entries.length} titres.\n\nAffiches de films : pages publiques de https://www.themoviedb.org et images TMDB associées, sans clé API. Le champ imageSource conserve la page source de chaque film.\nNotes de films : jeu officiel IMDb https://datasets.imdbws.com/title.ratings.tsv.gz ; documentation https://developer.imdb.com/non-commercial-datasets/ .\nAffiches et notes de séries : API publique https://www.tvmaze.com/api ; données TVMaze sous CC BY-SA. Chaque fiche renvoie à sa source.\nLes résumés français courts sont rédigés pour cette interface. Les affiches et marques appartiennent à leurs titulaires.\n\nLes Top 10 classent les meilleures notes de cette sélection, pas la popularité mondiale en temps réel. Les rangées Tendances et Sagas sont des sélections éditoriales. Aucun film, épisode ou flux vidéo n’est téléchargé.\n\nActualisation explicite : node scripts/sync-discovery.cjs\n`);
  console.log(`${entries.length} titres avec affiches locales et notes sourcées (${snapshot}).`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
