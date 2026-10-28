// Frontière de confiance : seuls les champs validés de TMDB quittent le serveur.
const text = (value, max = 12000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const integer = (value, max = 1000000000) => Number.isSafeInteger(value) && value >= 0 && value <= max ? value : null;
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value, 10)) ? text(value, 10) : '';
const image = (value, size) => /^\/[a-zA-Z0-9_-]+\.(?:jpg|png|webp)$/.test(text(value, 200)) ? `https://image.tmdb.org/t/p/${size}${value}` : '';
const normalise = value => text(value, 200).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function isAnime(data) {
  const animation = data.genre_ids?.includes(16) || data.genres?.some(genre => genre.id === 16);
  const keywords = data.keywords?.results || data.keywords?.keywords || [];
  return Boolean(animation && (data.original_language === 'ja' || data.origin_country?.includes('JP') || data.production_countries?.some(country => country.iso_3166_1 === 'JP') || keywords.some(keyword => normalise(keyword.name) === 'anime')));
}
function media(data, type, genres = {}) {
  if (!data || !['movie', 'tv'].includes(type) || !integer(data.id) || data.adult === true) return null;
  const title = text(data.title || data.name, 500) || text(data.original_title || data.original_name, 500);
  if (!title) return null;
  const ids = Array.isArray(data.genre_ids) ? data.genre_ids : [];
  const names = Array.isArray(data.genres) ? data.genres.map(genre => text(genre.name, 100)) : ids.map(id => genres[id] || '');
  const released = date(type === 'movie' ? data.release_date : data.first_air_date);
  const score = typeof data.vote_average === 'number' && Number.isFinite(data.vote_average) && data.vote_average >= 0 && data.vote_average <= 10 ? data.vote_average : null;
  const seasons = (Array.isArray(data.seasons) ? data.seasons : []).filter(season => integer(season.season_number, 9999) !== null).map(season => ({
    number: season.season_number, title: text(season.name, 300), episodes: integer(season.episode_count, 100000), airdate: date(season.air_date), image: image(season.poster_path, 'w342')
  })).sort((a, b) => a.number - b.number);
  return {
    id: `tmdb-${type}-${data.id}`, tmdbId: data.id, mediaType: type, title,
    originalTitle: text(data.original_title || data.original_name, 500),
    alternativeTitles: [...new Set([...(data.alternative_titles?.titles || data.alternative_titles?.results || []).map(entry => text(entry.title, 500)), text(data.original_title || data.original_name, 500)].filter(Boolean))].slice(0, 50),
    kind: type === 'movie' ? 'Film' : 'Série', isAnime: isAnime(data), year: released.slice(0, 4), releaseDate: released,
    rating: score === null ? '' : score.toFixed(1).replace('.', ','), votes: integer(data.vote_count) || 0,
    genres: [...new Set(names.filter(Boolean))], overview: text(data.overview), image: image(data.poster_path, 'w500'), backdrop: image(data.backdrop_path, 'w1280'),
    poster: 'linear-gradient(145deg,#17283f,#090e18)', sourceURL: `https://www.themoviedb.org/${type}/${data.id}`, ratingSource: 'TMDB',
    runtime: integer(data.runtime, 10000), tmdbSeasons: seasons, episodeCount: integer(data.number_of_episodes, 100000), seasonCount: integer(data.number_of_seasons, 9999),
    originalLanguage: text(data.original_language, 10), metadataLanguage: 'fr-FR',
    imdbId: /^tt\d+$/.test(text(data.imdb_id || data.external_ids?.imdb_id, 30)) ? (data.imdb_id || data.external_ids.imdb_id) : ''
  };
}
function season(data, number) {
  if (!data || !Array.isArray(data.episodes)) throw new Error('TMDB_INVALID_RESPONSE');
  return { season: number, episodes: data.episodes.filter(episode => integer(episode.episode_number, 100000) > 0).map(episode => ({
    season: number, number: episode.episode_number, title: text(episode.name, 500), overview: text(episode.overview),
    airdate: date(episode.air_date), runtime: integer(episode.runtime, 10000), image: image(episode.still_path, 'w500'), tmdbId: integer(episode.id)
  })).sort((a, b) => a.number - b.number) };
}
module.exports = { media, season, normalise, text, isAnime };
