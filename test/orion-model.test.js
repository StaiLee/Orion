// Tests for the Orion domain model — the single contract between ingestion and rendering.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SEVERITY,
  COSMIC_BY_SEVERITY,
  ATTACK_PHASES,
  makeEvent,
  makeFlux,
} from '../sim/orion-model.js';

test('every severity maps to a cosmic body and a colour', () => {
  for (const sev of SEVERITY) {
    const mapping = COSMIC_BY_SEVERITY[sev];
    assert.ok(mapping, `missing cosmic mapping for ${sev}`);
    assert.match(mapping.color, /^#[0-9a-f]{6}$/i);
    assert.equal(typeof mapping.cosmic, 'string');
  }
});

test('makeEvent applies the severity -> cosmic/colour mapping', () => {
  const e = makeEvent({ severity: 'critical', type: 'initial', ts: 1 });
  assert.equal(e.cosmic, COSMIC_BY_SEVERITY.critical.cosmic);
  assert.equal(e.color, COSMIC_BY_SEVERITY.critical.color);
});

test('exfiltration events are always rendered as a black hole', () => {
  // The metaphor for data leaving the network is a black hole, regardless of severity.
  const e = makeEvent({ severity: 'low', type: 'exfiltration', ts: 1 });
  assert.equal(e.cosmic, 'blackhole');
});

test('makeEvent falls back to info for an unknown severity', () => {
  const e = makeEvent({ severity: 'banana', type: 'recon', ts: 1 });
  assert.equal(e.color, COSMIC_BY_SEVERITY.info.color);
});

test('makeEvent fills sensible defaults', () => {
  const e = makeEvent({ severity: 'medium', type: 'recon' });
  assert.equal(e.mitre, null);
  assert.equal(e.incident, null);
  assert.deepEqual(e.raw, {});
  assert.equal(typeof e.ts, 'number');
});

test('event ids are unique and prefixed', () => {
  const a = makeEvent({ severity: 'low', type: 'recon', ts: 1 });
  const b = makeEvent({ severity: 'low', type: 'recon', ts: 1 });
  assert.notEqual(a.id, b.id);
  assert.match(a.id, /^evt-/);
});

test('makeFlux defaults to a nominal tcp/443 trajectory', () => {
  const f = makeFlux({ src: 'host-1', dst: 'host-2' });
  assert.equal(f.protocol, 'tcp/443');
  assert.equal(f.status, 'nominal');
  assert.equal(f.bytes, 0);
  assert.match(f.id, /^flux-/);
});

test('ATT&CK phases expose a tactic and a MITRE technique id', () => {
  for (const [key, p] of Object.entries(ATTACK_PHASES)) {
    assert.equal(typeof p.tactic, 'string', `${key} missing tactic`);
    assert.match(p.mitre, /^T\d{4}/, `${key} has an invalid MITRE id`);
  }
});
