/**
 * Reso Audio Visualizer — Animated Spectrum Generator
 * Generates smooth, seamlessly looping animated GIF visualizers for Now Playing embeds.
 * Uses sharp (SVG → Raw Buffer Stacking → Animated GIF) pipeline for fast, zero-dependency generation.
 * Each track gets a unique, deterministic visualization based on its title hash.
 */

const sharp = require('sharp');

// ── Reso Color Palettes (matches embeds.js) ──────────────────────
const PALETTES = {
    violet: {
        name: 'Violet Storm',
        gradient: ['#7C3AED', '#A855F7', '#C084FC', '#E9D5FF'],
        bg: '#0F0B1A',
        glow: '#7C3AED',
        accent: '#EC4899',
    },
    pink: {
        name: 'Electric Pink',
        gradient: ['#EC4899', '#F472B6', '#F9A8D4', '#FECDD3'],
        bg: '#1A0B14',
        glow: '#EC4899',
        accent: '#7C3AED',
    },
    cyan: {
        name: 'Cyber Cyan',
        gradient: ['#06B6D4', '#22D3EE', '#67E8F9', '#A5F3FC'],
        bg: '#0B1A1A',
        glow: '#06B6D4',
        accent: '#10B981',
    },
    emerald: {
        name: 'Emerald Pulse',
        gradient: ['#10B981', '#34D399', '#6EE7B7', '#A7F3D0'],
        bg: '#0B1A12',
        glow: '#10B981',
        accent: '#06B6D4',
    },
    sunset: {
        name: 'Sunset Blaze',
        gradient: ['#F59E0B', '#FB923C', '#FDBA74', '#FED7AA'],
        bg: '#1A130B',
        glow: '#F59E0B',
        accent: '#EF4444',
    },
};

const PALETTE_KEYS = Object.keys(PALETTES);

// ── Guild visualizer preferences ────────────────────────────────
// Key: guildId, Value: { enabled: boolean, style: string }
const guildVisualizers = new Map();

/**
 * Deterministic hash from a string (seeding unique visuals per track)
 */
function hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

/**
 * Seeded pseudo-random number generator (deterministic per track)
 */
function seededRandom(seed) {
    let s = seed;
    return function () {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    };
}

/**
 * Pick a palette based on track seed
 */
function pickPalette(seed) {
    const index = seed % PALETTE_KEYS.length;
    return PALETTES[PALETTE_KEYS[index]];
}

/**
 * Interpolate between two hex colors
 */
function interpolateColor(color1, color2, factor) {
    const r1 = parseInt(color1.slice(1, 3), 16);
    const g1 = parseInt(color1.slice(3, 5), 16);
    const b1 = parseInt(color1.slice(5, 7), 16);
    const r2 = parseInt(color2.slice(1, 3), 16);
    const g2 = parseInt(color2.slice(3, 5), 16);
    const b2 = parseInt(color2.slice(5, 7), 16);

    const r = Math.round(r1 + (r2 - r1) * factor);
    const g = Math.round(g1 + (g2 - g1) * factor);
    const b = Math.round(b1 + (b2 - b1) * factor);

    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Get the gradient color from 4 stops based on normalized ratio [0..1]
 */
function getGradientColor(t, gradientColors) {
    const clamped = Math.max(0, Math.min(1, t));
    if (clamped < 0.33) {
        return interpolateColor(gradientColors[0], gradientColors[1], clamped / 0.33);
    } else if (clamped < 0.66) {
        return interpolateColor(gradientColors[1], gradientColors[2], (clamped - 0.33) / 0.33);
    } else {
        return interpolateColor(gradientColors[2], gradientColors[3], (clamped - 0.66) / 0.34);
    }
}

// ── FRAME GENERATORS (Seamless loop across totalFrames) ─────────

/**
 * Spectrum Bars Frame: Dancing EQ bars with illuminated peak caps & reflections
 */
function generateBarsFrame(frame, totalFrames, seed, width, height, palette) {
    const barCount = 38;
    const barGap = 4;
    const paddingX = 18;
    const barWidth = (width - 2 * paddingX - (barCount - 1) * barGap) / barCount;
    const maxBarHeight = height - 36;
    const paddingBottom = 16;
    const rng = seededRandom(seed);

    // Continuous circular angle for seamless looping
    const t = (frame / totalFrames) * Math.PI * 2;
    let barsSvg = '';

    for (let i = 0; i < barCount; i++) {
        const normX = i / barCount;
        // Natural frequency curve: boosted lows/mids, rolling highs
        const eqCurve = Math.sin(normX * Math.PI * 0.9 + 0.15) * 0.7 + 0.3;

        // Multi-frequency harmonic oscillation (integers ensure seamless loop)
        const speed1 = (i % 3) + 1;
        const speed2 = ((i * 2) % 2) + 1;
        const phase1 = rng() * Math.PI * 2;
        const phase2 = rng() * Math.PI * 2;

        const osc1 = Math.sin(t * speed1 + phase1);
        const osc2 = Math.cos(t * speed2 + phase2) * 0.5;
        const bounce = Math.abs(osc1 + osc2) / 1.5;

        const barHeight = Math.max(6, Math.floor(eqCurve * (0.22 + bounce * 0.78) * maxBarHeight));
        const x = paddingX + i * (barWidth + barGap);
        const y = height - paddingBottom - barHeight;

        const color = getGradientColor(barHeight / maxBarHeight, palette.gradient);
        const rx = Math.min(barWidth / 2, 3);

        // Main bar body
        barsSvg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight}" rx="${rx}" fill="${color}" opacity="0.95"/>`;
        // Top peak highlight
        barsSvg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="3" rx="1.5" fill="#FFFFFF" opacity="0.8"/>`;
        // Reflection bar below
        const reflH = Math.min(barHeight * 0.22, 12);
        barsSvg += `<rect x="${x.toFixed(1)}" y="${(height - paddingBottom + 2).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${reflH.toFixed(1)}" rx="${rx}" fill="${palette.gradient[0]}" opacity="0.25"/>`;
    }

    const baseline = `<line x1="${paddingX}" y1="${height - paddingBottom}" x2="${width - paddingX}" y2="${height - paddingBottom}" stroke="${palette.glow}" stroke-width="1" stroke-opacity="0.3"/>`;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <rect width="${width}" height="${height}" fill="${palette.bg}"/>
        ${baseline}
        ${barsSvg}
    </svg>`;
}

/**
 * Waveform Frame: Continuous fluid audio waves with illuminated crests & ambient fill
 */
function generateWaveFrame(frame, totalFrames, seed, width, height, palette) {
    const pointCount = 60;
    const midY = height / 2;
    const maxAmp = height * 0.34;
    const paddingX = 12;
    const t = (frame / totalFrames) * Math.PI * 2;
    const rng = seededRandom(seed);
    const phaseOffset = rng() * Math.PI * 2;

    const points = [];
    for (let i = 0; i < pointCount; i++) {
        const norm = i / (pointCount - 1);
        const x = paddingX + norm * (width - 2 * paddingX);

        // Harmonic traveling waveforms
        const w1 = Math.sin(norm * Math.PI * 4 + t + phaseOffset) * 0.55;
        const w2 = Math.sin(norm * Math.PI * 8 - t * 2 + phaseOffset * 0.5) * 0.3;
        const w3 = Math.cos(norm * Math.PI * 2 + t) * 0.15;

        // Edge dampening envelope
        const envelope = Math.sin(norm * Math.PI);
        const y = midY + (w1 + w2 + w3) * maxAmp * envelope;
        points.push({ x, y });
    }

    let pathD = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
        pathD += ` L ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)}`;
    }

    const fillD = `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${height} L ${points[0].x.toFixed(1)} ${height} Z`;

    // Reflection wave path
    let mirrorD = `M ${points[0].x.toFixed(1)} ${(midY + (midY - points[0].y) * 0.5).toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
        const my = midY + (midY - points[i].y) * 0.5;
        mirrorD += ` L ${points[i].x.toFixed(1)} ${my.toFixed(1)}`;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <defs>
            <linearGradient id="waveGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stop-color="${palette.gradient[0]}"/>
                <stop offset="50%" stop-color="${palette.gradient[1]}"/>
                <stop offset="100%" stop-color="${palette.gradient[2]}"/>
            </linearGradient>
            <linearGradient id="waveFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="${palette.gradient[0]}" stop-opacity="0.35"/>
                <stop offset="100%" stop-color="${palette.bg}" stop-opacity="0"/>
            </linearGradient>
        </defs>
        <rect width="${width}" height="${height}" fill="${palette.bg}"/>
        <path d="${fillD}" fill="url(#waveFill)"/>
        <path d="${mirrorD}" fill="none" stroke="${palette.gradient[0]}" stroke-width="1.2" stroke-opacity="0.3"/>
        <path d="${pathD}" fill="none" stroke="url(#waveGrad)" stroke-width="2.5"/>
        <line x1="${paddingX}" y1="${midY}" x2="${width - paddingX}" y2="${midY}" stroke="${palette.glow}" stroke-width="0.8" stroke-opacity="0.2"/>
    </svg>`;
}

/**
 * Radial Pulse Frame: Expanding sonic rings pulsing from a glowing bass center
 */
function generatePulseFrame(frame, totalFrames, seed, width, height, palette) {
    const cx = width / 2;
    const cy = height / 2;
    const ringCount = 5;
    const maxRadius = Math.min(width, height) / 2 - 10;
    const tNorm = (frame / totalFrames);
    const t = tNorm * Math.PI * 2;

    let ringsSvg = '';

    for (let r = 0; r < ringCount; r++) {
        // Continuous outward ripple loop
        const progress = (tNorm + r / ringCount) % 1;
        const radius = 10 + progress * (maxRadius - 10);
        const opacity = Math.sin(progress * Math.PI) * 0.85;
        const strokeW = Math.max(1.5, 3.5 * (1 - progress * 0.6));
        const colorIdx = r % palette.gradient.length;
        const color = palette.gradient[colorIdx];

        // Organic audio ring displacement
        const segments = 32;
        let d = '';
        for (let s = 0; s <= segments; s++) {
            const angle = (s / segments) * Math.PI * 2;
            const wobble = Math.sin(angle * 4 + t * 2) * 2;
            const curR = radius + wobble;
            const px = cx + Math.cos(angle) * curR;
            const py = cy + Math.sin(angle) * curR;
            d += (s === 0 ? `M ${px.toFixed(1)} ${py.toFixed(1)}` : ` L ${px.toFixed(1)} ${py.toFixed(1)}`);
        }
        d += ' Z';

        ringsSvg += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeW.toFixed(1)}" opacity="${opacity.toFixed(2)}"/>`;
    }

    // Center pulsing bass core
    const corePulse = 6 + Math.abs(Math.sin(t * 2)) * 4;
    ringsSvg += `<circle cx="${cx}" cy="${cy}" r="${(corePulse + 4).toFixed(1)}" fill="${palette.glow}" opacity="0.3"/>`;
    ringsSvg += `<circle cx="${cx}" cy="${cy}" r="${corePulse.toFixed(1)}" fill="${palette.accent}" opacity="0.9"/>`;
    ringsSvg += `<circle cx="${cx}" cy="${cy}" r="3" fill="#FFFFFF" opacity="0.9"/>`;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <defs>
            <radialGradient id="pulseBg" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="${palette.glow}" stop-opacity="0.12"/>
                <stop offset="100%" stop-color="${palette.bg}" stop-opacity="1"/>
            </radialGradient>
        </defs>
        <rect width="${width}" height="${height}" fill="${palette.bg}"/>
        <rect width="${width}" height="${height}" fill="url(#pulseBg)"/>
        ${ringsSvg}
    </svg>`;
}

// ── Style Registry ──────────────────────────────────────────────
const STYLES = {
    bars: { label: 'Spectrum Bars', emoji: '📊', frameGenerator: generateBarsFrame },
    wave: { label: 'Waveform', emoji: '🌊', frameGenerator: generateWaveFrame },
    pulse: { label: 'Radial Pulse', emoji: '💫', frameGenerator: generatePulseFrame },
};

const STYLE_KEYS = Object.keys(STYLES);

/**
 * Generate an animated GIF visualizer for a track
 * @param {string} trackTitle - The track title (used as seed for deterministic generation)
 * @param {object} [options] - Configuration options
 * @param {string} [options.style='bars'] - Visual style: 'bars', 'wave', or 'pulse'
 * @param {number} [options.width=500] - Image width
 * @param {number} [options.height=130] - Image height
 * @param {number} [options.frames=16] - Total animation frames (seamless loop)
 * @param {number} [options.delay=80] - Frame delay in ms (80ms = 12.5 FPS)
 * @param {string} [options.palette] - Force a specific palette key
 * @returns {Promise<Buffer>} Animated GIF image buffer
 */
async function generateVisualizer(trackTitle, options = {}) {
    const {
        style = 'bars',
        width = 500,
        height = 130,
        frames = 16,
        delay = 80,
        palette: forcePalette,
    } = options;

    const seed = hashString(trackTitle || 'unknown');
    const palette = forcePalette ? (PALETTES[forcePalette] || pickPalette(seed)) : pickPalette(seed);
    const styleConfig = STYLES[style] || STYLES.bars;

    // Render all frames in parallel as raw RGBA buffers
    const rawFrames = await Promise.all(
        Array.from({ length: frames }, async (_, f) => {
            const svg = styleConfig.frameGenerator(f, frames, seed, width, height, palette);
            return sharp(Buffer.from(svg))
                .raw()
                .ensureAlpha()
                .toBuffer();
        })
    );

    // Stack frames vertically and encode to animated GIF
    const stacked = Buffer.concat(rawFrames);
    const gifBuffer = await sharp(stacked, {
        raw: {
            width,
            height: height * frames,
            channels: 4,
            pageHeight: height,
        },
    })
    .gif({
        delay: rawFrames.map(() => delay),
        loop: 0, // Infinite loop
    })
    .toBuffer();

    return gifBuffer;
}

// ── Guild visualizer toggle management ──────────────────────────

function isVisualizerEnabled(guildId) {
    const prefs = guildVisualizers.get(guildId);
    return prefs?.enabled ?? false;
}

function enableVisualizer(guildId, style = 'bars') {
    guildVisualizers.set(guildId, { enabled: true, style });
}

function disableVisualizer(guildId) {
    const prefs = guildVisualizers.get(guildId) || {};
    prefs.enabled = false;
    guildVisualizers.set(guildId, prefs);
}

function toggleVisualizer(guildId, style) {
    const current = isVisualizerEnabled(guildId);
    if (current) {
        disableVisualizer(guildId);
        return false;
    } else {
        enableVisualizer(guildId, style || getVisualizerStyle(guildId));
        return true;
    }
}

function getVisualizerStyle(guildId) {
    return guildVisualizers.get(guildId)?.style || 'bars';
}

function setVisualizerStyle(guildId, style) {
    const prefs = guildVisualizers.get(guildId) || { enabled: true };
    prefs.style = style;
    guildVisualizers.set(guildId, prefs);
}

module.exports = {
    generateVisualizer,
    isVisualizerEnabled,
    enableVisualizer,
    disableVisualizer,
    toggleVisualizer,
    getVisualizerStyle,
    setVisualizerStyle,
    STYLES,
    STYLE_KEYS,
    PALETTES,
    PALETTE_KEYS,
};
