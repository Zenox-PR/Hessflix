// Manual embed integration, based on the integration URL supplied by the owner.
// No undocumented API endpoint is called; VIDMOLY_API_KEY is never read here.
const { HttpError } = require('./policy.cjs');

function videoSource(value, rightsConfirmed) {
  if (rightsConfirmed !== true) throw new HttpError(400, 'VIDEO_RIGHTS_REQUIRED');
  if (typeof value !== 'string' || value.length > 200) throw new HttpError(400, 'VIDEO_INVALID_URL');
  const input = value.trim();
  // Deliberately narrow: do not accept arbitrary hosts, redirects, tracking
  // parameters, HTML iframe snippets, or an inferred Vidmoly API contract.
  if (!/^https:\/\/vidmoly\.org\/embed-[a-z0-9]{12}\.html$/.test(input)) {
    throw new HttpError(400, 'VIDEO_INVALID_URL');
  }
  return { provider: 'vidmoly', embedURL: input, rightsConfirmed: true };
}

function publicVideo(state) {
  try {
    const source = videoSource(state?.approved?.embedURL, state?.approved?.rightsConfirmed);
    return { available: true, provider: source.provider, embedURL: source.embedURL };
  } catch { return { available: false }; }
}

module.exports = { videoSource, publicVideo };
