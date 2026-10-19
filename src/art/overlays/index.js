// Registry: one draw function per overlay in vocab.overlays.

import { INJURY_OVERLAYS } from './injury.js';
import { APPEARANCE_OVERLAYS } from './appearance.js';
import { PROBE_OVERLAYS } from './probe.js';
import { INTERVENTION_OVERLAYS } from './intervention.js';

export const OVERLAYS = { ...INJURY_OVERLAYS, ...APPEARANCE_OVERLAYS, ...PROBE_OVERLAYS, ...INTERVENTION_OVERLAYS };

/** Which layer an overlay's own SVG goes in. */
export const KIND_LAYER = {
  injury: 'injuries',
  entrapment: 'entrapment',
  appearance: 'appearance',
  probe: 'probes',
  intervention: 'interventions',
};
export const layerOf = (name, kind) => OVERLAYS[name]?.layer ?? KIND_LAYER[kind] ?? 'appearance';
