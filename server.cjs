// Serveur Movix : seuls les fichiers publics déclarés ci-dessous sont exposés.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createAdminRoutes } = require('./server/admin-routes.cjs');
const { getFirebaseAuth } = require('./server/firebase-admin.cjs');
const { applySecurityHeaders } = require('./server/security-headers.cjs');
const { createProfileRoutes, createProfileRepository } = require('./server/viewer-profiles.cjs');
const { createCloudProfiles, createPersonalStore }=require('./server/personal-store.cjs');
const { createPersonalRoutes }=require('./server/personal-routes.cjs');
const { createTMDBRoutes } = require('./server/tmdb-routes.cjs');
const { createCatalogueStore } = require('./server/catalogue-store.cjs');
const { createCatalogueRoutes } = require('./server/catalogue-routes.cjs');
const { getCatalogueFirestore } = require('./server/catalogue-firestore.cjs');
const { createHeroStore } = require('./server/hero-store.cjs');
const { serveStatic } = require('./server/static-files.cjs');
const root = fs.realpathSync(__dirname);
// Node charge .env côté serveur seulement, sans dépendance et sans écraser l'environnement de l'hébergeur.
if (require.main === module && fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const port = Number(process.env.MOVIX_PORT || 4180);
const publicFiles = new Set(['index.html', 'netflix.html', 'prime-video.html', 'paramount.html', 'disney.html', 'marvel.html', 'titre.html', 'connexion.html', 'compte.html', 'admin-access.html', 'styles.css', 'platforms.css', 'platform-page.css', 'ambient.css', 'account.css', 'account-pages.css', 'title-page.css', 'admin.css', 'app.js', 'platforms.js', 'platform-page.js', 'title-navigation.js', 'title-page.js', 'episode-data.js', 'ambient.js', 'account.js', 'account-login.js', 'account-page.js', 'catalogue-model.js', 'auth-session.js', 'firebase-auth.js', 'admin-access.js', 'admin-dashboard.js']);
for (const file of ['avatar-picker.css', 'avatar-picker.js', 'avatar-catalogue.js', 'profiles.js', 'profile-picker.css', 'discovery.css', 'discovery-data.js', 'discovery.js', 'catalogue-ui.js', 'platform-catalogue-data.js']) publicFiles.add(file);
for (const file of ['tmdb-client.js', 'tmdb-browser.js', 'tmdb-episodes.js', 'tmdb.css', 'credits.html']) publicFiles.add(file);
for (const file of ['discovery-data.js','platform-catalogue-data.js','episode-data.js']) publicFiles.delete(file);
for (const file of ['admin-catalogue.js','admin-catalogue.css','liquid-ui.css']) publicFiles.add(file);
for (const file of ['profile-activity.js','profile-dashboard.js','profile-dashboard.css']) publicFiles.add(file);
for (const file of ['personal-model.js', 'personal-sync.js']) publicFiles.add(file);
for (const file of ['catalogue-loading.js', 'catalogue-loading.css', 'hero.js', 'hero.css', 'admin-hero.js', 'admin-hero.css']) publicFiles.add(file);
for (const file of ['video-player.js', 'video-player.css', 'title-video.js', 'admin-video.js']) publicFiles.add(file);
function createMovixServer({
  getAuth, tmdbClient, getFirestore = getCatalogueFirestore, catalogueStore,
  origin = process.env.MOVIX_PUBLIC_ORIGIN || `http://localhost:${port}`,
  profilesDirectory, readDocument = fs.readFileSync,
  onError = code => console.error(JSON.stringify({ event: 'http_request_failed', code }))
} = {}) {
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.origin !== origin || (parsedOrigin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsedOrigin.hostname))) throw new Error('MOVIX_PUBLIC_ORIGIN doit être une origine HTTPS, ou localhost en développement.');
  if (process.env.NODE_ENV === 'production' && parsedOrigin.protocol !== 'https:') throw new Error('HTTPS obligatoire en production.');
  getAuth ||= () => getFirebaseAuth({ production: parsedOrigin.protocol === 'https:' || process.env.NODE_ENV === 'production' });
  const admin = createAdminRoutes({ getAuth, origin });
  const profileRepository = profilesDirectory
    ? createProfileRepository(profilesDirectory)
    : createCloudProfiles({ getFirestore, legacyDirectory: process.env.MOVIX_PROFILES_DIRECTORY || path.join(root, '.data', 'viewer-profiles') });
  const profiles = createProfileRoutes({ getAuth, origin, repository:profileRepository });
  const personal = createPersonalRoutes({ getAuth, origin, store: createPersonalStore({ getFirestore, profiles: profileRepository }) });
  const tmdb = createTMDBRoutes({ root, client: tmdbClient });
  const store = catalogueStore || createCatalogueStore({ getFirestore });
  const hero = createHeroStore({ getFirestore: store.database || getFirestore, catalogue: store, images: entry => tmdb.images(entry.mediaType, entry.tmdbId) });
  const catalogue = createCatalogueRoutes({ admin, tmdb, store, root, hero });
  async function handleApi(request, response, pathname) {
    const url = new URL(request.url, origin);
    if (pathname.startsWith('/api/personal/')) return personal.handle(request, response, pathname);
    if (pathname === '/api/admin/catalogue' || pathname.startsWith('/api/admin/catalogue/')) return catalogue.handleAdmin(request, response, url);
    if (pathname === '/api/catalogue' || pathname.startsWith('/api/catalogue/')) return catalogue.handlePublic(request, response, url);
    if (pathname.startsWith('/api/admin/tmdb/') || pathname.startsWith('/api/tmdb/')) {
      try {
        await admin.requireSession(request);
        url.pathname = url.pathname.replace('/api/admin/tmdb/', '/api/tmdb/');
        await tmdb.handle(request, response, url);
      } catch (error) { admin.error(response, error); }
      return;
    }
    if (pathname === '/api/profiles' || pathname.startsWith('/api/profiles/')) return profiles.handle(request, response, pathname);
    try { await admin.handle(request, response, pathname); }
    catch (error) { admin.error(response, error); }
  }

  const server = http.createServer({
    requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 16384
  }, async (request, response) => {
    applySecurityHeaders(response, parsedOrigin.protocol === 'https:');
    try {
      const fail = (code, text) => {
        response.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(text);
      };
      let pathname;
      try { pathname = decodeURIComponent(new URL(request.url, origin).pathname); }
      catch { return fail(400, 'Adresse invalide'); }

      if (pathname.startsWith('/api/')) return await handleApi(request, response, pathname);
      if (pathname === '/catalogue-data.js' && request.method === 'GET') return await catalogue.script(request, response);
      if (pathname === '/assets/discovery/SOURCES.md') {
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end('Les sources des contenus publiés sont indiquées sur leurs fiches. Les anciens fichiers de sélection ne sont plus servis publiquement.');
        return;
      }
      if (pathname === '/admin/') {
        response.writeHead(308, { Location: '/admin', 'Cache-Control': 'no-store' });
        response.end();
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) return fail(405, 'Méthode non autorisée');
      if (pathname === '/admin') {
        let filename = 'admin-private/dashboard.html', status = 200;
        try { await admin.requireSession(request); }
        catch (error) {
          if (error.status === 429) return admin.error(response, error);
          filename = 'admin-access.html';
          status = error.status || 401;
        }
        const document = readDocument(path.join(root, filename));
        response.writeHead(status, {
          'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, private',
          Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
          ...(status !== 200 ? { 'Set-Cookie': admin.clearSession() } : {})
        });
        response.end(request.method === 'HEAD' ? undefined : document);
        return;
      }

      const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      const publicAsset = relative.startsWith('assets/') && !relative.split('/').some(part => part.startsWith('.'));
      if (!publicFiles.has(relative) && !publicAsset) return fail(404, 'Fichier introuvable');
      await serveStatic(request, response, { root, relative, fail });
    } catch (error) {
      const code = typeof error.code === 'string' && /^[A-Z_0-9]{1,64}$/.test(error.code) ? error.code : 'UNEXPECTED';
      try { onError(code); } catch { /* Un journal défaillant ne doit pas interrompre le serveur. */ }
      if (response.headersSent) { response.destroy(); return; }
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : 'Service temporairement indisponible');
    }
  });
  return server;
}
if (require.main === module) {
  const server = createMovixServer();
  server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `Le port ${port} est occupé. Si Hessflix est déjà lancé, ouvrez http://localhost:${port}.` : 'Impossible de démarrer le serveur local.');
  process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`Hessflix : http://localhost:${port}\nGardez cette fenêtre ouverte. Ctrl+C pour arrêter.`));
}
module.exports = { createMovixServer };
