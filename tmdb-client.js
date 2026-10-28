// Métadonnées PUBLIÉES uniquement. Aucun ancien cache TMDB n'est relu.
(() => {
  /** @typedef {import('./types/contracts').CatalogueItem} Item */
  /** @type {Map<string,Item>} */const memory=new Map();
  /** @param {unknown} value */
  function image(value){return typeof value==='string'&&(/^assets\/discovery\/[a-z0-9-]+\.(jpg|png|webp)$/.test(value)||/^https:\/\/image\.tmdb\.org\/t\/p\/(w342|w500|w780|w1280)\/[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(value))?value:'';}
  /** @param {Item} item */function remember(item){if(item.id&&window.HessflixTitles.validId(item.id))memory.set(item.id,item);return item;}
  /** @param {string} path @param {AbortSignal} [signal] @returns {Promise<unknown>} */
  async function request(path,signal){
    const response=await fetch('/api/catalogue'+path,{cache:'no-store',credentials:'same-origin',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error(response.status===404?'Ce contenu n’est pas publié.':'Le catalogue publié est temporairement indisponible.');
    return response.json();
  }
  /** @param {string} path @param {AbortSignal} [signal] */
  async function page(path,signal){
    const result=/** @type {import('./types/contracts').TMDBPage} */(await request(path,signal));
    if(!Array.isArray(result.items))throw new Error('Catalogue invalide.');
    result.items.forEach(remember);return result;
  }
  /** @param {string} id @param {Item} [legacy] */
  async function detail(id,legacy){
    void legacy;
    const result=/** @type {{item:Item;stale:boolean}} */(await request('/'+encodeURIComponent(id)));
    if(!result.item||!window.HessflixTitles.validId(result.item.id))throw new Error('Fiche indisponible.');
    remember(result.item);return result;
  }
  /** @param {number} id @param {number} number */
  async function season(id,number){return /** @type {{episodes:import('./types/contracts').Episode[];stale:boolean}} */(await request('/tmdb-tv-'+id+'/seasons/'+number));}
  window.HessflixTMDB={image,remember,request,page,detail,season,stored:()=>[...memory.values()],enabled:async()=>window.HessflixCatalogueStatus==='ready'};
})();
