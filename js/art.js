// All card art is hand-drawn inline SVG: five landscapes, one per expedition site.
import { SITES } from './game.js';

export const PALETTE = {
  yellow: { main: '#dc9f26', dark: '#8a5a0c', text: '#fff' },
  blue: { main: '#2c72b6', dark: '#15446b', text: '#fff' },
  white: { main: '#e6e2d6', dark: '#76736a', text: '#3a3932' },
  green: { main: '#3c9650', dark: '#1d5a2d', text: '#fff' },
  red: { main: '#c63f2e', dark: '#74201a', text: '#fff' },
};

const SCENES = {
  yellow: `
    <rect width="72" height="64" fill="url(#g-yellow)"/>
    <circle cx="54" cy="19" r="13" fill="#fff4b8" opacity=".28"/><circle cx="54" cy="19" r="8" fill="#fff4b8"/>
    <path d="M5 47 L24 21 L43 47Z" fill="#c98a2e"/><path d="M24 21 L43 47 L31 47Z" fill="#a4651a"/>
    <path d="M0 47 Q18 38 34 48 T72 44 V64 H0Z" fill="#e9b655"/>
    <path d="M0 56 Q22 47 42 58 T72 54 V64 H0Z" fill="#d49a3c"/>
    <path d="M58 55 Q57 45 60 36" stroke="#6b4a1e" stroke-width="2" fill="none"/>
    <path d="M60 36 Q52 31 46 36 M60 36 Q57 28 50 27 M60 36 Q66 29 72 31 M60 36 Q67 36 70 42" stroke="#3f8a3a" stroke-width="2.3" fill="none" stroke-linecap="round"/>`,
  blue: `
    <rect width="72" height="64" fill="url(#g-blue)"/>
    <circle cx="13" cy="14" r="6" fill="#fff6c8"/>
    <ellipse cx="48" cy="13" rx="11" ry="3.6" fill="#fff" opacity=".85"/><ellipse cx="54" cy="10" rx="6" ry="3" fill="#fff" opacity=".85"/>
    <rect y="34" width="72" height="30" fill="#2a76b8"/>
    <path d="M0 38 Q9 35 18 38 T36 38 T54 38 T72 38 V64 H0Z" fill="#3a8ed0"/>
    <path d="M25 45 H49 L44 51 H30Z" fill="#7a4a24"/>
    <rect x="36.3" y="22" width="1.6" height="23" fill="#5a3a1a"/>
    <path d="M38.2 23 V43 H50Z" fill="#fff"/><path d="M36 27 V43 H26Z" fill="#f2e4c4"/>
    <path d="M37 22 L44 24.5 L37 27Z" fill="#d6402e"/>
    <path d="M0 53 Q9 49 18 53 T36 53 T54 53 T72 53 V64 H0Z" fill="#1f5f99"/>
    <path d="M0 59 Q9 56 18 59 T36 59 T54 59 T72 59 V64 H0Z" fill="#174a7a"/>`,
  white: `
    <rect width="72" height="64" fill="url(#g-white)"/>
    <circle cx="58" cy="13" r="5" fill="#fffbe6" opacity=".9"/>
    <path d="M0 50 L15 27 L27 41 L42 17 L58 43 L72 31 V64 H0Z" fill="#8c99bb"/>
    <path d="M42 17 L35 29 L40 27 L43 31 L47 27 L50 30Z" fill="#fff"/><path d="M15 27 L10 35 L14 33 L17 36 L20 33Z" fill="#fff"/>
    <path d="M0 64 V52 L22 34 L34 47 L50 32 L72 54 V64Z" fill="#5d6b92"/>
    <path d="M22 34 L16 43 L21 41 L24 44 L28 41Z" fill="#f4f7ff"/><path d="M50 32 L44 41 L49 39 L52 42 L56 39Z" fill="#f4f7ff"/>
    <path d="M0 59 Q20 53 36 59 T72 57 V64 H0Z" fill="#f4f7ff"/>
    <path d="M8 57 L26 51" stroke="#4a4a52" stroke-width=".7"/>
    <path d="M11 56.3 l1.5 3 l1.5 -3.5Z M16 54.8 l1.5 3 l1.5 -3.5Z M21 53.3 l1.5 3 l1.5 -3.5Z" fill="#d6402e"/>`,
  green: `
    <rect width="72" height="64" fill="url(#g-green)"/>
    <path d="M0 45 Q20 30 40 43 T72 37 V64 H0Z" fill="#53a04d"/>
    <rect x="45" y="29" width="13" height="4" fill="#9a9a7a"/><rect x="42" y="33" width="19" height="5" fill="#8a8a6a"/><rect x="39" y="38" width="25" height="7" fill="#797a5d"/>
    <rect x="49" y="24" width="5" height="5" fill="#9a9a7a"/>
    <path d="M0 53 Q24 43 48 53 T72 49 V64 H0Z" fill="#2f7a3a"/>
    <rect x="12.5" y="30" width="3" height="20" fill="#5e3f22"/><circle cx="14" cy="26" r="10" fill="#2c7d36"/><circle cx="9" cy="30" r="6" fill="#3a9444"/>
    <path d="M0 64 Q8 47 23 49 Q13 55 11 64Z" fill="#1c5c2d"/><path d="M72 64 Q64 45 49 50 Q60 56 62 64Z" fill="#236a34"/>
    <circle cx="31" cy="22" r="2" fill="#e04a3a"/><path d="M29 22 l-3 1 l3 1Z" fill="#f0b030"/>`,
  red: `
    <rect width="72" height="64" fill="url(#g-red)"/>
    <circle cx="36" cy="27" r="17" fill="#ff9a3c" opacity=".32"/>
    <circle cx="30" cy="14" r="5" fill="#6d4a4a" opacity=".75"/><circle cx="38" cy="9" r="6" fill="#7a5656" opacity=".75"/><circle cx="46" cy="13" r="4.5" fill="#6d4a4a" opacity=".7"/>
    <path d="M5 58 L28 24 H44 L67 58Z" fill="#3b2323"/>
    <path d="M28 24 Q36 29 44 24 Q36 21 28 24Z" fill="#ffb92e"/>
    <path d="M33 26 Q31 36 34 41 Q36 49 31 57 L37 57 Q41 47 38 38 Q39 31 38 27Z" fill="#ff7a1e"/>
    <path d="M42 26 Q47 34 44 43 L49 54 L52 54 Q48 44 46 37 Q47 31 45 27Z" fill="#f05a1a"/>
    <path d="M0 57 Q20 52 36 58 T72 55 V64 H0Z" fill="#2a1717"/>
    <circle cx="22" cy="19" r="1" fill="#ffd27a"/><circle cx="54" cy="21" r="1.1" fill="#ffd27a"/><circle cx="49" cy="10" r=".8" fill="#ffd27a"/>`,
};

const GRADS = {
  yellow: ['#ffcf7a', '#f8a24c'],
  blue: ['#8fcdf0', '#e6f5ff'],
  white: ['#c7d3ee', '#f2f5ff'],
  green: ['#b7e3a8', '#f0f8c8'],
  red: ['#3f1626', '#e9693a'],
};

const HANDSHAKE = `
  <path d="M1 7 L11 5 L15 10 L11 23 L1 21Z" fill="#35506e"/>
  <path d="M39 7 L29 5 L25 10 L29 23 L39 21Z" fill="#a8362c"/>
  <path d="M11 7 Q20 1 29 7 L31 14 Q25 25 16 21 L11 14Z" fill="#f2c9a0" stroke="#8a5a30" stroke-width="1" stroke-linejoin="round"/>
  <path d="M17 17 q3 3 6 0 M19 13 q3 3 6 0 M16 10 q3 3 6 0" stroke="#8a5a30" stroke-width=".9" fill="none" stroke-linecap="round"/>`;

/** Hidden SVG with shared gradients, symbols and clip paths; inject once into the page. */
export function defsSVG() {
  const grads = Object.entries(GRADS)
    .map(([k, [a, b]]) => `<linearGradient id="g-${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`)
    .join('');
  const syms = Object.entries(SCENES)
    .map(([k, body]) => `<symbol id="sc-${k}" viewBox="0 0 72 64" preserveAspectRatio="xMidYMid slice">${body}</symbol>`)
    .join('');
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    ${grads}${syms}
    <symbol id="handshake" viewBox="0 0 40 28">${HANDSHAKE}</symbol>
    <clipPath id="clip-emb"><circle r="8"/></clipPath>
    <clipPath id="clip-panel"><rect x="7" y="28" width="70" height="64" rx="4"/></clipPath>
    <linearGradient id="g-back" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d3a5c"/><stop offset="1" stop-color="#0f2238"/></linearGradient>
  </defs></svg>`;
}

const FONT = "Cinzel, 'Palatino Linotype', Georgia, serif";

export function cardSVG(card) {
  const p = PALETTE[card.color];
  const isW = card.value === 0;
  const label = SITES[card.color].toUpperCase();
  const head = isW
    ? `<use href="#handshake" x="8" y="6.5" width="22" height="15"/>`
    : `<text x="11" y="19.5" font-size="17" font-weight="800" fill="${p.text}" font-family="${FONT}">${card.value}</text>`;
  const medal = isW
    ? `<circle cx="42" cy="78" r="13" fill="#f8f1de" stroke="${p.dark}" stroke-width="1.6"/><use href="#handshake" x="31" y="70.5" width="22" height="15"/>`
    : `<circle cx="42" cy="78" r="12" fill="#f8f1de" stroke="${p.dark}" stroke-width="1.6"/><text x="42" y="84.5" text-anchor="middle" font-size="${card.value === 10 ? 15 : 18}" font-weight="800" fill="${p.dark}" font-family="${FONT}">${card.value}</text>`;
  return `<svg class="face" viewBox="0 0 84 118" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="82" height="116" rx="8" fill="#f8f1de" stroke="${p.dark}" stroke-width="2"/>
    <path d="M4 25 V11 Q4 4 11 4 H73 Q80 4 80 11 V25Z" fill="${p.main}"/>
    <path d="M4 96 H80 V107 Q80 114 73 114 H11 Q4 114 4 107Z" fill="${p.main}"/>
    ${head}
    <g transform="translate(69 14.5)"><g clip-path="url(#clip-emb)"><use href="#sc-${card.color}" x="-8" y="-8" width="16" height="16"/></g><circle r="8" fill="none" stroke="${p.text}" stroke-width="1" opacity=".8"/></g>
    <g clip-path="url(#clip-panel)"><use href="#sc-${card.color}" x="7" y="28" width="70" height="64"/></g>
    <rect x="7" y="28" width="70" height="64" rx="4" fill="none" stroke="${p.dark}" stroke-width="1.4"/>
    ${medal}
    <text x="12" y="108.5" font-size="7.5" letter-spacing="1" fill="${p.text}" font-family="${FONT}" font-weight="700">${isW ? 'WAGER' : label}</text>
    <text x="72" y="109" text-anchor="end" font-size="11" font-weight="800" fill="${p.text}" font-family="${FONT}">${isW ? '×2' : card.value}</text>
  </svg>`;
}

export function backSVG() {
  return `<svg class="face" viewBox="0 0 84 118" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="82" height="116" rx="8" fill="url(#g-back)" stroke="#d9b45a" stroke-width="2"/>
    <rect x="6" y="6" width="72" height="106" rx="5" fill="none" stroke="#d9b45a" stroke-width="1" opacity=".7"/>
    <g transform="translate(42 59)" fill="none" stroke="#d9b45a" stroke-linejoin="round">
      <circle r="22" stroke-width="1.2" opacity=".8"/><circle r="16" stroke-width=".8" opacity=".6"/>
      <path d="M0 -30 L5 -5 L30 0 L5 5 L0 30 L-5 5 L-30 0 L-5 -5Z" fill="#d9b45a" stroke="#f1d78c" stroke-width=".8"/>
      <path d="M0 -17 L3 -3 L17 0 L3 3 L0 17 L-3 3 L-17 0 L-3 -3Z" transform="rotate(45)" fill="#8fb4d8" stroke="none" opacity=".85"/>
    </g>
    <text x="42" y="16" text-anchor="middle" font-size="6" letter-spacing="1.5" fill="#d9b45a" font-family="${FONT}" font-weight="700">LOST CITIES</text>
    <text x="42" y="109" text-anchor="middle" font-size="6" letter-spacing="1.5" fill="#d9b45a" font-family="${FONT}" font-weight="700">LOST CITIES</text>
  </svg>`;
}

/** Round emblem of a site (used on empty piles and lane headers). */
export function emblemSVG(color, size = 56) {
  const p = PALETTE[color];
  return `<svg viewBox="-20 -20 40 40" width="${size}" height="${size}"><g clip-path="url(#clip-emb)" transform="scale(2.4)"><use href="#sc-${color}" x="-8" y="-8" width="16" height="16"/></g><circle r="19" fill="none" stroke="${p.main}" stroke-width="2"/></svg>`;
}
