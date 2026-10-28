const { PLATFORM_IDS, platforms } = require('./catalogue-model.cjs');

// French subscription offers only. Channels sold as separate add-ons are excluded.
const PROVIDERS = Object.freeze({
  8: 'netflix', 1796: 'netflix',
  119: 'prime-video', 2100: 'prime-video',
  337: 'disney', 531: 'paramount', 2303: 'paramount'
});

function mapping(providers, details, previous = []) {
  if (!providers || !providers.results || typeof providers.results !== 'object' || Array.isArray(providers.results)) {
    throw Object.assign(new Error('Invalid provider response'), { code: 'PLATFORMS_INVALID_RESPONSE' });
  }
  const offers = providers.results.FR?.flatrate || [];
  if (!Array.isArray(offers)) throw Object.assign(new Error('Invalid offers'), { code: 'PLATFORMS_INVALID_RESPONSE' });
  const confirmed = new Set(offers.map(offer => PROVIDERS[offer.provider_id]).filter(Boolean));
  // Marvel is a creative universe, not a subscription service. Studio ownership
  // alone (Disney, for example) does not make a title part of Marvel.
  const marvel = (details?.production_companies || []).some(company =>
    /\bmarvel\b/i.test(company.name || ''));
  if (marvel) confirmed.add('marvel');
  const before = platforms(previous);
  const selected = PLATFORM_IDS.filter(id => before.includes(id) || confirmed.has(id));
  return { platforms: selected, added: selected.filter(id => !before.includes(id)),
    providers: offers.filter(offer => PROVIDERS[offer.provider_id]).map(offer => ({ id: offer.provider_id, name: offer.provider_name })),
    marvel, sourceURL: providers.results.FR?.link || '' };
}

module.exports = { mapping, PROVIDERS };
