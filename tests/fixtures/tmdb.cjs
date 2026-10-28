// Réponses simulées UNIQUEMENT pour les tests. Le serveur public ne sert pas ce dossier.
const movie = { id:157336,title:'Interstellar',original_title:'Interstellar',original_language:'en',overview:'Synopsis français de test.',release_date:'2014-11-05',vote_average:8.7,vote_count:12345,genres:[{id:878,name:'Science-fiction'}],genre_ids:[878],runtime:169,poster_path:'/test-poster.jpg',backdrop_path:'/test-backdrop.jpg',imdb_id:'tt0816692' };
const tv = { id:66732,name:'Stranger Things',original_name:'Stranger Things',original_language:'en',overview:'Synopsis de série de test.',first_air_date:'2016-07-15',vote_average:8.6,vote_count:200,genres:[{id:18,name:'Drame'}],genre_ids:[18],number_of_seasons:2,number_of_episodes:4,seasons:[{season_number:1,name:'Saison 1',episode_count:2},{season_number:2,name:'Saison 2',episode_count:2}],poster_path:'/test-tv.jpg',backdrop_path:'/test-background.jpg' };
const anime = {...tv,id:1429,name:'L’Attaque des Titans',original_name:'進撃の巨人',original_language:'ja',origin_country:['JP'],genres:[{id:16,name:'Animation'}],genre_ids:[16]};
function fakeTMDB(url) {
  const route=url.pathname.slice(2), language=url.searchParams.get('language');
  if(route.startsWith('/genre/'))return {genres:[{id:878,name:'Science-fiction'},{id:18,name:'Drame'},{id:16,name:'Animation'},{id:99,name:'Documentaire'}]};
  if(route==='/movie/157336')return {...movie};
  if(route==='/movie/157337')return {...movie,id:157337,title:'Interstellar 2',imdb_id:undefined};
  if(route==='/tv/66732')return {...tv};
  if(route==='/tv/1429')return {...anime};
  const season=/^\/tv\/\d+\/season\/(\d+)$/.exec(route);
  if(season)return {episodes:[1,2].map(number=>({id:Number(season[1])*100+number,episode_number:number,season_number:Number(season[1]),name:language==='en-US'?'English episode '+number:'Épisode de test '+number,overview:language==='en-US'?'English summary.':'Résumé français de test.',air_date:'2020-01-01',runtime:24,still_path:'/test-episode.jpg'}))};
  if(route.startsWith('/find/'))return {movie_results:[movie]};
  if(route.includes('/search/')||route.includes('/discover/')||route.includes('/popular')||route.includes('/trending/')){
    const type=route.includes('/movie')?'movie':'tv';const second=url.searchParams.get('page')==='2';
    const item=type==='movie'?movie:(url.searchParams.get('with_original_language')==='ja'?anime:tv);
    return {page:Number(url.searchParams.get('page')||1),total_pages:url.searchParams.get('query')==='Stranger Things'?1:2,results:[item,...(second?[{...item,id:item.id+1,imdb_id:undefined,title:item.title?item.title+' 2':undefined,name:item.name?item.name+' 2':undefined}]:[])]};
  }
  return {};
}
module.exports={movie,tv,anime,fakeTMDB};
