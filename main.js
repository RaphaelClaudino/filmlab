const PRESET_FAMILIES = window.FILM_PRESETS;
const FILMS = Object.fromEntries(
  Object.entries(PRESET_FAMILIES).map(([family, presets]) => [
    family,
    presets.map((preset) => ({ ...preset, family })),
  ]),
);
FILMS.All = Object.values(FILMS)
  .flat()
  .sort(
    (a, b) =>
      Number(a.series) - Number(b.series) || a.n.localeCompare(b.n),
  );
const $ = (s) => document.querySelector(s),
  clamp = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const cv = $("#c"),
  ctx = cv.getContext("2d");
const ADJ = [
  ["int", "Filter strength", 0, 100, 100, "LOOK"],
  ["bri", "Exposure", -50, 50, 0, "LIGHT"],
  ["con", "Contrast", -50, 50, 0, "LIGHT"],
  ["high", "Highlights", -100, 100, 0, "LIGHT"],
  ["shad", "Shadows", -100, 100, 0, "LIGHT"],
  ["white", "Whites", -100, 100, 0, "LIGHT"],
  ["black", "Blacks", -100, 100, 0, "LIGHT"],
  ["sat", "Saturation", -100, 100, 0, "COLOR"],
  ["vibrance", "Vibrance", -100, 100, 0, "COLOR"],
  ["warm", "Temperature", -50, 50, 0, "COLOR"],
  ["tint", "Tint", -50, 50, 0, "COLOR"],
  ["grain", "Grain", 0, 100, 0, "EFFECTS"],
  ["vig", "Vignette", 0, 100, 0, "EFFECTS"],
  ["fade", "Fade", 0, 100, 0, "EFFECTS"],
  ["sharp", "Sharpening", 0, 100, 0, "DETAIL"],
  ["lumaNR", "Luminance noise", 0, 100, 0, "DETAIL"],
  ["colorNR", "Color noise", 0, 100, 0, "DETAIL"],
];
const CURVE_KEYS = ["shadows", "darks", "lights", "highlights"];
const GRADE_RANGES = ["shadows", "midtones", "highlights"];
const HSL_COLORS = [
  ["Red", "#ef5b5b"],
  ["Orange", "#e99a51"],
  ["Yellow", "#e4cf56"],
  ["Green", "#72b86b"],
  ["Aqua", "#5bc6bc"],
  ["Blue", "#5c91df"],
  ["Purple", "#a47ad6"],
  ["Magenta", "#d870aa"],
];
let U = {},
  HSL = {
    hue: Array(8).fill(0),
    sat: Array(8).fill(0),
    lum: Array(8).fill(0),
  },
  CURVE = { shadows: 0, darks: 0, lights: 0, highlights: 0 },
  GRADE = {
    shadows: { hue: 0, sat: 0 },
    midtones: { hue: 0, sat: 0 },
    highlights: { hue: 0, sat: 0 },
    balance: 0,
  },
  hslChannel = 0,
  grp = "All",
  film = FILMS.All[0],
  vr = film.default,
  srcCanvas = null,
  full = null,
  prev = null,
  fastPreview = null,
  fastPreviewCanvas = null,
  fastPreviewContext = null,
  thumbnailData = null,
  thumbnailOutput = null,
  thumbnailNoise = null,
  raf = 0,
  interactiveEdit = false,
  interactionTimer = 0;
const resetU = () => ADJ.forEach((a) => (U[a[0]] = a[4]));
resetU();
const resetHSL = () => {
  HSL.hue.fill(0);
  HSL.sat.fill(0);
  HSL.lum.fill(0);
};
const resetCurve = () => CURVE_KEYS.forEach((key) => (CURVE[key] = 0));
const resetGrade = () => {
  GRADE.shadows = { hue: 0, sat: 0 };
  GRADE.midtones = { hue: 0, sat: 0 };
  GRADE.highlights = { hue: 0, sat: 0 };
  GRADE.balance = 0;
};
function toast(t, ms = 2600) {
  const e = $("#toast");
  e.textContent = t;
  e.style.display = "block";
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (e.style.display = "none"), ms);
}

/* ---------- preset preparation ---------- */
function spline(pts) {
  const L = new Float32Array(256);
  if (!pts || pts.length < 4) {
    for (let i = 0; i < 256; i++) L[i] = i / 255;
    return L;
  }
  const n = pts.length / 2,
    x = [],
    y = [],
    d = [],
    m = [];
  for (let i = 0; i < n; i++) {
    x.push(pts[2 * i]);
    y.push(pts[2 * i + 1]);
  }
  for (let i = 0; i < n - 1; i++)
    d[i] = (y[i + 1] - y[i]) / (x[i + 1] - x[i]);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++)
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
    } else {
      const a = m[i] / d[i],
        b = m[i + 1] / d[i],
        s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        m[i] = t * a * d[i];
        m[i + 1] = t * b * d[i];
      }
    }
  }
  let k = 0;
  for (let v = 0; v < 256; v++) {
    while (k < n - 2 && v > x[k + 1]) k++;
    const h = x[k + 1] - x[k],
      t = (v - x[k]) / h,
      t2 = t * t,
      t3 = t2 * t;
    L[v] = clamp(
      ((2 * t3 - 3 * t2 + 1) * y[k] +
        (t3 - 2 * t2 + t) * h * m[k] +
        (-2 * t3 + 3 * t2) * y[k + 1] +
        (t3 - t2) * h * m[k + 1]) /
      255,
    );
  }
  return L;
}
const lk = (L, x) => {
  x = x < 0 ? 0 : x > 1 ? 1 : x;
  const f = x * 255,
    i = f | 0;
  return i >= 255 ? L[255] : L[i] + (L[i + 1] - L[i]) * (f - i);
};
const CEN = [0, 30, 60, 120, 180, 240, 270, 320, 360];
function hueLut(a, scale) {
  const o = new Float32Array(361),
    e = [...a, a[0]];
  for (let h = 0; h <= 360; h++) {
    let i = 0;
    while (i < 7 && h >= CEN[i + 1]) i++;
    const t = (h - CEN[i]) / (CEN[i + 1] - CEN[i]);
    o[h] = (e[i] + (e[i + 1] - e[i]) * t) * scale;
  }
  return o;
}
const cache = new Map();
function prep(s) {
  if (cache.has(s)) return cache.get(s);
  const p = s.p,
    mc = spline(s.c[0]),
    M = new Float32Array(256),
    sp = p[4] / 100 / 2,
    ct = [
      sp,
      (p[4] + p[5]) / 200,
      (p[5] + p[6]) / 200,
      (p[6] + 100) / 200,
    ];
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    let v = mc[i];
    [p[1], p[0], p[2], p[3]].forEach((a, j) => {
      if (a)
        v += (a / 100) * 0.25 * Math.exp(-(((x - ct[j]) / 0.15) ** 2));
    });
    M[i] = clamp(v);
  }
  const ch = [1, 2, 3].map((j) => {
    const L = spline(s.c[j]),
      o = new Float32Array(256);
    for (let i = 0; i < 256; i++) o[i] = lk(L, M[i]);
    return o;
  });
  const k = s.k,
    h = [...s.h],
    sa = [...s.s];
  h[0] += k[0] * 0.5;
  sa[0] += k[1] * 0.5;
  h[3] += k[2] * 0.5;
  sa[3] += k[3] * 0.5;
  h[5] += k[4] * 0.5;
  sa[5] += k[5] * 0.5;
  const P = {
    s,
    R: ch[0],
    G: ch[1],
    B: ch[2],
    hH: hueLut(h, 0.3),
    hS: hueLut(sa, 0.01),
    hL: hueLut(s.l, 0.003),
    mx: hueLut(s.m, 0.009),
  };
  cache.set(s, P);
  return P;
}

/* ---------- pixel engine ---------- */
let oh, os, ol;
function rgb2hsl(r, g, b) {
  const mx = Math.max(r, g, b),
    mn = Math.min(r, g, b),
    d = mx - mn;
  ol = (mx + mn) / 2;
  if (d < 1e-6) {
    oh = 0;
    os = 0;
    return;
  }
  os = d / (1 - Math.abs(2 * ol - 1));
  oh =
    mx === r
      ? (g - b) / d + (g < b ? 6 : 0)
      : mx === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;
  oh *= 60;
}
let rr, rg, rb;
function hsl2rgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = l - c / 2,
    i = (h / 60) | 0;
  switch (i % 6) {
    case 0:
      rr = c;
      rg = x;
      rb = 0;
      break;
    case 1:
      rr = x;
      rg = c;
      rb = 0;
      break;
    case 2:
      rr = 0;
      rg = c;
      rb = x;
      break;
    case 3:
      rr = 0;
      rg = x;
      rb = c;
      break;
    case 4:
      rr = x;
      rg = 0;
      rb = c;
      break;
    default:
      rr = c;
      rg = 0;
      rb = x;
  }
  rr += m;
  rg += m;
  rb += m;
}
function tint(h) {
  hsl2rgb(h, 1, 0.5);
  return [rr - 0.5, rg - 0.5, rb - 0.5];
}
function proc(src, dst, w, h, F, u, noise) {
  const P = prep(F),
    s = P.s,
    d = src.data,
    o = dst.data,
    N = w * h,
    k = u.int / 100;
  const [tc, th, ts, tw, tb] = s.t,
    cb = (tb / 100) * 0.12,
    cw = (tw / 100) * 0.12,
    cs = (ts / 100) * 0.25,
    ch = (th / 100) * 0.25,
    cc = 1 + (tc / 100) * 0.5;
  const sat = 1 + (s.sa || 0) / 100,
    bw = s.bw,
    sp = s.sp,
    bal = sp[4] / 200;
  const st1 = tint(sp[0]),
    st2 = tint(sp[2]),
    sa1 = (sp[1] / 100) * 0.5,
    sa2 = (sp[3] / 100) * 0.5,
    stn = (s.st / 100) * 0.08;
  const detail = s.detail || [0, 0, 0, 0, 0],
    gr = (s.g[0] / 100) * 0.22 * k + (u.grain / 100) * 0.25,
    manualHue = hueLut(HSL.hue, 1),
    manualSat = hueLut(HSL.sat, 0.01),
    manualLum = hueLut(HSL.lum, 0.003),
    hasManualHsl =
      HSL.hue.some(Boolean) ||
      HSL.sat.some(Boolean) ||
      HSL.lum.some(Boolean),
    toneCurve = CURVE_KEYS.some((key) => CURVE[key] !== 0),
    gradeEnabled =
      GRADE.shadows.sat !== 0 ||
      GRADE.midtones.sat !== 0 ||
      GRADE.highlights.sat !== 0,
    clarity = (detail[0] / 100) * k,
    sharpening = (detail[1] * k + u.sharp) / 100,
    lumaNR = (detail[2] * k + u.lumaNR) / 100,
    colorNR = (detail[3] * k + u.colorNR) / 100,
    vig = (detail[4] / 100) * k - (u.vig / 100) * 0.6,
    gradeTints = {
      shadows: tint(GRADE.shadows.hue),
      midtones: tint(GRADE.midtones.hue),
      highlights: tint(GRADE.highlights.hue),
    };
  const ucon = 1 + u.con / 100,
    usat = 1 + u.sat / 100,
    vibrance = (u.vibrance + (s.vibrance || 0) * k) / 100,
    bri = u.bri / 200,
    warm = u.warm / 500,
    tintShift = u.tint / 500,
    fd = u.fade / 500,
    cx = w / 2,
    cy = h / 2,
    md = cx * cx + cy * cy;
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    const r0 = d[p] / 255,
      g0 = d[p + 1] / 255,
      b0 = d[p + 2] / 255;
    let r = r0,
      g = g0,
      b = b0,
      l;
    if (bw) {
      rgb2hsl(r, g, b);
      const gy = clamp(
        (0.299 * r + 0.587 * g + 0.114 * b) * (1 + P.mx[oh | 0] * os),
      );
      r = g = b = gy;
    }
    l = 0.299 * r + 0.587 * g + 0.114 * b;
    const q = 1 - l,
      dl =
        cb * q * q * q +
        cw * l * l * l +
        cs * 4 * l * q * q +
        ch * 4 * l * l * q;
    r = (r + dl - 0.5) * cc + 0.5;
    g = (g + dl - 0.5) * cc + 0.5;
    b = (b + dl - 0.5) * cc + 0.5;
    r = lk(P.R, r);
    g = lk(P.G, g);
    b = lk(P.B, b);
    if (!bw) {
      rgb2hsl(r, g, b);
      if (os > 0) {
        const hi = oh | 0;
        let ns = os * (1 + P.hS[hi]) * sat;
        ns = ns > 1 ? 1 : ns < 0 ? 0 : ns;
        let nl = ol + P.hL[hi] * os;
        nl = nl < 0 ? 0 : nl > 1 ? 1 : nl;
        hsl2rgb(oh + P.hH[hi], ns, nl);
        r = rr;
        g = rg;
        b = rb;
      }
    }
    l = 0.299 * r + 0.587 * g + 0.114 * b;
    const hw = clamp(l + bal),
      sw = 1 - hw;
    if (sa1)
      ((r += st1[0] * sa1 * sw),
        (g += st1[1] * sa1 * sw),
        (b += st1[2] * sa1 * sw));
    if (sa2)
      ((r += st2[0] * sa2 * hw),
        (g += st2[1] * sa2 * hw),
        (b += st2[2] * sa2 * hw));
    if (stn) g -= stn * (1 - l) * (1 - l);
    r = r0 + (clamp(r) - r0) * k;
    g = g0 + (clamp(g) - g0) * k;
    b = b0 + (clamp(b) - b0) * k;
    l = 0.299 * r + 0.587 * g + 0.114 * b;
    const highWeight = Math.exp(-(((1 - l) / 0.32) ** 2));
    const shadowWeight = Math.exp(-((l / 0.32) ** 2));
    const whiteWeight = Math.exp(-(((1 - l) / 0.13) ** 2));
    const blackWeight = Math.exp(-((l / 0.13) ** 2));
    const tonalShift =
      (u.high * highWeight +
        u.shad * shadowWeight +
        u.white * whiteWeight +
        u.black * blackWeight) /
      400;
    r += tonalShift;
    g += tonalShift;
    b += tonalShift;
    r += bri + warm;
    g += bri - tintShift;
    b += bri - warm;
    r += tintShift * 0.5;
    b += tintShift * 0.5;
    r = (r - 0.5) * ucon + 0.5;
    g = (g - 0.5) * ucon + 0.5;
    b = (b - 0.5) * ucon + 0.5;
    if (clarity) {
      l = 0.299 * r + 0.587 * g + 0.114 * b;
      const clarityGain =
        1 + clarity * Math.exp(-(((l - 0.5) / 0.3) ** 2));
      r = l + (r - l) * clarityGain;
      g = l + (g - l) * clarityGain;
      b = l + (b - l) * clarityGain;
    }
    if (toneCurve) {
      l = 0.299 * r + 0.587 * g + 0.114 * b;
      const shadowWeight = Math.exp(-((l / 0.28) ** 2));
      const darkWeight = Math.exp(-(((l - 0.28) / 0.22) ** 2));
      const lightWeight = Math.exp(-(((l - 0.72) / 0.22) ** 2));
      const highlightWeight = Math.exp(-(((1 - l) / 0.28) ** 2));
      const curveShift =
        (CURVE.shadows * shadowWeight +
          CURVE.darks * darkWeight +
          CURVE.lights * lightWeight +
          CURVE.highlights * highlightWeight) /
        400;
      r += curveShift;
      g += curveShift;
      b += curveShift;
    }
    if (usat !== 1 || vibrance !== 0) {
      l = 0.299 * r + 0.587 * g + 0.114 * b;
      rgb2hsl(r, g, b);
      const vibranceFactor = 1 + vibrance * (1 - os);
      const saturation = Math.max(0, os * usat * vibranceFactor);
      hsl2rgb(oh, Math.min(1, saturation), ol);
      r = rr;
      g = rg;
      b = rb;
    }
    if (hasManualHsl) {
      rgb2hsl(r, g, b);
      if (os > 0) {
        const hi = oh | 0;
        const hslSaturation = clamp(os * (1 + manualSat[hi]));
        const hslLuminance = clamp(ol + manualLum[hi] * os);
        hsl2rgb(oh + manualHue[hi], hslSaturation, hslLuminance);
        r = rr;
        g = rg;
        b = rb;
      }
    }
    if (gradeEnabled) {
      l = 0.299 * r + 0.587 * g + 0.114 * b;
      const shadowWeight = clamp((0.65 - l) / 0.65);
      const highlightWeight = clamp((l - 0.35) / 0.65);
      const midWeight = clamp(1 - shadowWeight - highlightWeight);
      const shadowAmount = (GRADE.shadows.sat / 100) * 0.24 * shadowWeight;
      const midAmount = (GRADE.midtones.sat / 100) * 0.24 * midWeight;
      const highlightAmount = (GRADE.highlights.sat / 100) * 0.24 * highlightWeight;
      r += gradeTints.shadows[0] * shadowAmount + gradeTints.midtones[0] * midAmount + gradeTints.highlights[0] * highlightAmount;
      g += gradeTints.shadows[1] * shadowAmount + gradeTints.midtones[1] * midAmount + gradeTints.highlights[1] * highlightAmount;
      b += gradeTints.shadows[2] * shadowAmount + gradeTints.midtones[2] * midAmount + gradeTints.highlights[2] * highlightAmount;
    }
    if (fd) {
      r = fd + r * (1 - fd);
      g = fd + g * (1 - fd);
      b = fd + b * (1 - fd);
    }
    if (gr) {
      l = 0.299 * r + 0.587 * g + 0.114 * b;
      const n = noise[i] * gr * (1 - Math.abs(l - 0.5) * 1.2);
      r += n;
      g += n;
      b += n;
    }
    if (vig) {
      const x = (i % w) - cx,
        y = ((i / w) | 0) - cy,
        v = 1 + (vig * (x * x + y * y)) / md;
      r *= v;
      g *= v;
      b *= v;
    }
    o[p] = clamp(r) * 255;
    o[p + 1] = clamp(g) * 255;
    o[p + 2] = clamp(b) * 255;
    o[p + 3] = 255;
  }
  if (lumaNR || colorNR || sharpening) {
    const original = new Uint8ClampedArray(o);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        let avgR = 0, avgG = 0, avgB = 0, count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const q = (yy * w + xx) * 4;
            avgR += original[q];
            avgG += original[q + 1];
            avgB += original[q + 2];
            count++;
          }
        }
        avgR /= count;
        avgG /= count;
        avgB /= count;
        const currentR = original[p],
          currentG = original[p + 1],
          currentB = original[p + 2],
          currentL = 0.299 * currentR + 0.587 * currentG + 0.114 * currentB,
          averageL = 0.299 * avgR + 0.587 * avgG + 0.114 * avgB,
          lumaDelta = (averageL - currentL) * lumaNR,
          edge = (currentL - averageL) * sharpening * 0.8,
          redChroma = currentR - currentL,
          greenChroma = currentG - currentL,
          blueChroma = currentB - currentL;
        o[p] = clamp((currentR + lumaDelta + ((avgR - averageL) - redChroma) * colorNR + edge) / 255) * 255;
        o[p + 1] = clamp((currentG + lumaDelta + ((avgG - averageL) - greenChroma) * colorNR + edge) / 255) * 255;
        o[p + 2] = clamp((currentB + lumaDelta + ((avgB - averageL) - blueChroma) * colorNR + edge) / 255) * 255;
      }
    }
  }
}
const mkNoise = (n) => {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.random() * 2 - 1;
  return a;
};
const cur = () => film.v[vr] || film.v[film.default];

/* ---------- loading (images + RAW) ---------- */
function scaled(img, max) {
  const s = Math.min(1, max / Math.max(img.width, img.height)),
    c = document.createElement("canvas");
  c.width = Math.round(img.width * s);
  c.height = Math.round(img.height * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c;
}
let jf = 0;
function jpegEnd(u, p) {
  const n = u.length;
  let i = p + 2;
  jf = 0;
  while (i + 3 < n) {
    if (u[i] !== 255) return -1;
    let m = u[i + 1];
    if (m === 255) {
      i++;
      continue;
    }
    if (m === 0xd9) return i + 2;
    if (m === 1 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    if (
      m >= 0xc0 &&
      m <= 0xcf &&
      m !== 0xc4 &&
      m !== 0xc8 &&
      m !== 0xcc &&
      !jf
    )
      jf = m;
    const len = (u[i + 2] << 8) | u[i + 3];
    i += 2 + len;
    if (m === 0xda) {
      while (i + 1 < n) {
        if (u[i] === 255) {
          const x = u[i + 1];
          if (x === 0 || (x >= 0xd0 && x <= 0xd7)) {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
    }
  }
  return -1;
}
function tiffOrient(u) {
  const le = u[0] === 0x49 && u[1] === 0x49;
  if (!(le || (u[0] === 0x4d && u[1] === 0x4d))) return 0;
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  try {
    const g16 = (o) => dv.getUint16(o, le),
      g32 = (o) => dv.getUint32(o, le);
    if (g16(2) !== 42 && g16(2) !== 0x55) return 0;
    const ifd = g32(4),
      n = g16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (g16(e) === 0x112) return g16(e + 8);
    }
  } catch (e) { }
  return 0;
}
function jpegList(u) {
  const L = [];
  let p = 0;
  const n = u.length - 3;
  while (p < n) {
    if (u[p] === 255 && u[p + 1] === 216 && u[p + 2] === 255) {
      const e = jpegEnd(u, p);
      if (e > p) {
        if (jf >= 0xc0 && jf <= 0xc2 && e - p > 20000) L.push([p, e]);
        p = e;
        continue;
      }
    }
    p++;
  }
  return L.sort((a, b) => b[1] - b[0] - (a[1] - a[0]));
}
function orient(bm, o) {
  if (!o || o === 1 || o === 2 || o === 4 || o === 5 || o === 7)
    return bm;
  const c = document.createElement("canvas"),
    sw = o === 6 || o === 8;
  c.width = sw ? bm.height : bm.width;
  c.height = sw ? bm.width : bm.height;
  const x = c.getContext("2d");
  x.translate(c.width / 2, c.height / 2);
  x.rotate(o === 3 ? Math.PI : o === 6 ? Math.PI / 2 : -Math.PI / 2);
  x.drawImage(bm, -bm.width / 2, -bm.height / 2);
  return c;
}
const RAW =
  /\.(cr2|cr3|crw|nef|nrw|arw|srf|sr2|dng|raf|orf|rw2|pef|srw|x3f|3fr|iiq|rwl|erf|kdc|mrw)$/i;
async function decode(f) {
  if (!RAW.test(f.name)) {
    try {
      return await createImageBitmap(f, {
        imageOrientation: "from-image",
      });
    } catch (e) { }
    return await new Promise((ok, no) => {
      const im = new Image();
      im.onload = () => ok(im);
      im.onerror = no;
      im.src = URL.createObjectURL(f);
    });
  }
  toast("Reading RAW file…", 6000);
  const u = new Uint8Array(await f.arrayBuffer()),
    L = jpegList(u),
    o = tiffOrient(u);
  for (const b of L.slice(0, 4)) {
    try {
      const blob = new Blob([u.subarray(b[0], b[1])], {
        type: "image/jpeg",
      });
      return o
        ? orient(
          await createImageBitmap(blob, { imageOrientation: "none" }),
          o,
        )
        : await createImageBitmap(blob, {
          imageOrientation: "from-image",
        });
    } catch (e) { }
  }
  throw new Error("no usable preview inside this RAW file");
}
function setSource(img) {
  clearTimeout(interactionTimer);
  interactiveEdit = false;
  srcCanvas = img instanceof HTMLCanvasElement ? img : scaled(img, 4096);
  /* Keep export memory use within iPhone Safari limits. */
  full = scaled(srcCanvas, 2000);
  const p = scaled(srcCanvas, 1000);
  thumbnailData = thumbnailOutput = thumbnailNoise = null;
  prev = {
    w: p.width,
    h: p.height,
    data: p.getContext("2d").getImageData(0, 0, p.width, p.height),
    out: new ImageData(p.width, p.height),
    noise: mkNoise(p.width * p.height),
  };
  const quick = scaled(p, 360);
  fastPreview = {
    w: quick.width,
    h: quick.height,
    data: quick.getContext("2d").getImageData(0, 0, quick.width, quick.height),
    out: new ImageData(quick.width, quick.height),
    noise: mkNoise(quick.width * quick.height),
  };
  fastPreviewCanvas = document.createElement("canvas");
  fastPreviewCanvas.width = quick.width;
  fastPreviewCanvas.height = quick.height;
  fastPreviewContext = fastPreviewCanvas.getContext("2d");
  cv.width = p.width;
  cv.height = p.height;
  cv.style.display = "block";
  $("#empty").style.display = "none";
  $("#save").disabled = $("#cmp").disabled = $("#rot").disabled = false;
  thumbs();
  render();
}
$("#rot").onclick = () => {
  if (!srcCanvas) return;
  const c = orient(srcCanvas, 6);
  setSource(c);
};
const fi = $("#file");
$("#open").onclick = $("#open2").onclick = () => fi.click();
fi.onchange = async () => {
  const f = fi.files[0];
  fi.value = "";
  if (!f) return;
  try {
    const im = await decode(f);
    setSource(im);
    toast(
      RAW.test(f.name)
        ? "RAW loaded (embedded full-size preview)"
        : "Loaded",
      2200,
    );
  } catch (e) {
    toast(
      "Could not open this file: " + (e.message || "unsupported format"),
      4000,
    );
  }
};

/* ---------- rendering & UI ---------- */
function render() {
  if (!prev) return;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    const preview = interactiveEdit ? fastPreview : prev;
    proc(
      preview.data,
      preview.out,
      preview.w,
      preview.h,
      cur(),
      U,
      preview.noise,
    );
    if (preview === prev) {
      ctx.putImageData(prev.out, 0, 0);
    } else {
      fastPreviewContext.putImageData(fastPreview.out, 0, 0);
      ctx.drawImage(
        fastPreviewCanvas,
        0,
        0,
        cv.width,
        cv.height,
      );
    }
  });
}
function beginInteractiveEdit() {
  interactiveEdit = true;
  clearTimeout(interactionTimer);
}
function finishInteractiveEdit() {
  clearTimeout(interactionTimer);
  if (!interactiveEdit) return;
  interactiveEdit = false;
  render();
}
window.addEventListener("pointerup", finishInteractiveEdit);
window.addEventListener("pointercancel", finishInteractiveEdit);
function thumbs() {
  if (!prev) return;
  if (!thumbnailData) {
    const size = Math.min(prev.w, prev.h);
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = prev.w;
    sourceCanvas.height = prev.h;
    sourceCanvas.getContext("2d").putImageData(prev.data, 0, 0);
    const thumbnailCanvas = document.createElement("canvas");
    thumbnailCanvas.width = thumbnailCanvas.height = 72;
    const thumbnailContext = thumbnailCanvas.getContext("2d");
    thumbnailContext.drawImage(
      sourceCanvas,
      (prev.w - size) / 2,
      (prev.h - size) / 2,
      size,
      size,
      0,
      0,
      72,
      72,
    );
    thumbnailData = thumbnailContext.getImageData(0, 0, 72, 72);
    thumbnailOutput = new ImageData(72, 72);
    thumbnailNoise = mkNoise(5184);
  }
  const stripElement = $("#strip");
  const stripBounds = stripElement.getBoundingClientRect();
  const u0 = {};
  ADJ.forEach((a) => (u0[a[0]] = a[4]));
  document.querySelectorAll(".f canvas").forEach((c) => {
    const bounds = c.parentElement.getBoundingClientRect();
    if (bounds.right < stripBounds.left || bounds.left > stripBounds.right)
      return;
    const F = FILMS[c.dataset.g][c.dataset.i],
      preset = F.v[vr] || F.v[F.default];
    proc(
      thumbnailData,
      thumbnailOutput,
      72,
      72,
      preset,
      u0,
      thumbnailNoise,
    );
    c.getContext("2d").putImageData(thumbnailOutput, 0, 0);
  });
}
function updateVariantOptions() {
  const container = $("#variant-options");
  container.replaceChildren();
  const variants = ["", "-", "--", "+", "++", "+++", "++++"].filter(
    (variant) => Object.prototype.hasOwnProperty.call(film.v, variant),
  );
  const labels = { "": "0", "-": "−", "--": "−−", "+": "+", "++": "++", "+++": "+++", "++++": "++++" };
  variants.forEach((variant) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.v = variant;
    button.textContent = labels[variant] ?? variant;
    button.className = variant === vr ? "on" : "";
    button.title = variant ? `Preset strength ${variant}` : "Original preset";
    button.onclick = () => {
      vr = variant;
      updateVariantOptions();
      thumbs();
      render();
    };
    container.appendChild(button);
  });
}
function strip() {
  const s = $("#strip");
  s.innerHTML = "";
  FILMS[grp].forEach((F, i) => {
    const d = document.createElement("div");
    d.className = "f" + (F === film ? " on" : "");
    d.dataset.series = F.series;
    d.style.setProperty(
      "--preset-color",
      ({ Kodak: "#C75B39", Fujifilm: "#1C684C", Agfa: "#C84630", Instant: "#E3A333", Ilford: "#2B2B2B" })[F.family] || "#bbb",
    );
    const c = document.createElement("canvas");
    c.width = c.height = 72;
    const label = document.createElement("div");
    label.textContent = F.n
      .replace(/\b[A-Za-z]+\b/g, (part) => part[0].toUpperCase())
      .replace(/(?<=[A-Za-z]) (?=[A-Za-z])/g, "");
    label.title = F.n;
    d.append(c, label);
    d.title = `${F.family} · ${F.folder}`;
    c.dataset.g = grp;
    c.dataset.i = i;
    d.onclick = () => {
      film = F;
      vr = film.default;
      s.querySelectorAll(".f").forEach((card) =>
        card.classList.toggle("on", card === d),
      );
      updateVariantOptions();
      render();
    };
    s.appendChild(d);
  });
  updateVariantOptions();
  thumbs();
}
$("#strip").addEventListener("scroll", () => requestAnimationFrame(thumbs));
document.querySelectorAll(".tabs [data-g]").forEach(
  (b) =>
  (b.onclick = () => {
    grp = b.dataset.g;
    document
      .querySelectorAll(".tabs [data-g]")
      .forEach((x) => x.classList.toggle("on", x === b));
    film = FILMS[grp][0];
    vr = film.default;
    strip();
    render();
  }),
);
const rangeInputs = [];
const customResetters = [];
const setRangeFill = (input) => {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const value = Number(input.value || 0);
  const percent = ((value - min) / (max - min || 1)) * 100;
  input.style.setProperty("--range-progress", percent + "%");
};
const setSlider = (container, label, min, max, value, onChange) => {
  const row = document.createElement("div");
  row.className = "r";
  const name = document.createElement("label");
  name.textContent = label;
  const input = document.createElement("input");
  input.type = "range";
  input.min = min;
  input.max = max;
  input.value = value;
  input.setAttribute("aria-label", label);
  const output = document.createElement("span");
  output.textContent = value;
  const update = () => {
    output.textContent = input.value;
    setRangeFill(input);
    onChange(+input.value);
  };
  input.oninput = () => {
    beginInteractiveEdit();
    update();
    interactionTimer = setTimeout(finishInteractiveEdit, 120);
  };
  input.onpointerdown = beginInteractiveEdit;
  input.onpointerup = finishInteractiveEdit;
  input.onpointercancel = finishInteractiveEdit;
  input.onkeydown = beginInteractiveEdit;
  input.onkeyup = finishInteractiveEdit;
  input.onblur = finishInteractiveEdit;
  input.ondblclick = () => {
    input.value = "0";
    update();
  };
  row.append(name, input, output);
  container.appendChild(row);
  rangeInputs.push({ input, update });
  setRangeFill(input);
  return input;
};
const categoryContainers = {
  LIGHT: $("#light-controls"),
  COLOR: $("#color-controls"),
  EFFECTS: $("#effects-controls"),
  DETAIL: $("#detail-controls"),
};
ADJ.filter(([key]) => key !== "int").forEach(([key, label, min, max, , group]) => {
  setSlider(categoryContainers[group], label, min, max, U[key], (value) => {
    U[key] = value;
    render();
  }).dataset.adjustmentKey = key;
});

const curveContainer = $("#curve-controls");
CURVE_KEYS.forEach((key) => {
  const label = key[0].toUpperCase() + key.slice(1);
  const input = setSlider(curveContainer, label, -100, 100, CURVE[key], (value) => {
    CURVE[key] = value;
    render();
  });
  customResetters.push(() => {
    CURVE[key] = 0;
    input.value = 0;
    input.parentElement.querySelector("span").textContent = "0";
    setRangeFill(input);
  });
});

const gradingContainer = $("#grading-controls");
GRADE_RANGES.forEach((range) => {
  const title = range[0].toUpperCase() + range.slice(1);
  // const heading = document.createElement("h3");
  // heading.textContent = title;
  // heading.className = "grading-label";
  // gradingContainer.appendChild(heading);
  const hueInput = setSlider(
    gradingContainer,
    title + " hue",
    0,
    360,
    GRADE[range].hue,
    (value) => {
      GRADE[range].hue = value;
      render();
    },
  );
  const satInput = setSlider(
    gradingContainer,
    title + " saturation",
    0,
    100,
    GRADE[range].sat,
    (value) => {
      GRADE[range].sat = value;
      render();
    },
  );
  customResetters.push(() => {
    GRADE[range] = { hue: 0, sat: 0 };
    [hueInput, satInput].forEach((input) => {
      input.value = 0;
      input.parentElement.querySelector("span").textContent = "0";
      setRangeFill(input);
    });
  });
});

const hslControls = $("#hsl-controls");
const hslInputs = {};
[["hue", "Hue", -180, 180], ["sat", "Saturation", -100, 100], ["lum", "Luminance", -100, 100]].forEach(
  ([key, label, min, max]) => {
    hslInputs[key] = setSlider(hslControls, label, min, max, 0, (value) => {
      HSL[key][hslChannel] = value;
      render();
    });
  },
);
const updateHslControls = () => {
  ["hue", "sat", "lum"].forEach((key) => {
    const input = hslInputs[key];
    input.value = HSL[key][hslChannel];
    const row = input.parentElement;
    row.querySelector("span").textContent = input.value;
    setRangeFill(input);
  });
  $("#hsl-swatches").querySelectorAll("button").forEach((button, index) => {
    button.classList.toggle("on", index === hslChannel);
    button.setAttribute("aria-pressed", String(index === hslChannel));
  });
};
HSL_COLORS.forEach(([name, color], index) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "hsl-swatch";
  button.style.setProperty("--swatch-color", color);
  button.setAttribute("aria-label", name);
  button.title = name;
  button.onclick = () => {
    hslChannel = index;
    updateHslControls();
  };
  $("#hsl-swatches").appendChild(button);
});
updateHslControls();
$("#reset-edit").onclick = () => {
  resetU();
  resetHSL();
  resetCurve();
  resetGrade();
  rangeInputs.forEach(({ input, update }) => {
    const key = input.dataset.adjustmentKey;
    if (!key) return;
    input.value = U[key];
    update();
  });
  customResetters.forEach((reset) => reset());
  updateHslControls();
  render();
};
document.querySelectorAll(".workspace-tabs [data-view]").forEach((button) => {
  button.onclick = () => {
    const isLooks = button.dataset.view === "looks";
    document.querySelectorAll(".workspace-tabs [data-view]").forEach((tab) =>
      tab.classList.toggle("on", tab === button),
    );
    $("#looks-view").hidden = !isLooks;
    $("#edit-view").hidden = isLooks;
  };
});
document.querySelectorAll("#edit-categories [data-category]").forEach((button) => {
  button.onclick = () => {
    const category = button.dataset.category;
    document.querySelectorAll("#edit-categories [data-category]").forEach((tab) => {
      tab.classList.toggle("on", tab === button);
      tab.setAttribute("aria-pressed", String(tab === button));
    });
    document.querySelectorAll("[data-edit-category-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.editCategoryPanel !== category;
    });
  };
});
const cmp = $("#cmp");
cmp.onpointerdown = () => {
  if (prev) ctx.putImageData(prev.data, 0, 0);
};
["pointerup", "pointercancel", "pointerleave"].forEach((ev) =>
  cmp.addEventListener(ev, render),
);
cmp.oncontextmenu = (e) => e.preventDefault();

/* ---------- save as download ---------- */
$("#save").onclick = async () => {
  if (!full) return;
  const b = $("#save");
  b.disabled = true;
  b.textContent = "…";
  await new Promise((r) => setTimeout(r, 30));
  const w = full.width,
    h = full.height,
    src = full.getContext("2d").getImageData(0, 0, w, h),
    out = new ImageData(w, h);
  proc(src, out, w, h, cur(), U, mkNoise(w * h));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d").putImageData(out, 0, 0);
  const exportQuality = 1;
  c.toBlob(
    async (blob) => {
      b.disabled = false;
      b.textContent = "Save";
      const name =
        "filmlab-" +
        (
          grp +
          "-" +
          film.n +
          (vr
            ? "-" +
            ({
              "-": "minus",
              "--": "minusminus",
              "+": "plus",
              "++": "plusplus",
              "+++": "plusplusplus",
              "++++": "plusplusplusplus",
            }[vr] || "base")
            : "")
        )
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-") +
        ".jpg";
      let dl = null;
      try {
        dl = window.claude ? await window.claude.use("downloads") : null;
      } catch (e) { }
      if (dl) {
        try {
          await dl.save({ filename: name, data: blob });
          toast("Saved to your phone’s Downloads");
          return;
        } catch (e) {
          if (e && e.code === "declined") return;
        }
      }
      $("#oi").src = URL.createObjectURL(blob);
      $("#ov").style.display = "flex";
    },
    "image/jpeg",
    exportQuality,
  );
};
$("#share").onclick = async () => {
  const img = $("#oi");
  if (!img.src) return;
  try {
    const response = await fetch(img.src),
      blob = await response.blob();
    const file = new File([blob], "filmlab-edited.jpg", {
      type: "image/jpeg",
    });
    if (
      navigator.share &&
      (!navigator.canShare || navigator.canShare({ files: [file] }))
    ) {
      await navigator.share({
        files: [file],
        title: "FilmLab edited photo",
      });
    } else {
      const a = document.createElement("a");
      a.href = img.src;
      a.download = "filmlab-edited.jpg";
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast(
        "If the download does not start, press and hold the photo to save it.",
      );
    }
  } catch (e) {
    if (e.name !== "AbortError")
      toast("Press and hold the photo to save it.");
  }
};
$("#oc").onclick = () => ($("#ov").style.display = "none");

/* ---------- fullscreen / installable manifest ---------- */
try {
  const ic = (n) => {
    const c = document.createElement("canvas");
    c.width = c.height = n;
    const x = c.getContext("2d");
    x.fillStyle = "#0e0e0d";
    x.fillRect(0, 0, n, n);
    x.fillStyle = "#ff5a3c";
    x.beginPath();
    x.arc(n / 2, n / 2, n * 0.3, 0, 7);
    x.fill();
    x.fillStyle = "#0e0e0d";
    x.beginPath();
    x.arc(n / 2, n / 2, n * 0.12, 0, 7);
    x.fill();
    return c.toDataURL("image/png");
  };
  const man = {
    name: "FilmLab",
    short_name: "FilmLab",
    start_url: location.href.split("#")[0],
    scope: location.href.split("#")[0].replace(/[^/]*$/, ""),
    display: "fullscreen",
    display_override: ["fullscreen", "standalone"],
    orientation: "any",
    background_color: "#0e0e0d",
    theme_color: "#0e0e0d",
    icons: [
      {
        src: ic(192),
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: ic(512),
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
  const l = document.createElement("link");
  l.rel = "manifest";
  l.href = URL.createObjectURL(
    new Blob([JSON.stringify(man)], {
      type: "application/manifest+json",
    }),
  );
  document.head.appendChild(l);
} catch (e) { }
const isApp =
  matchMedia("(display-mode: fullscreen)").matches ||
  matchMedia("(display-mode: standalone)").matches ||
  navigator.standalone;
if (isApp || !document.documentElement.requestFullscreen)
  $("#fs").style.display = "none";
$("#fs").onclick = () => {
  document.fullscreenElement
    ? document.exitFullscreen()
    : document.documentElement
      .requestFullscreen({ navigationUI: "hide" })
      .catch(() =>
        toast(
          "Fullscreen is blocked here — open the page link directly in Chrome",
        ),
      );
};
strip();
