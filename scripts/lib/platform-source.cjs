// Lecture de données SSR publiques : JSON uniquement, aucun script distant exécuté.
function readPublicPage(html) {
  const match = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].find(value => value[1].includes('application/json') && value[1].includes('__NUXT_DATA__'));
  if (!match || match[2].length > 8000000) throw new Error('Format de catalogue public non reconnu');
  const flat = JSON.parse(match[2]);
  if (!Array.isArray(flat) || flat.length > 200000) throw new Error('Catalogue public invalide');
  const memo = new Map();
  function read(index) {
    if (index === -1) return undefined;
    if (!Number.isInteger(index) || index < 0 || index >= flat.length) throw new Error('Référence JSON invalide');
    if (memo.has(index)) return memo.get(index);
    const value = flat[index];
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      if (['ShallowReactive','Reactive','Ref','ShallowRef'].includes(value[0])) return read(value[1]);
      const result = []; memo.set(index,result); for (const item of value) result.push(read(item)); return result;
    }
    const result = Object.create(null); memo.set(index,result);
    for (const [key,item] of Object.entries(value)) { if (['__proto__','prototype','constructor'].includes(key)) continue; result[key] = read(item); }
    return result;
  }
  const index = flat.findIndex(value => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).some(key => /^(Movie|Show):/.test(key)));
  if (index < 0) throw new Error('Titres publics absents');
  const store = read(index);
  const ref = value => value?.__ref ? store[value.__ref] : value;
  return flat.flatMap((value,index) => value && typeof value === 'object' && !Array.isArray(value) && ['Movie','Show'].includes(flat[value.__typename]) ? [read(index)] : []).flatMap(node => {
    const content = Object.entries(node).find(([key]) => key.startsWith('content(') && key.includes('"country":"FR"') && key.includes('"language":"fr"'))?.[1];
    if (!content?.title || !/^\/fr\/(film|serie)\//.test(content.fullPath || '')) return [];
    const offerValues = Object.entries(node).filter(([key]) => key.startsWith('offers(') || key.startsWith('watchNowOffer(')).flatMap(([,value]) => Array.isArray(value) ? value : [value]);
    const offers = offerValues.map(ref).filter(Boolean).map(offer => ({country:offer.country,type:offer.monetizationType,provider:ref(offer.package)?.technicalName,url:offer.standardWebURL,updatedAt:offer.updatedAt}));
    const shortGenres={act:'action',ani:'animation',cmy:'comedy',crm:'crime',doc:'documentation',drm:'drama',fml:'family',fnt:'fantasy',hst:'history',hrr:'horror',msc:'music',rma:'romance',scf:'scifi',trl:'thriller',war:'war',wsn:'western',spt:'sport'};
    const genres = (content.genres || []).map(ref).filter(Boolean).map(genre => genre.technicalName || shortGenres[genre.shortName]).filter(Boolean);
    return [{id:node.id,kind:node.__typename==='Movie'?'Film':'Série',title:content.title,year:content.originalReleaseYear,rating:content.scoring?.imdbScore,votes:content.scoring?.imdbVotes,poster:content.posterUrl,sourceURL:'https://www.justwatch.com'+content.fullPath,genres,offers}];
  });
}
function subscriptionOffers(item,provider) {
  return item.offers.filter(offer => offer.country === 'FR' && offer.type === 'FLATRATE' && offer.provider === provider && /^https:\/\//.test(offer.url || ''));
}
module.exports = {readPublicPage,subscriptionOffers};
