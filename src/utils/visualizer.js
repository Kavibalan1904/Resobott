/**
 * Reso Audio Visualizer — Premium Spectrum Image Generator
 * Generates stylized audio spectrum / waveform images for Now Playing embeds.
 * Uses sharp (SVG → PNG) pipeline for fast, dependency-free image generation.
 * Each track gets a unique, deterministic visualization based on its title hash.
 */

const sharp = require('sharp');

// ── Reso Color Palette (matches embeds.js) ──────────────────────
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
 * Simple deterministic hash from a string (for seeding unique visuals per track)
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
 * Generate spectrum bar heights from a track seed
 */
function generateBarHeights(seed, barCount, maxHeight) {
    const rng = seededRandom(seed);
    const heights = [];

    // Generate raw heights with musical frequency curve shape
    for (let i = 0; i < barCount; i++) {
        // Create a natural-looking frequency curve: higher in the bass/mid range, tapering at highs
        const normalizedPos = i / barCount;
        const curve = Math.sin(normalizedPos * Math.PI) * 0.7 + 0.3;
        const randomFactor = 0.4 + rng() * 0.6;
        heights.push(Math.floor(curve * randomFactor * maxHeight));
    }

    return heights;
}

/**
 * Pick a palette based on the track seed
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
 * Get the gradient color for a bar based on its height
 */
function getBarColor(height, maxHeight, gradientColors) {
    const t = height / maxHeight;
    if (t < 0.33) {
        return interpolateColor(gradientColors[0], gradientColors[1], t / 0.33);
    } else if (t < 0.66) {
        return interpolateColor(gradientColors[1], gradientColors[2], (t - 0.33) / 0.33);
    } else {
        return interpolateColor(gradientColors[2], gradientColors[3], (t - 0.66) / 0.34);
    }
}

// ── SVG Generators ──────────────────────────────────────────────

/**
 * Generate a spectrum bars visualization (classic EQ look)
 */
function generateBarsSVG(seed, width, height, palette) {
    const barCount = 48;
    const barGap = 3;
    const barWidth = (width - (barCount - 1) * barGap - 40) / barCount; // 20px padding each side
    const maxBarHeight = height - 40; // 20px padding top/bottom
    const paddingX = 20;
    const paddingBottom = 20;

    const heights = generateBarHeights(seed, barCount, maxBarHeight);

    // Build gradient defs for glow effects
    let defs = `
    <defs>
        <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
            <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
            </feMerge>
        </filter>
        <linearGradient id="barGrad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stop-color="${palette.gradient[0]}" stop-opacity="1"/>
            <stop offset="40%" stop-color="${palette.gradient[1]}" stop-opacity="0.95"/>
            <stop offset="70%" stop-color="${palette.gradient[2]}" stop-opacity="0.85"/>
            <stop offset="100%" stop-color="${palette.gradient[3]}" stop-opacity="0.7"/>
        </linearGradient>
        <linearGradient id="reflectGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${palette.gradient[0]}" stop-opacity="0.3"/>
            <stop offset="100%" stop-color="${palette.gradient[0]}" stop-opacity="0"/>
        </linearGradient>
    </defs>`;

    let bars = '';
    for (let i = 0; i < barCount; i++) {
        const x = paddingX + i * (barWidth + barGap);
        const barHeight = Math.max(4, heights[i]);
        const y = height - paddingBottom - barHeight;

        // Main bar with rounded top
        const barColor = getBarColor(barHeight, maxBarHeight, palette.gradient);
        const radius = Math.min(barWidth / 2, 4);
        bars += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="${radius}" ry="${radius}" fill="${barColor}" filter="url(#glow)" opacity="0.9"/>`;

        // Reflection bar (short, mirrored below baseline)
        const reflectionHeight = Math.min(barHeight * 0.2, 15);
        bars += `<rect x="${x}" y="${height - paddingBottom}" width="${barWidth}" height="${reflectionHeight}" rx="${radius}" ry="${radius}" fill="url(#reflectGrad)"/>`;
    }

    // Baseline glow line
    const baseLine = `<line x1="${paddingX}" y1="${height - paddingBottom}" x2="${width - paddingX}" y2="${height - paddingBottom}" stroke="${palette.glow}" stroke-width="1" stroke-opacity="0.4"/>`;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        ${defs}
        <rect width="${width}" height="${height}" fill="${palette.bg}"/>
        ${baseLine}
        ${bars}
    </svg>`;
}

/**
 * Generate a smooth waveform visualization
 */
function generateWaveSVG(seed, width, height, palette) {
    const pointCount = 80;
    const rng = seededRandom(seed);
    const midY = height / 2;
    const amplitude = height * 0.35;
    const paddingX = 15;

    const points = [];
    for (let i = 0; i < pointCount; i++) {
        const x = paddingX + (i / (pointCount - 1)) * (width - 2 * paddingX);
        // Layered sine curves + randomness for organic feel
        const normalizedPos = i / pointCount;
        const wave1 = Math.sin(normalizedPos * Math.PI * 3 + seed * 0.01) * 0.5;
        const wave2 = Math.sin(normalizedPos * Math.PI * 7 + seed * 0.02) * 0.3;
        const noise = (rng() - 0.5) * 0.4;
        const combined = (wave1 + wave2 + noise) * amplitude;
        points.push({ x, y: midY + combined });
    }

    // Build smooth curve path using catmull-rom → cubic bezier conversion
    let pathTop = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        const next = points[i + 1];
        const cpx1 = curr.x - (next.x - prev.x) / 6;
        const cpy1 = curr.y - (next.y - prev.y) / 6;
        const cpx2 = curr.x + (next.x - prev.x) / 6;
        const cpy2 = curr.y + (next.y - prev.y) / 6;
        pathTop += ` C ${cpx1} ${cpy1}, ${prev.x + (curr.x - prev.x) * 0.66} ${prev.y + (curr.y - prev.y) * 0.66}, ${curr.x} ${curr.y}`;
    }
    const last = points[points.length - 1];
    pathTop += ` L ${last.x} ${last.y}`;

    // Create filled area (wave to bottom)
    const filledPath = `${pathTop} L ${last.x} ${height} L ${points[0].x} ${height} Z`;

    // Mirror wave (reflection)
    const mirrorPoints = points.map(p => ({ x: p.x, y: midY + (midY - p.y) }));
    let mirrorPath = `M ${mirrorPoints[0].x} ${mirrorPoints[0].y}`;
    for (let i = 1; i < mirrorPoints.length; i++) {
        mirrorPath += ` L ${mirrorPoints[i].x} ${mirrorPoints[i].y}`;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <defs>
            <filter id="glow">
                <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                </feMerge>
            </filter>
            <linearGradient id="waveGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stop-color="${palette.gradient[0]}"/>
                <stop offset="50%" stop-color="${palette.gradient[1]}"/>
                <stop offset="100%" stop-color="${palette.gradient[2]}"/>
            </linearGradient>
            <linearGradient id="waveFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="${palette.gradient[0]}" stop-opacity="0.3"/>
                <stop offset="100%" stop-color="${palette.bg}" stop-opacity="0"/>
            </linearGradient>
        </defs>
        <rect width="${width}" height="${height}" fill="${palette.bg}"/>
        <path d="${filledPath}" fill="url(#waveFill)"/>
        <path d="${pathTop}" fill="none" stroke="url(#waveGrad)" stroke-width="2.5" filter="url(#glow)"/>
        <path d="${mirrorPath}" fill="none" stroke="${palette.gradient[0]}" stroke-width="1" stroke-opacity="0.2"/>
        <line x1="${paddingX}" y1="${midY}" x2="${width - paddingX}" y2="${midY}" stroke="${palette.glow}" stroke-width="0.5" stroke-opacity="0.15"/>
    </svg>`;
}

/**
 * Generate a circular pulse / radial visualization
 */
function generatePulseSVG(seed, width, height, palette) {
    const cx = width / 2;
    const cy = height / 2;
    const ringCount = 5;
    const maxRadius = Math.min(width, height) / 2 - 15;
    const rng = seededRandom(seed);
    const segmentCount = 64;

    let rings = '';

    for (let r = 0; r < ringCount; r++) {
        const baseRadius = (r + 1) * (maxRadius / ringCount);
        const opacity = 1 - r * 0.15;
        const strokeWidth = 3 - r * 0.4;

        // Generate irregular ring using polar coordinates
        const ringPoints = [];
        for (let s = 0; s < segmentCount; s++) {
            const angle = (s / segmentCount) * Math.PI * 2;
            const variation = rng() * maxRadius * 0.12;
            const radius = baseRadius + variation;
            ringPoints.push({
                x: cx + Math.cos(angle) * radius,
                y: cy + Math.sin(angle) * radius,
            });
        }

        // Close the ring with a smooth path
        let path = `M ${ringPoints[0].x} ${ringPoints[0].y}`;
        for (let i = 1; i <= ringPoints.length; i++) {
            const curr = ringPoints[i % ringPoints.length];
            const prev = ringPoints[(i - 1) % ringPoints.length];
            const next = ringPoints[(i + 1) % ringPoints.length];
            path += ` L ${curr.x} ${curr.y}`;
        }
        path += ' Z';

        const colorIdx = r % palette.gradient.length;
        rings += `<path d="${path}" fill="none" stroke="${palette.gradient[colorIdx]}" stroke-width="${strokeWidth}" opacity="${opacity}" filter="url(#glow)"/>`;
    }

    // Center dot
    rings += `<circle cx="${cx}" cy="${cy}" r="6" fill="${palette.accent}" filter="url(#glow)" opacity="0.9"/>`;
    rings += `<circle cx="${cx}" cy="${cy}" r="3" fill="#FFFFFF" opacity="0.7"/>`;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <defs>
            <filter id="glow">
                <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                </feMerge>
            </filter>
            <radialGradient id="bgGrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="${palette.glow}" stop-opacity="0.08"/>
                <stop offset="100%" stop-color="${palette.bg}" stop-opacity="1"/>
            </radialGradient>
        </defs>
        <rect width="${width}" height="${height}" fill="${palette.bg}"/>
        <rect width="${width}" height="${height}" fill="url(#bgGrad)"/>
        ${rings}
    </svg>`;
}

// ── Style Registry ──────────────────────────────────────────────
const STYLES = {
    bars: { label: 'Spectrum Bars', emoji: '📊', generator: generateBarsSVG },
    wave: { label: 'Waveform', emoji: '🌊', generator: generateWaveSVG },
    pulse: { label: 'Radial Pulse', emoji: '💫', generator: generatePulseSVG },
};

const STYLE_KEYS = Object.keys(STYLES);

/**
 * Generate a visualizer image for a track
 * @param {string} trackTitle - The track title (used as seed for deterministic generation)
 * @param {object} [options] - Configuration options
 * @param {string} [options.style='bars'] - Visual style: 'bars', 'wave', or 'pulse'
 * @param {number} [options.width=600] - Image width
 * @param {number} [options.height=150] - Image height
 * @param {string} [options.palette] - Force a specific palette key
 * @returns {Promise<Buffer>} PNG image buffer
 */
async function generateVisualizer(trackTitle, options = {}) {
    const {
        style = 'bars',
        width = 600,
        height = 150,
        palette: forcePalette,
    } = options;

    const seed = hashString(trackTitle || 'unknown');
    const palette = forcePalette ? (PALETTES[forcePalette] || pickPalette(seed)) : pickPalette(seed);
    const styleConfig = STYLES[style] || STYLES.bars;

    const svg = styleConfig.generator(seed, width, height, palette);
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();

    return buffer;
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
