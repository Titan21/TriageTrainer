// Colours for the illustration system. Clothing comes from a fixed muted palette
// that never uses the tag colours (red, orange, green, black); the choice is
// deterministic from the casualty id.

import { hash, mix, darken, hexToRgb, rgbToHsl } from './util.js';

export const OUTLINE = '#2d3038';
export const INK = '#1f2228';

export const SKIN = { light: '#f1c9a5', medium: '#c48f63', dark: '#7b4c33' };
export const HAIR = ['#3a2a22', '#6b4630', '#caa66a', '#5a5048', '#8d8379'];

// Muted palettes. Checked against the tag colours by checkCoverage().
export const TOP_PALETTE = ['#6f8fb5', '#8878a8', '#a3a8ae', '#d8d1bd', '#9cc0d8', '#b9b1d6', '#a98199', '#b3a782', '#7a5c7e', '#7a8fa0'];
export const BOTTOM_PALETTE = ['#3f5273', '#566170', '#6b5846', '#7c8089', '#8c7f66', '#4a5f7a', '#5d4f6b', '#9a9084'];
export const SHOE_PALETTE = ['#6a5546', '#59606a', '#6c6f75', '#a39c92'];
export const FIXED_COLOURS = {
  hiVis: '#e9dc4c', silver: '#cfd4da', school: '#e3e9f0', schoolAccent: '#3f5273',
  chalk: '#f4f4ee', gauze: '#fbfbf7', glove: '#7b5ea7', board: '#c8a66a', metal: '#9aa1a8',
  band: '#25272c', // tourniquet band: near-black, deliberately not the tag black (#111111)
};

export const BLOOD = { fill: '#5e0b15', hatch: '#9a3345', edge: '#3a0610' };
export const WOUND = { dark: '#4a0f1a', margin: '#eaa0ab' };

/** Values of `look` the renderer can draw (checked against vocab.look by checkCoverage). */
export const LOOK_SUPPORT = {
  skinTone: Object.keys(SKIN),
  hair: ['short', 'long', 'tied', 'bald', 'curly'],
  top: ['tshirt', 'jacket', 'shirt', 'hi_vis', 'school_uniform', 'hoodie'],
  bottom: ['trousers', 'shorts', 'skirt', 'overalls'],
};

const pick = (list, id, salt) => list[hash(`${id}:${salt}`) % list.length];

/**
 * Resolve every colour used to draw a figure.
 * flags: { pallor, wet } come from the appearance overlays.
 */
export function resolveStyle(id, look = {}, flags = {}) {
  const skinTone = SKIN[look.skinTone] ? look.skinTone : 'medium';
  let skin = SKIN[skinTone];
  let lip = mix(skin, '#9b3d4a', 0.38);
  let lid = mix(skin, '#000000', 0.1);
  if (flags.pallor) {
    skin = mix(skin, '#aab0b8', skinTone === 'dark' ? 0.5 : 0.58);
    lip = '#a7a9ad';
    lid = '#9a9ea4';
  }
  const hairStyle = LOOK_SUPPORT.hair.includes(look.hair) ? look.hair : 'short';
  let hair = pick(HAIR, id, 'hair');
  const topKind = LOOK_SUPPORT.top.includes(look.top) ? look.top : 'tshirt';
  const bottomKind = LOOK_SUPPORT.bottom.includes(look.bottom) ? look.bottom : 'trousers';
  let topColour = pick(TOP_PALETTE, id, 'top');
  let bottomColour = pick(BOTTOM_PALETTE, id, 'bottom');
  let shoe = pick(SHOE_PALETTE, id, 'shoe');
  let accent = darken(topColour, 0.25);
  if (topKind === 'hi_vis') { topColour = FIXED_COLOURS.hiVis; accent = FIXED_COLOURS.silver; }
  if (topKind === 'school_uniform') { topColour = FIXED_COLOURS.school; accent = FIXED_COLOURS.schoolAccent; }
  if (flags.wet) {
    const wetten = (c) => mix(darken(c, 0.22), '#4d6178', 0.18);
    topColour = wetten(topColour); bottomColour = wetten(bottomColour); shoe = wetten(shoe); hair = darken(hair, 0.25);
    accent = wetten(accent);
  }
  return { skinTone, skin, lip, lid, hair, hairStyle, topKind, topColour, accent, bottomKind, bottomColour, shoe, hairFlat: !!flags.wet, outline: OUTLINE };
}

/**
 * True if a colour sits in one of the tag colour families (strong red, orange,
 * green, or near black). Used to prove the clothing palette stays clear of tags.
 */
export function looksLikeTagColour(hex) {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  if (l < 0.1) return 'black';
  if (s > 0.45 && l > 0.2 && l < 0.75) {
    if (h >= 345 || h < 12) return 'red';
    if (h >= 12 && h < 48) return 'orange';
    if (h >= 75 && h < 170) return 'green';
  }
  return null;
}

/** Colour distance (simple RGB euclid), used to compare against the real tag colours. */
export function colourDistance(a, b) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}
