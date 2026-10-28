const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createMovixServer } = require('../server.cjs');
const model = require('../catalogue-model.js');
const session = require('../auth-session.js');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {readPublicPage,subscriptionOffers} = require('../scripts/lib/platform-source.cjs');

test('plateformes : offres françaises par abonnement et URL officielles uniquement', () => {
  const offer={platform:'netflix',country:'FR',type:'subscription',sourceURL:'https://www.justwatch.com/fr/film/interstellar',watchURL:'https://www.netflix.com/title/70305903',checkedAt:'2026-10-23T10:00:00Z'};
  assert.equal(model.validAvailability(offer),true);
  const credentialURL = new URL(offer.watchURL); credentialURL.username = 'a'; credentialURL.password = 'b';
  for(const changed of [{country:'US'},{type:'rent'},{platform:'marvel'},{platform:'paramount-amazon-channel'},{watchURL:'javascript:alert(1)'},{watchURL:'https://netflix.com.attacker.invalid/x'},{watchURL:'https://netflix.com@attacker.invalid/x'},{watchURL:credentialURL.href},{watchURL:'http://netflix.com/x'},{watchURL:'https://netflix.com:123/x'},{sourceURL:'https://attacker.invalid/fr/film/x'},{checkedAt:'incorrect'}]) assert.equal(model.validAvailability({...offer,...changed}),false);
  assert.equal(model.validAvailability({...offer,platform:'prime-video',watchURL:'https://app.primevideo.com/detail?gti=example'}),true);
});

test('plateformes : relevé cohérent, deux Top 10 par univers, affiches et genres présents', () => {
  const sandbox={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../platform-catalogue-data.js'),'utf8'),sandbox);
  const data=JSON.parse(JSON.stringify(sandbox.window.MovixPlatformCatalogue));const ids=new Map(data.items.map(item=>[item.id,item]));
  assert.equal(data.country,'FR');assert.equal(ids.size,data.items.length);
  for(const item of data.items) {assert.ok(item.genres.length);assert.ok(item.overview);assert.ok(fs.existsSync(path.join(__dirname,'..',item.image)));assert.ok(item.availability.length);assert.ok(item.availability.every(model.validAvailability));}
  for(const [id,provider] of Object.entries(data.providers)) {
    const list=provider.itemIds.map(value=>ids.get(value));assert.equal(new Set(provider.itemIds).size,provider.itemIds.length);
    assert.ok(list.every(item=>item&&item.availability.some(offer=>offer.platform===(id==='marvel'?'disney':id))));
    assert.equal(model.topRated(list,'Film').length,10);assert.equal(model.topRated(list,'Série').length,10);
    if(id==='marvel') {assert.equal(provider.kind,'universe');assert.ok(list.every(item=>item.marvel===true));}
  }
});

test('plateformes : lecture JSON sans exécution et exclusion achats, pays étrangers et chaînes Prime', () => {
  const values=[];function encode(value){if(value===undefined)return -1;const index=values.length;values.push(null);values[index]=Array.isArray(value)?value.map(encode):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,encode(item)])):value;return index;}
  const pkg={__typename:'Package',technicalName:'amazonprimevideo'};
  const source={__typename:'Movie',id:'tm1','content({"country":"FR","language":"en"})':{title:'Wrong',fullPath:'/us/movie/wrong'},'content({"country":"FR","language":"fr"})':{title:'Titre français',fullPath:'/fr/film/test',originalReleaseYear:2024,scoring:{imdbScore:8},genres:[],posterUrl:'/poster/example/{profile}/test.{format}'},'offers({"country":"FR"})':[{country:'FR',monetizationType:'FLATRATE',standardWebURL:'https://app.primevideo.com/detail/test',package:pkg},{country:'US',monetizationType:'FLATRATE',standardWebURL:'https://app.primevideo.com/detail/test',package:pkg},{country:'FR',monetizationType:'RENT',standardWebURL:'https://app.primevideo.com/detail/test',package:pkg},{country:'FR',monetizationType:'FLATRATE',standardWebURL:'https://app.primevideo.com/detail/test',package:{technicalName:'paramountplusamazonchannel'}}]};
  encode({'Movie:tm1':source});
  const items=readPublicPage('<script>throw new Error("DO_NOT_EXECUTE")</script><script type="application/json" id="__NUXT_DATA__">'+JSON.stringify(values)+'</script>');
  assert.equal(items[0].title,'Titre français');assert.equal(subscriptionOffers(items[0],'amazonprimevideo').length,1);
  assert.throws(()=>readPublicPage('<html>indisponible</html>'),/non reconnu/);
});

test('épisodes : les séries sélectionnées ont des saisons sourcées sans numéros inventés', () => {
  const sandbox={window:{}};
  for(const file of ['discovery-data.js','platform-catalogue-data.js','episode-data.js']) vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),sandbox);
  const titles=[...sandbox.window.MovixDiscovery.items,...sandbox.window.MovixPlatformCatalogue.items];
  const series=[...new Set(titles.filter(item=>item.kind==='Série').map(item=>item.id))];
  const shows=sandbox.window.HessflixEpisodes.shows;
  assert.equal(Object.keys(shows).length,series.length);
  for(const id of series) {
    const show=shows[id];assert.match(show.sourceURL,/^https:\/\/www\.tvmaze\.com\/shows\/\d+\//);
    assert.ok(show.episodes.length>0);const numbers=new Set();
    for(const episode of show.episodes) {assert.ok(Number.isInteger(episode.season)&&episode.season>0);assert.ok(Number.isInteger(episode.number)&&episode.number>0);assert.ok(episode.title);const key=episode.season+':'+episode.number;assert.equal(numbers.has(key),false);numbers.add(key);}
  }
});
test('catalogue : recherche et catégorie appliquées ensemble, accents ignorés', () => {
  const items = [{ title: 'Rivages', kind: 'Série' }, { title: 'Échos', kind: 'Film' }];
  assert.deepEqual(model.filterItems(items, { query: 'Rivages', kind: 'Film' }), []);
  assert.equal(model.filterItems(items, { query: 'echos', kind: 'Film' })[0].title, 'Échos');
  assert.equal(model.filterItems(items, { query: 'Rivages', kind: 'Tous' }).length, 1);
});

test('découverte : Top 10 par note numérique, séparé par type, sans mutation des données', () => {
  const films = Array.from({length:12},(_,i) => ({title:'Film ' + i,kind:'Film',rating:(9.5-i/10).toFixed(1).replace('.',','),votes:i}));
  const input = [...films].reverse().concat([{title:'Série',kind:'Série',rating:'10,0'}]);
  const original = [...input]; const top = model.topRated(input,'Film');
  assert.equal(top.length,10); assert.equal(top[0].title,'Film 0'); assert.equal(top[9].title,'Film 9');
  assert.deepEqual(input,original); assert.equal(model.topRated(input,'Série')[0].title,'Série');
  assert.equal(model.topRated([{title:'A',kind:'Film',rating:'8,2',votes:10},{title:'B',kind:'Film',rating:'8,2',votes:20}],'Film')[0].title,'B');
});

test('découverte : recherche, genre, saga et animation combinés', () => {
  const list = [{title:'Film animé',kind:'Film',genres:['Animation','Famille'],collection:'saga'},{title:'Série sombre',kind:'Série',genres:['Thriller']}];
  assert.equal(model.filterItems(list,{query:'anime',kind:'Animation',genre:'Famille',collection:'saga'}).length,1);
  assert.equal(model.filterItems(list,{query:'',kind:'Film',genre:'Thriller'}).length,0);
  assert.equal(model.filterItems(list,{query:'thriller',kind:'Série'}).length,1);
});
test('profils : types, longueurs, URL HTTPS, champs autorisés', () => {
  for (const photoURL of ['', 'https://example.com/avatar.png?size=128']) assert.equal(model.validProfile({ displayName: 'Profil', photoURL }), true);
  for (const photoURL of [null, {}, [], 4, 'javascript:alert(1)', 'data:image/png,x', 'http://example.com/x', 'https://example.com/a b', 'https://a@b/x', 'https://example.com/' + 'a'.repeat(2048)]) assert.equal(model.validProfile({ displayName: 'Profil', photoURL }), false);
  for (const displayName of ['', null, {}, [], 'a'.repeat(61)]) assert.equal(model.validProfile({ displayName }), false);
  assert.equal(model.validProfile({ displayName: 'Profil', admin: true }), false);
});
test('styles de catalogue : URL et attributs injectés rejetés', () => {
  assert.equal(model.safePoster('url(https://attacker.invalid/x)'), 'linear-gradient(145deg,#333,#111)');
  assert.equal(model.safePoster('linear-gradient(red,blue);background:url(x)'), 'linear-gradient(145deg,#333,#111)');
  assert.equal(model.safePoster('linear-gradient(145deg,#333,#111)'), 'linear-gradient(145deg,#333,#111)');
});

test('avatars : URL source portable résolue localement, suppression neutre et traversées refusées', () => {
  const prefix = 'https://raw.githubusercontent.com/movixstream/MovixOpenSource/' + 'a'.repeat(40) + '/public/avatars/';
  assert.equal(model.avatarSource(prefix + 'disney%2B/the_simpsons/homer_simpson.png'), 'assets/avatars/disney%2B/the_simpsons/homer_simpson.png');
  assert.equal(model.avatarSource(prefix + 'prime_video/%C3%A0_contre-sens_2/avatar.png'), 'assets/avatars/prime_video/%C3%A0_contre-sens_2/avatar.png');
  for (const value of ['', null, undefined, {}, 'javascript:alert(1)', prefix + '../avatar.png', prefix + '%2e%2e/avatar.png', prefix + 'a%2Fb/avatar.png', prefix + 'a%5Cb/avatar.png', prefix + 'bad%AA/avatar.png']) assert.equal(model.avatarSource(value), 'assets/avatar-neutral.svg');
  assert.equal(model.avatarSource('https://example.com/google-avatar.png'), 'https://example.com/google-avatar.png');
});
test('déconnexion : Firebase fermé malgré panne serveur, avertissement et reprise', async () => {
  let localCalls = 0;
  const result = await session.signOut(async () => { localCalls++; }, async () => { throw new Error('Network unavailable'); });
  assert.equal(localCalls, 1); assert.deepEqual(result, { serverCleared: false, localCleared: true }); assert.equal(session.pending(), true);
  await session.clearServerSession(async (url, options) => {
    if (url.endsWith('csrf')) return new Response(JSON.stringify({ csrfToken: 'test-csrf' }));
    assert.equal(options.method, 'DELETE'); assert.equal(options.headers['X-CSRF-Token'], 'test-csrf'); return new Response('{}');
  });
  assert.equal(session.pending(), false);
  await assert.rejects(session.signOut(async () => { throw new Error('Firebase unavailable'); }, async () => new Response(JSON.stringify({ csrfToken: 'test-csrf' }))), /Firebase unavailable/);
});
test('fichier administrateur manquant : réponse 500 contrôlée et serveur toujours disponible', async () => {
  const logs = [];
  const server = createMovixServer({ readDocument() { throw Object.assign(new Error('SECRET_PATH_NOT_FOR_LOG'), { code: 'ENOENT' }); }, onError(code) { logs.push(code); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const failed = await fetch(base + '/admin'); assert.equal(failed.status, 500);
    assert.equal(await failed.text(), 'Service temporairement indisponible'); assert.deepEqual(logs, ['ENOENT']);
    const head = await fetch(base + '/admin', { method: 'HEAD' }); assert.equal(head.status, 500); assert.equal(await head.text(), '');
    assert.equal((await fetch(base + '/')).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('CSP complète sur pages, erreurs et administration ; HSTS en HTTPS', async () => {
  const server = createMovixServer({ origin: 'https://movix.example' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const route of ['/', '/connexion.html', '/admin', '/unknown-file', '/api/unknown']) {
      const response = await fetch(base + route); const csp = response.headers.get('content-security-policy');
      assert.match(csp, /script-src 'self' https:\/\/www.gstatic.com\/firebasejs\//);
      assert.match(csp, /script-src-attr 'none'/); assert.match(csp, /object-src 'none'/);
      assert.doesNotMatch(csp.split(';').find(part => part.trim().startsWith('script-src ')), /unsafe-inline|unsafe-eval/);
      assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
      assert.match(response.headers.get('strict-transport-security'), /max-age=31536000/);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
