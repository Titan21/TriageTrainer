// Illustration system entry point. Pure ES modules: no DOM, no Node APIs.
//
//   renderCasualty(casualty, view, { vocab, actions, rules }) -> { svg, warnings, anchors }
//   renderBystander(bystander, { vocab, actions, rules })       -> { svg, warnings }
//   checkCoverage(vocab, { rules })                             -> string[] of gaps
//   getAnchors(pose, ageGroup, vocab)                           -> region anchors visible in that pose

import { renderCasualty, resolveStage, stageChain, debugRegionOrder, LAYERS } from './render.js';
import { checkCoverage, overlayProbe, overlayRegions, paramCombos, poseShowing } from './coverage.js';
import { getSkeleton, getAnchors, deriveAnchors, POSES, PROPORTIONS, VIEWBOX } from './skeleton.js';
import { OVERLAYS } from './overlays/index.js';

/** Bystanders are drawn with the same figure system: pose standing unless given, with `look`. */
export function renderBystander(bystander, content = {}, view = {}) {
  const cas = { id: bystander.id, title: bystander.description, ageGroup: bystander.ageGroup ?? 'adult', pose: bystander.pose ?? 'standing', look: bystander.look, appearance: bystander.appearance ?? [], findings: [], state: { responsive: 'alert' } };
  return renderCasualty(cas, { callouts: 'none', ...view }, content);
}

export {
  renderCasualty, resolveStage, stageChain, debugRegionOrder, checkCoverage, overlayProbe, overlayRegions, paramCombos, poseShowing,
  getSkeleton, getAnchors, deriveAnchors, POSES, PROPORTIONS, VIEWBOX, OVERLAYS, LAYERS,
};
