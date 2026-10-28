const test = require('node:test');
const assert = require('node:assert/strict');
const { mapping } = require('../server/platform-mapping.cjs');
test('French subscriptions include supported ad plans but exclude other countries, rentals and add-on channels', () => {
  const result = mapping({ results: { FR: { flatrate: [{ provider_id: 1796 }, { provider_id: 2100 }, { provider_id: 582 }], rent: [{ provider_id: 337 }] }, US: { flatrate: [{ provider_id: 531 }] } } }, {});
  assert.deepEqual(result.platforms, ['netflix', 'prime-video']);
});
test('manual selections survive; Disney is not automatically Marvel', () => {
  const result = mapping({ results: { FR: { flatrate: [{ provider_id: 337 }] } } }, { production_companies: [{ name: 'Walt Disney Pictures' }] }, ['paramount']);
  assert.deepEqual(result.platforms, ['paramount', 'disney']);
  assert.deepEqual(result.added, ['disney']);
});
test('Marvel universe requires explicit production evidence and does not invent Disney availability', () => {
  assert.deepEqual(mapping({ results: {} }, { production_companies: [{ name: 'Marvel Studios' }] }).platforms, ['marvel']);
  assert.deepEqual(mapping({ results: {} }, {}).platforms, []);
});
test('duplicate offers and reruns are idempotent, malformed data fails closed', () => {
  const data = { results: { FR: { flatrate: [{ provider_id: 531 }, { provider_id: 2303 }] } } };
  const first = mapping(data, {});
  assert.deepEqual(first.platforms, ['paramount']);
  assert.deepEqual(mapping(data, {}, first.platforms).added, []);
  assert.throws(() => mapping({}, {}), { code: 'PLATFORMS_INVALID_RESPONSE' });
  assert.throws(() => mapping({ results: { FR: { flatrate: {} } } }, {}), { code: 'PLATFORMS_INVALID_RESPONSE' });
});
