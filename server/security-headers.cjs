const CSP = [
  "default-src 'self'",
  "script-src 'self' https://www.gstatic.com/firebasejs/ https://apis.google.com https://accounts.google.com/gsi/",
  "script-src-attr 'none'",
  // Les dégradés, canvas et animations existants utilisent des styles dynamiques.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' https: data:",
  "media-src 'self'",
  "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://www.gstatic.com https://apis.google.com https://accounts.google.com https://demo-hessflix.firebaseapp.com",
  "frame-src https://demo-hessflix.firebaseapp.com https://accounts.google.com https://vidmoly.org",
  "worker-src 'self'",
  "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'"
].join('; ');
function applySecurityHeaders(response, https) {
  response.setHeader('Content-Security-Policy', CSP);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (https) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
}
module.exports = { CSP, applySecurityHeaders };
