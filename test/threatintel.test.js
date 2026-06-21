// Tests for the threat-intel enrichment layer (deterministic, zero-dependency demo feed).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { enrich } from '../sim/threatintel.js';

const evt = (over = {}) => ({ severity: 'high', type: 'initial', raw: {}, ...over });

test('purely internal events are not enriched', () => {
  const e = enrich(evt({ src: 'host-1', dst: 'host-2' }));
  assert.equal(e.geo, undefined);
  assert.equal(e.intel, undefined);
});

test('an external actor gets geo + intel attached', () => {
  const e = enrich(evt({ src: 'host-1', dst: '8.8.8.8', raw: { attacker: '8.8.8.8' } }));
  assert.ok(e.geo, 'expected geo enrichment');
  assert.equal(typeof e.geo.cc, 'string');
  assert.equal(typeof e.intel.match, 'boolean');
});

test('a known-bad prefix scores as a high-confidence match', () => {
  const e = enrich(evt({ src: 'host-1', dst: '185.220.101.5', raw: { attacker: '185.220.101.5' } }));
  assert.equal(e.intel.match, true);
  assert.ok(e.intel.score >= 70, `expected score >= 70, got ${e.intel.score}`);
});

test('a benign external IP stays below the match threshold', () => {
  const e = enrich(evt({ src: 'host-1', dst: '8.8.8.8', raw: { attacker: '8.8.8.8' } }));
  assert.equal(e.intel.match, false);
  assert.ok(e.intel.score < 25, `background noise should be < 25, got ${e.intel.score}`);
});

test('regression: malicious IOC categories never contain null/undefined', () => {
  // Guards the signed-shift bug: (h >> 5) could go negative and index past the
  // categories array, injecting a null. Sweep many bad IPs to be sure.
  for (let i = 0; i < 500; i++) {
    const ip = `185.220.${i % 256}.${(i * 7) % 256}`;
    const e = enrich(evt({ src: 'host-1', dst: ip, raw: { attacker: ip } }));
    assert.ok(e.intel.categories.length > 0);
    for (const cat of e.intel.categories) {
      assert.equal(typeof cat, 'string', `category should be a string, got ${cat} for ${ip}`);
    }
  }
});

test('enrichment is deterministic for a given IP', () => {
  const ip = '45.83.12.9';
  const a = enrich(evt({ src: 'host-1', dst: ip, raw: { attacker: ip } }));
  const b = enrich(evt({ src: 'host-1', dst: ip, raw: { attacker: ip } }));
  assert.deepEqual(a.geo, b.geo);
  assert.deepEqual(a.intel, b.intel);
});
