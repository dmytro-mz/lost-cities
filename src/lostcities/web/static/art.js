// All artwork is original SVG drawn in code: five landscapes, a ruined city per site that comes closer as the
// card value rises, the backer (wager) scene, the card back and small site emblems.
import { h, s } from "./dom.js";

export const COLORS = ["yellow", "blue", "white", "green", "red"];
export const SITE = {
  yellow: "Sun Canyon",
  blue: "Sunken Reef",
  white: "Glacier Pass",
  green: "Emerald Falls",
  red: "Ember Caldera",
};
// frame light, frame dark, ink (text on the frame), accent
export const PALETTE = {
  yellow: ["#f0b429", "#8a5a06", "#3b2400", "#ffe08a"],
  blue: ["#3a8fd6", "#123f6e", "#06213d", "#a9dcff"],
  white: ["#dfe6ec", "#66788a", "#1f2a35", "#ffffff"],
  green: ["#5fae45", "#1f4d17", "#0c2608", "#c9f2a0"],
  red: ["#e0533a", "#6a160b", "#2e0702", "#ffc0a8"],
};
export const SEAT_FILL = { amber: ["#f4b942", "#9a5d0a"], teal: ["#3fc1b0", "#11685d"] };

const DEFS = `
<defs>
  <linearGradient id="sky-yellow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7c66a"/><stop offset=".55" stop-color="#fbe3a4"/><stop offset="1" stop-color="#f4c77a"/></linearGradient>
  <linearGradient id="sand-near" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3a453"/><stop offset="1" stop-color="#b86f2a"/></linearGradient>
  <linearGradient id="mesa" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9824a"/><stop offset="1" stop-color="#9c4a22"/></linearGradient>
  <radialGradient id="sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fffbe6"/><stop offset=".45" stop-color="#ffe9a0"/><stop offset="1" stop-color="#ffd36a" stop-opacity="0"/></radialGradient>

  <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#57c3d8"/><stop offset=".45" stop-color="#1f7fa6"/><stop offset="1" stop-color="#0b3556"/></linearGradient>
  <linearGradient id="ray" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6fbff" stop-opacity=".55"/><stop offset="1" stop-color="#e6fbff" stop-opacity="0"/></linearGradient>
  <linearGradient id="seabed" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f7c86"/><stop offset="1" stop-color="#123b4d"/></linearGradient>

  <linearGradient id="sky-white" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fb4d6"/><stop offset=".6" stop-color="#dbe8f2"/><stop offset="1" stop-color="#f4f8fb"/></linearGradient>
  <linearGradient id="snow" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c4d6e6"/></linearGradient>
  <linearGradient id="rock-blue" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7c93ab"/><stop offset="1" stop-color="#4b6078"/></linearGradient>

  <linearGradient id="sky-green" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe3b0"/><stop offset=".6" stop-color="#e8f3d2"/><stop offset="1" stop-color="#9ccf8a"/></linearGradient>
  <linearGradient id="jungle-far" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5f9c63"/><stop offset="1" stop-color="#3c7445"/></linearGradient>
  <linearGradient id="jungle-near" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f6b2c"/><stop offset="1" stop-color="#173d16"/></linearGradient>
  <linearGradient id="falls" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eaffff"/><stop offset="1" stop-color="#9fd8e6"/></linearGradient>

  <linearGradient id="sky-red" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a0f0c"/><stop offset=".5" stop-color="#8e2a14"/><stop offset="1" stop-color="#e2722c"/></linearGradient>
  <linearGradient id="basalt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a2a24"/><stop offset="1" stop-color="#1c0d0a"/></linearGradient>
  <linearGradient id="lava" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0a0"/><stop offset=".4" stop-color="#ffa22e"/><stop offset="1" stop-color="#d1300f"/></linearGradient>
  <radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffb347" stop-opacity=".9"/><stop offset="1" stop-color="#ff5a1f" stop-opacity="0"/></radialGradient>

  <linearGradient id="desk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a4a26"/><stop offset="1" stop-color="#3f2410"/></linearGradient>
  <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbf1d6"/><stop offset="1" stop-color="#e2cd9c"/></linearGradient>
  <linearGradient id="back" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d5a57"/><stop offset=".5" stop-color="#123d3b"/><stop offset="1" stop-color="#0a2726"/></linearGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9a8"/><stop offset=".5" stop-color="#d6a43a"/><stop offset="1" stop-color="#8f6114"/></linearGradient>
  <pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="none"/><path d="M0 0v4" stroke="#000" stroke-opacity=".06" stroke-width="1.4"/></pattern>
  <filter id="soft"><feGaussianBlur stdDeviation=".6"/></filter>
</defs>`;

// ---------------------------------------------------------------- landscapes (viewBox 0 0 100 120)
const LAND = {
  yellow: `
    <rect width="100" height="120" fill="url(#sky-yellow)"/>
    <circle cx="74" cy="30" r="22" fill="url(#sun)"/>
    <circle cx="74" cy="30" r="7" fill="#fffdf0"/>
    <path d="M0 62 L8 62 L10 50 L24 50 L26 62 L40 62 L42 56 L52 56 L54 62 L100 62 L100 120 L0 120Z" fill="#e6b27c" opacity=".7"/>
    <path d="M-2 70 L12 70 L14 46 L30 46 L33 70 L60 70 L62 54 L70 52 L78 54 L80 70 L102 70 L102 120 L-2 120Z" fill="url(#mesa)"/>
    <path d="M14 46 L30 46 L29 52 L15 52Z M62 54 L78 54 L77 58 L63 58Z" fill="#f1a971" opacity=".8"/>
    <path d="M38 70 q6 -12 12 0" fill="none" stroke="#9c4a22" stroke-width="3"/>
    <path d="M-2 82 Q20 72 44 80 T102 76 L102 120 L-2 120Z" fill="#eebd7c"/>
    <path d="M-2 96 Q30 84 60 94 T102 90 L102 120 L-2 120Z" fill="url(#sand-near)"/>
    <path d="M8 104 q14 -6 28 0 M58 108 q12 -5 26 0" fill="none" stroke="#fbe0a8" stroke-width="1.2" opacity=".7"/>
    <g fill="#5a3517" opacity=".55"><path d="M86 100 l1 -9 l1 9Z M84 95 h6 v1 h-6Z"/></g>
    <rect width="100" height="120" fill="url(#hatch)"/>`,
  blue: `
    <rect width="100" height="120" fill="url(#sea)"/>
    <path d="M18 0 L30 0 L52 120 L26 120Z M52 0 L60 0 L84 120 L66 120Z" fill="url(#ray)"/>
    <path d="M0 8 q10 -4 20 0 t20 0 t20 0 t20 0 t20 0" fill="none" stroke="#c9f4ff" stroke-width="1.2" opacity=".6"/>
    <g fill="#bfefff" opacity=".6"><circle cx="20" cy="40" r="1.6"/><circle cx="23" cy="33" r="1.1"/><circle cx="19" cy="27" r=".8"/><circle cx="82" cy="52" r="1.4"/><circle cx="84" cy="45" r="1"/></g>
    <g fill="#0d4a6b" opacity=".7"><path d="M64 34 q6 -5 12 0 q-6 5 -12 0Z M76 34 l4 -3 v6Z"/><path d="M30 52 q4 -3 8 0 q-4 3 -8 0Z M38 52 l3 -2 v4Z"/></g>
    <path d="M-2 84 Q22 74 46 82 T102 78 L102 120 L-2 120Z" fill="url(#seabed)"/>
    <g fill="#e2725b"><path d="M8 96 c-2 -8 2 -14 0 -20 c3 4 4 9 2 13 c3 -5 6 -7 7 -12 c1 6 -2 12 -5 19Z"/></g>
    <g fill="#f3b04a"><path d="M84 98 c0 -8 -4 -12 -2 -18 c2 4 4 6 4 10 c2 -4 5 -6 6 -10 c0 6 -2 12 -4 18Z"/></g>
    <g fill="#5fbf8f"><path d="M70 104 c-3 -6 -1 -12 -3 -16 c4 3 5 8 4 12Z M74 104 c0 -6 3 -10 2 -15 c-3 4 -4 9 -3 13Z"/></g>
    <path d="M-2 102 Q30 94 60 102 T102 98 L102 120 L-2 120Z" fill="#0d2c3c"/>
    <rect width="100" height="120" fill="url(#hatch)"/>`,
  white: `
    <rect width="100" height="120" fill="url(#sky-white)"/>
    <path d="M-2 66 L18 30 L28 44 L44 16 L62 48 L74 32 L102 66Z" fill="url(#rock-blue)"/>
    <path d="M18 30 L24 40 L20 44 L28 44Z M44 16 L52 30 L46 28 L40 34Z M74 32 L80 42 L72 40Z" fill="url(#snow)"/>
    <path d="M44 16 L40 34 L36 40 L30 46 L44 44Z" fill="#ffffff" opacity=".6"/>
    <path d="M-2 78 L14 56 L30 74 L48 52 L70 78 L86 60 L102 76 L102 120 L-2 120Z" fill="#9bb4ca"/>
    <path d="M14 56 L20 64 L12 66Z M48 52 L56 62 L44 64Z M86 60 L92 68 L84 68Z" fill="#ffffff"/>
    <path d="M-2 90 Q24 80 50 88 T102 84 L102 120 L-2 120Z" fill="url(#snow)"/>
    <path d="M-2 104 Q30 94 62 104 T102 100 L102 120 L-2 120Z" fill="#e6eef5"/>
    <g fill="#ffffff" opacity=".8"><circle cx="12" cy="14" r=".9"/><circle cx="30" cy="8" r=".7"/><circle cx="66" cy="12" r="1"/><circle cx="86" cy="20" r=".8"/><circle cx="92" cy="8" r=".6"/></g>
    <rect width="100" height="120" fill="url(#hatch)"/>`,
  green: `
    <rect width="100" height="120" fill="url(#sky-green)"/>
    <path d="M-2 60 Q10 40 22 52 Q30 34 44 48 Q56 30 68 46 Q80 34 102 52 L102 120 L-2 120Z" fill="url(#jungle-far)"/>
    <path d="M62 44 L72 44 L74 100 L60 100Z" fill="url(#falls)" opacity=".9"/>
    <path d="M64 50 v40 M68 48 v46 M71 52 v36" stroke="#ffffff" stroke-width=".7" opacity=".7"/>
    <ellipse cx="67" cy="98" rx="16" ry="5" fill="#e9fbff" opacity=".75"/>
    <path d="M-2 86 Q8 70 18 80 Q26 66 38 78 L40 120 L-2 120Z" fill="url(#jungle-near)"/>
    <path d="M102 84 Q94 70 86 80 Q80 68 72 82 L74 120 L102 120Z" fill="url(#jungle-near)"/>
    <path d="M-2 104 Q30 96 62 104 T102 100 L102 120 L-2 120Z" fill="#244f1f"/>
    <g fill="none" stroke="#1d4a1a" stroke-width="1.3"><path d="M6 0 q4 18 -2 34"/><path d="M14 0 q-3 12 2 22"/><path d="M92 0 q-5 14 1 28"/></g>
    <g fill="#2f6b2c"><path d="M4 34 q-5 2 -6 6 q5 0 6 -6Z M16 22 q5 1 6 5 q-5 0 -6 -5Z M93 28 q5 2 6 6 q-5 0 -6 -6Z"/></g>
    <rect width="100" height="120" fill="url(#hatch)"/>`,
  red: `
    <rect width="100" height="120" fill="url(#sky-red)"/>
    <circle cx="50" cy="40" r="30" fill="url(#glow)"/>
    <g fill="#2a1410" opacity=".55"><ellipse cx="40" cy="18" rx="18" ry="7"/><ellipse cx="60" cy="12" rx="14" ry="6"/><ellipse cx="52" cy="24" rx="12" ry="5"/></g>
    <path d="M-2 74 L30 38 L40 34 L60 34 L70 40 L102 74Z" fill="url(#basalt)"/>
    <path d="M40 34 L60 34 L56 38 L44 38Z" fill="url(#lava)"/>
    <path d="M48 38 q-2 10 -8 16 q-4 6 -10 20 M53 38 q3 12 10 20 q4 6 8 16" fill="none" stroke="url(#lava)" stroke-width="2.2"/>
    <g fill="#ffcf6a"><circle cx="46" cy="28" r="1"/><circle cx="54" cy="24" r="1.2"/><circle cx="50" cy="20" r=".8"/></g>
    <path d="M-2 88 Q22 78 46 86 T102 82 L102 120 L-2 120Z" fill="#3b1a14"/>
    <path d="M-2 104 Q30 94 62 104 T102 100 L102 120 L-2 120Z" fill="#1d0c09"/>
    <path d="M10 112 q12 -4 22 0 q10 4 22 -2" fill="none" stroke="#ff7a2a" stroke-width="1" opacity=".6"/>
    <rect width="100" height="120" fill="url(#hatch)"/>`,
};

// The lost city of each site, drawn centred on x=0 standing on y=0 (about 60 wide, 50 tall).
const CITY = {
  yellow: `
    <path d="M-30 0 L-30 -8 L-24 -8 L-24 -16 L-16 -16 L-16 -24 L-8 -24 L-8 -32 L8 -32 L8 -24 L16 -24 L16 -16 L24 -16 L24 -8 L30 -8 L30 0Z" fill="#c98b4a" stroke="#6b3f17" stroke-width="1"/>
    <path d="M-30 -8 H30 M-24 -16 H24 M-16 -24 H16" stroke="#6b3f17" stroke-width=".8"/>
    <path d="M-5 0 V-10 Q0 -16 5 -10 V0Z" fill="#4a2a10"/>
    <path d="M-6 -32 L-6 -42 L6 -42 L6 -32Z" fill="#e0a65e" stroke="#6b3f17" stroke-width="1"/>
    <path d="M-8 -42 L0 -48 L8 -42Z" fill="#b5702f"/>
    <path d="M-20 -8 v-6 M-12 -16 v-6 M12 -16 v-6 M20 -8 v-6" stroke="#f5cf93" stroke-width="1.6"/>`,
  blue: `
    <path d="M-28 0 V-18 H28 V0Z" fill="#5d8fa0" stroke="#163b4a" stroke-width="1"/>
    <path d="M-22 0 V-12 Q-18 -17 -14 -12 V0 M-6 0 V-12 Q-2 -17 2 -12 V0 M10 0 V-12 Q14 -17 18 -12 V0" fill="#163b4a"/>
    <path d="M-20 -18 Q0 -44 20 -18Z" fill="#7fb3bf" stroke="#163b4a" stroke-width="1"/>
    <path d="M0 -38 V-46" stroke="#163b4a" stroke-width="1.6"/><circle cx="0" cy="-47" r="2" fill="#e8c36a"/>
    <path d="M-30 -18 L-26 -26 L-22 -18Z M22 -18 L26 -26 L30 -18Z" fill="#7fb3bf"/>
    <path d="M-28 -2 q6 -6 3 -12 M24 -2 q-5 -8 0 -14" fill="none" stroke="#5fbf8f" stroke-width="1.6"/>`,
  white: `
    <path d="M-30 0 L-22 -10 L-10 -6 L0 -14 L12 -6 L22 -12 L30 0Z" fill="#8aa1b6"/>
    <path d="M-16 -6 V-30 L-10 -38 L-4 -30 V-6Z" fill="#e9f2fa" stroke="#3e5468" stroke-width="1"/>
    <path d="M4 -10 V-40 L10 -50 L16 -40 V-10Z" fill="#f5fbff" stroke="#3e5468" stroke-width="1"/>
    <path d="M-28 -2 V-20 L-24 -26 L-20 -20 V-2Z M20 -4 V-24 L24 -30 L28 -24 V-4Z" fill="#d6e4f0" stroke="#3e5468" stroke-width="1"/>
    <path d="M-10 -24 v-4 M10 -30 v-6 M10 -20 v-4 M24 -18 v-3" stroke="#3e5468" stroke-width="1.6"/>
    <path d="M-4 -12 H4" stroke="#3e5468" stroke-width="1"/>
    <path d="M10 -50 V-56 L16 -54 L10 -52" fill="#c94a3a" stroke="#3e5468" stroke-width=".6"/>`,
  green: `
    <path d="M-32 0 L-26 -8 L-20 -8 L-16 -16 L-10 -16 L-6 -26 L6 -26 L10 -16 L16 -16 L20 -8 L26 -8 L32 0Z" fill="#8f9b73" stroke="#33401f" stroke-width="1"/>
    <path d="M-5 -26 V-34 H5 V-26Z" fill="#a8b38a" stroke="#33401f" stroke-width="1"/>
    <path d="M-3 0 L-1 -26 H1 L3 0Z" fill="#6f7a55"/>
    <path d="M-26 -8 H26 M-16 -16 H16" stroke="#33401f" stroke-width=".8"/>
    <g fill="none" stroke="#2f6b2c" stroke-width="1.8"><path d="M-22 -8 q2 6 -2 10"/><path d="M14 -16 q4 6 0 14"/><path d="M-6 -26 q-4 8 0 14"/><path d="M5 -34 q4 4 2 10"/></g>
    <g fill="#3f8a35"><circle cx="-24" cy="-6" r="2"/><circle cx="16" cy="-12" r="2.2"/><circle cx="-7" cy="-20" r="1.8"/><circle cx="6" cy="-30" r="1.6"/></g>`,
  red: `
    <path d="M-30 0 V-22 L-24 -26 V-30 L-18 -26 V0Z M18 0 V-26 L24 -30 V-26 L30 -22 V0Z" fill="#2a1512" stroke="#ff8a3d" stroke-width=".8"/>
    <path d="M-18 0 V-20 H18 V0Z" fill="#3a1d18" stroke="#ff8a3d" stroke-width=".8"/>
    <path d="M-9 0 V-12 Q0 -24 9 -12 V0Z" fill="url(#lava)"/>
    <path d="M-18 -20 L-12 -26 L-6 -20 L0 -28 L6 -20 L12 -26 L18 -20Z" fill="#2a1512" stroke="#ff8a3d" stroke-width=".8"/>
    <circle cx="0" cy="-34" r="3.4" fill="url(#lava)"/>
    <path d="M-24 -18 v-4 M24 -18 v-4" stroke="#ffb347" stroke-width="1.6"/>`,
};

const EMBLEM = {
  yellow: `<circle r="4.2" fill="currentColor"/><g stroke="currentColor" stroke-width="1.6" stroke-linecap="round">${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<path d="M0 -6.4 V-8.6" transform="rotate(${a})"/>`).join("")}</g>`,
  blue: `<path d="M-8.5 1 q2.8 -4.5 5.6 0 t5.6 0 t5.6 0 M-8.5 5.6 q2.8 -4.5 5.6 0 t5.6 0 t5.6 0" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M-5 -3 q5 -8 10 0" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>`,
  white: `<g stroke="currentColor" stroke-width="1.7" stroke-linecap="round">${[0, 60, 120].map((a) => `<g transform="rotate(${a})"><path d="M0 -8 V8"/><path d="M-2.6 -6 L0 -3.6 L2.6 -6 M-2.6 6 L0 3.6 L2.6 6"/></g>`).join("")}</g>`,
  green: `<path d="M0 8.5 C-7 4 -7 -4 0 -8.5 C7 -4 7 4 0 8.5Z" fill="currentColor"/><path d="M0 8.5 V-6" stroke="rgba(0,0,0,.35)" stroke-width="1.1"/>`,
  red: `<path d="M0 -8.5 C3 -4 6 -1 5 3.5 C4 7.5 -4 7.5 -5 3.5 C-6 -0.5 -2 -2 -1 -5 C1 -3 1.5 -1.5 1 1 C3 -1 2 -5 0 -8.5Z" fill="currentColor"/>`,
};

// The backer scene for wager cards: a signed charter, a seal, a purse of coins.
const WAGER = (c) => {
  const [light, dark] = PALETTE[c];
  return `
    <rect width="100" height="120" fill="url(#desk)"/>
    <path d="M0 0 H100 V24 H0Z" fill="#000" opacity=".18"/>
    <g transform="rotate(-6 50 56)">
      <rect x="18" y="20" width="64" height="74" rx="2" fill="url(#paper)" stroke="#8a6a38" stroke-width=".8"/>
      <path d="M24 32 H70 M24 38 H76 M24 44 H66 M24 50 H74 M24 56 H60" stroke="#8a6a38" stroke-width="1" opacity=".55"/>
      <path d="M26 74 q6 -6 10 0 t10 -2 t8 2" fill="none" stroke="#2a1a0c" stroke-width="1.2"/>
      <g transform="translate(64 78)">
        <path d="M-9 -2 L-12 10 L-6 7 L-3 12 L0 0Z M9 -2 L12 10 L6 7 L3 12 L0 0Z" fill="${dark}"/>
        <circle r="10" fill="${light}" stroke="${dark}" stroke-width="2"/>
        <circle r="6.5" fill="none" stroke="${dark}" stroke-width="1" opacity=".6"/>
        <g color="${dark}" transform="scale(.62)">${EMBLEM[c]}</g>
      </g>
    </g>
    <path d="M84 18 Q74 40 62 60" stroke="#f2ead8" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M84 18 q-2 8 -8 14 q8 -4 10 -12Z" fill="#f2ead8"/>
    <g transform="translate(20 100)">
      <ellipse cx="0" cy="6" rx="12" ry="4" fill="#000" opacity=".3"/>
      <path d="M-10 4 Q-12 -8 -4 -10 L4 -10 Q12 -8 10 4 Q0 8 -10 4Z" fill="#7a4a1c" stroke="#3d2208" stroke-width=".8"/>
      <path d="M-5 -10 Q0 -14 5 -10" fill="none" stroke="#d6a43a" stroke-width="1.6"/>
    </g>
    <g fill="url(#gold)" stroke="#7a5310" stroke-width=".5"><ellipse cx="40" cy="106" rx="5" ry="2"/><ellipse cx="44" cy="103" rx="5" ry="2"/><ellipse cx="38" cy="102" rx="5" ry="2"/></g>
    <rect width="100" height="120" fill="url(#hatch)"/>`;
};

const BACK = `
  <rect width="100" height="140" rx="8" fill="url(#back)"/>
  <rect x="5" y="5" width="90" height="130" rx="5" fill="none" stroke="url(#gold)" stroke-width="2"/>
  <rect x="9" y="9" width="82" height="122" rx="3" fill="none" stroke="#d6a43a" stroke-width=".6" opacity=".7"/>
  <g stroke="#2a7570" stroke-width=".5" opacity=".7" fill="none">
    <path d="M9 40 H91 M9 70 H91 M9 100 H91 M30 9 V131 M50 9 V131 M70 9 V131"/>
  </g>
  <g transform="translate(50 70)">
    <ellipse rx="32" ry="40" fill="#0b2c2b" stroke="url(#gold)" stroke-width="1.6"/>
    <ellipse rx="28" ry="36" fill="none" stroke="#d6a43a" stroke-width=".5" stroke-dasharray="2 2"/>
    <circle cx="0" cy="-8" r="11" fill="url(#gold)" opacity=".95"/>
    <g stroke="#d6a43a" stroke-width="1.2" stroke-linecap="round">${[-60, -35, -12, 12, 35, 60].map((a) => `<path d="M0 -24 V-28" transform="rotate(${a} 0 -8)"/>`).join("")}</g>
    <path d="M-26 12 L-12 -6 L-4 4 L6 -10 L26 12Z" fill="#164a47" stroke="url(#gold)" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M-12 -6 L-8 -1 L-12 0Z M6 -10 L10 -4 L4 -4Z" fill="#f3e2b0"/>
    <path d="M-18 30 q8 -6 14 -2 t12 -8 t10 -10" fill="none" stroke="#f3e2b0" stroke-width="1.3" stroke-dasharray="2.2 2.2"/>
    <path d="M17 7 l3 3 m0 -3 l-3 3" stroke="#e2553f" stroke-width="1.4"/>
  </g>
  <text x="50" y="125" text-anchor="middle" font-family="Cinzel, Georgia, serif" font-weight="800" font-size="7.5" letter-spacing="1.6" fill="#e9c66a">LOST CITIES</text>`;

export function installArt() {
  const symbols = [];
  for (const c of COLORS) {
    symbols.push(`<symbol id="land-${c}" viewBox="0 0 100 120">${LAND[c]}</symbol>`);
    symbols.push(`<symbol id="city-${c}" viewBox="-35 -60 70 62" overflow="visible">${CITY[c]}</symbol>`);
    symbols.push(`<symbol id="emb-${c}" viewBox="-10 -10 20 20" overflow="visible">${EMBLEM[c]}</symbol>`);
    symbols.push(`<symbol id="wager-${c}" viewBox="0 0 100 120">${WAGER(c)}</symbol>`);
  }
  symbols.push(`<symbol id="card-back" viewBox="0 0 100 140">${BACK}</symbol>`);
  const holder = document.createElement("div");
  holder.className = "defs-holder";
  holder.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${DEFS}${symbols.join("")}</svg>`;
  document.body.prepend(holder);
}

export const parseCard = (id) => {
  const [color, rest] = id.split("-");
  return { id, color, value: rest.startsWith("w") ? 0 : Number(rest) };
};

export function emblem(color, size = 16) {
  return s("svg", { class: "art emblem", width: size, height: size, viewBox: "0 0 20 20", style: { color: PALETTE[color][3] } }, s("use", { href: `#emb-${color}` }));
}

// The illustration window of a card. Number cards show the city getting closer as the value rises,
// with a dotted route leading to it.
function picture(card) {
  if (card.value === 0) return s("svg", { class: "pic", viewBox: "0 0 100 120", preserveAspectRatio: "xMidYMid slice" }, s("use", { href: `#wager-${card.color}` }));
  const t = (card.value - 2) / 8;
  const scale = 0.32 + 0.78 * t;
  const baseY = 66 + 22 * t;
  const cityX = 50 + (card.value % 2 ? -8 : 8) * (1 - t);
  return s(
    "svg",
    { class: "pic", viewBox: "0 0 100 120", preserveAspectRatio: "xMidYMid slice" },
    s("use", { href: `#land-${card.color}` }),
    s("path", { d: `M${50 + 14 * (1 - t)} 122 Q${36 + 30 * t} ${(122 + baseY) / 2 + 6} ${cityX} ${baseY + 1}`, fill: "none", stroke: "#fff7de", "stroke-width": 1.4, "stroke-dasharray": "2.4 2.6", opacity: 0.75 }),
    s("g", { transform: `translate(${cityX} ${baseY}) scale(${scale})` }, s("use", { href: `#city-${card.color}`, x: -35, y: -60, width: 70, height: 62 })),
  );
}

const SEAL = (color) => s("svg", { class: "art seal", viewBox: "-12 -12 24 24" }, s("circle", { r: 10.5, fill: PALETTE[color][1], stroke: "rgba(0,0,0,.4)", "stroke-width": 1 }), s("g", { color: PALETTE[color][3], transform: "scale(.7)" }, s("use", { href: `#emb-${color}`, x: -10, y: -10, width: 20, height: 20 })));

// A full card face as an element. `id` is the card id ("red-7", "blue-w1").
export function cardFace(id, attrs = {}) {
  const card = parseCard(id);
  const mark = card.value === 0 ? SEAL(card.color) : h("span", { class: `num${card.value === 6 || card.value === 9 ? " u" : ""}` }, card.value);
  return h(
    "div",
    { class: `card face c-${card.color}${card.value === 0 ? " wager" : ""}`, "data-card": id, ...attrs },
    h("div", { class: "band top" }, h("span", { class: "medal" }, mark), emblem(card.color, 14)),
    h("div", { class: "window" }, picture(card)),
    h("div", { class: "band bottom" }, emblem(card.color, 14), h("span", { class: "medal" }, card.value === 0 ? SEAL(card.color) : h("span", { class: `num${card.value === 6 || card.value === 9 ? " u" : ""}` }, card.value))),
  );
}

export function cardBack(attrs = {}) {
  return h("div", { class: "card back", ...attrs }, s("svg", { class: "art", viewBox: "0 0 100 140", preserveAspectRatio: "none" }, s("use", { href: "#card-back" })));
}

// "{red-7}" in log text becomes a little card chip.
export function richText(text) {
  const parts = String(text).split(/(\{[a-z]+-w?\d+\})/g);
  return parts.map((p) => {
    const m = p.match(/^\{([a-z]+-w?\d+)\}$/);
    if (!m) return p;
    const card = parseCard(m[1]);
    return h("span", { class: `chip-card c-${card.color}` }, emblem(card.color, 11), card.value === 0 ? "wager" : card.value);
  });
}
