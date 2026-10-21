'use strict';

/**
 * Audio-reactive spectrum utilities for Reso.
 *
 * This module intentionally accepts decoded PCM supplied by a real capture source.
 * It never synthesizes bars from track metadata or random values.
 */

const sharp = require('sharp');

const DEFAULTS = Object.freeze({
    sampleRate: 48000,
    fftSize: 2048,
    bands: 38,
    frames: 36,
    width: 480,
    height: 160,
    delay: 80,
    minFrequency: 35,
    maxFrequency: 16000,
    floor: 1e-7,
    smoothing: 0.65,
});

const PALETTES = Object.freeze({
    violet: { bg: '#0B0714', low: '#7C3AED', mid: '#A855F7', high: '#22D3EE' },
    cyan: { bg: '#061218', low: '#0891B2', mid: '#22D3EE', high: '#C4B5FD' },
});

function assertFinitePositive(value, label) {
    if (!Number.isFinite(value) || value <= 0) {
        throw new TypeError(`${label} must be a finite positive number`);
    }
}

function nextPowerOfTwo(value) {
    let result = 1;
    while (result < value) result *= 2;
    return result;
}

/**
 * Radix-2 Cooley-Tukey FFT magnitude spectrum for a real-valued PCM frame.
 * Returns magnitudes for bins [0, fftSize / 2).
 */
function fftMagnitudes(input) {
    if (!(input instanceof Float32Array) && !(input instanceof Float64Array)) {
        throw new TypeError('PCM frame must be a Float32Array or Float64Array');
    }
    if (input.length < 2 || (input.length & (input.length - 1)) !== 0) {
        throw new RangeError('PCM frame length must be a power of two greater than 1');
    }

    const n = input.length;
    const real = new Float64Array(n);
    const imag = new Float64Array(n);

    // Bit-reversal permutation.
    let j = 0;
    for (let i = 0; i < n; i++) {
        if (i < j) {
            real[i] = input[j];
            real[j] = input[i];
        } else {
            real[i] = input[i];
        }
        let bit = n >> 1;
        while (bit && (j & bit)) {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
    }

    for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1;
        const angle = -2 * Math.PI / size;
        const stepReal = Math.cos(angle);
        const stepImag = Math.sin(angle);

        for (let start = 0; start < n; start += size) {
            let twiddleReal = 1;
            let twiddleImag = 0;

            for (let offset = 0; offset < half; offset++) {
                const even = start + offset;
                const odd = even + half;
                const oddReal = real[odd] * twiddleReal - imag[odd] * twiddleImag;
                const oddImag = real[odd] * twiddleImag + imag[odd] * twiddleReal;
                const evenReal = real[even];
                const evenImag = imag[even];

                real[even] = evenReal + oddReal;
                imag[even] = evenImag + oddImag;
                real[odd] = evenReal - oddReal;
                imag[odd] = evenImag - oddImag;

                const nextReal = twiddleReal * stepReal - twiddleImag * stepImag;
                twiddleImag = twiddleReal * stepImag + twiddleImag * stepReal;
                twiddleReal = nextReal;
            }
        }
    }

    const magnitudes = new Float64Array(n >> 1);
    for (let i = 0; i < magnitudes.length; i++) {
        magnitudes[i] = Math.hypot(real[i], imag[i]) / n;
    }
    return magnitudes;
}

function hannWindow(size) {
    const window = new Float64Array(size);
    for (let i = 0; i < size; i++) {
        window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    return window;
}

/**
 * Convert one decoded mono PCM frame into normalized logarithmic frequency bands.
 * Input values should be floating-point samples in approximately [-1, 1].
 */
function analyzePcmFrame(pcm, sampleRate = DEFAULTS.sampleRate, options = {}) {
    assertFinitePositive(sampleRate, 'sampleRate');
    if (!(pcm instanceof Float32Array) && !(pcm instanceof Float64Array)) {
        throw new TypeError('PCM frame must be a Float32Array or Float64Array');
    }

    const fftSize = options.fftSize || nextPowerOfTwo(pcm.length);
    if (fftSize < 2 || (fftSize & (fftSize - 1)) !== 0) {
        throw new RangeError('fftSize must be a power of two greater than 1');
    }
    const bands = options.bands || DEFAULTS.bands;
    const minFrequency = options.minFrequency || DEFAULTS.minFrequency;
    const maxFrequency = Math.min(options.maxFrequency || DEFAULTS.maxFrequency, sampleRate / 2);
    if (!Number.isInteger(bands) || bands < 1 || minFrequency <= 0 || maxFrequency <= minFrequency) {
        throw new RangeError('Invalid frequency-band configuration');
    }

    const padded = new Float32Array(fftSize);
    const window = hannWindow(fftSize);
    const length = Math.min(pcm.length, fftSize);
    const offset = Math.max(0, Math.floor((fftSize - length) / 2));
    for (let i = 0; i < length; i++) {
        const sample = Number.isFinite(pcm[i]) ? Math.max(-1, Math.min(1, pcm[i])) : 0;
        padded[offset + i] = sample * window[i];
    }

    const magnitudes = fftMagnitudes(padded);
    const bandValues = new Array(bands).fill(0);
    const logMin = Math.log(minFrequency);
    const logMax = Math.log(maxFrequency);

    for (let band = 0; band < bands; band++) {
        const lowHz = Math.exp(logMin + (logMax - logMin) * band / bands);
        const highHz = Math.exp(logMin + (logMax - logMin) * (band + 1) / bands);
        const lowBin = Math.max(1, Math.floor(lowHz * fftSize / sampleRate));
        const highBin = Math.min(magnitudes.length - 1, Math.max(lowBin + 1, Math.ceil(highHz * fftSize / sampleRate)));
        let total = 0;
        let count = 0;
        for (let bin = lowBin; bin <= highBin; bin++) {
            total += magnitudes[bin];
            count++;
        }
        bandValues[band] = count ? total / count : 0;
    }

    const peak = Math.max(...bandValues);
    if (peak <= (options.floor || DEFAULTS.floor)) return bandValues.map(() => 0);
    return bandValues.map(value => Math.max(0, Math.min(1, Math.sqrt(value / peak))));
}

/**
 * Analyze sequential decoded PCM frames. The capture component must provide PCM
 * from the currently playing track; this function does not fetch or decode audio.
 */
function analyzePcmFrames(pcmFrames, sampleRate = DEFAULTS.sampleRate, options = {}) {
    if (!Array.isArray(pcmFrames) || pcmFrames.length === 0) {
        throw new TypeError('pcmFrames must be a non-empty array of decoded PCM frames');
    }
    const smoothing = Number.isFinite(options.smoothing)
        ? Math.max(0, Math.min(0.98, options.smoothing))
        : DEFAULTS.smoothing;
    let previous = null;

    return pcmFrames.map(frame => {
        const current = analyzePcmFrame(frame, sampleRate, options);
        if (!previous) {
            previous = current;
            return current;
        }
        const smoothed = current.map((value, index) =>
            previous[index] * smoothing + value * (1 - smoothing));
        previous = smoothed;
        return smoothed;
    });
}

function escapeXml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
    })[char]);
}

function makeFrameSvg(spectrum, frameIndex, options) {
    const { width, height, palette } = options;
    const count = spectrum.length;
    const padX = 18;
    const padY = 18;
    const gap = 3;
    const usableWidth = width - padX * 2;
    const barWidth = Math.max(1, (usableWidth - gap * (count - 1)) / count);
    const baseline = Math.floor(height * 0.72);
    const maxHeight = Math.max(8, baseline - padY);
    const bars = spectrum.map((raw, index) => {
        const level = Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : 0));
        const barHeight = Math.max(2, Math.round(level * maxHeight));
        const x = padX + index * (barWidth + gap);
        const y = baseline - barHeight;
        const ratio = index / Math.max(1, count - 1);
        const color = ratio < 0.42 ? palette.low : ratio < 0.78 ? palette.mid : palette.high;
        const capY = Math.max(padY, y - 3);
        return `<rect x="${x.toFixed(2)}" y="${y}" width="${barWidth.toFixed(2)}" height="${barHeight}" rx="2" fill="${color}" opacity="0.95"/><rect x="${x.toFixed(2)}" y="${capY}" width="${barWidth.toFixed(2)}" height="2" rx="1" fill="#FFFFFF" opacity="0.82"/>`;
    }).join('');
    const title = options.title ? `<text x="18" y="${height - 12}" font-family="Arial,sans-serif" font-size="10" fill="#D8D3E8" opacity="0.85">${escapeXml(options.title).slice(0, 110)}</text>` : '';
    const progress = (frameIndex + 1) / Math.max(1, options.frameCount);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${palette.bg}"/><line x1="${padX}" y1="${baseline}" x2="${width - padX}" y2="${baseline}" stroke="${palette.mid}" stroke-opacity="0.28"/><g>${bars}</g><rect x="18" y="${height - 5}" width="${width - 36}" height="2" rx="1" fill="#FFFFFF" opacity="0.12"/><rect x="18" y="${height - 5}" width="${(width - 36) * progress}" height="2" rx="1" fill="${palette.high}" opacity="0.8"/>${title}</svg>`;
}

/**
 * Render a GIF from measured spectrum frames. Every frame is data-driven.
 */
async function generateAudioReactiveVisualizer(spectrumFrames, options = {}) {
    if (!Array.isArray(spectrumFrames) || spectrumFrames.length < 2) {
        throw new TypeError('At least two measured spectrum frames are required');
    }
    const width = options.width || DEFAULTS.width;
    const height = options.height || DEFAULTS.height;
    const delay = options.delay || DEFAULTS.delay;
    const palette = PALETTES[options.palette] || PALETTES.violet;
    if (width < 120 || height < 80 || width > 1000 || height > 600) {
        throw new RangeError('Visualizer dimensions are outside the safe range');
    }
    const frameCount = Math.min(spectrumFrames.length, options.maxFrames || DEFAULTS.frames);
    const frames = spectrumFrames.slice(0, frameCount);
    const bandCount = frames[0]?.length;
    if (!Number.isInteger(bandCount) || bandCount < 4 || frames.some(frame => !Array.isArray(frame) || frame.length !== bandCount)) {
        throw new TypeError('All spectrum frames must contain the same number of frequency bands');
    }

    const renderOptions = { width, height, palette, title: options.title || '', frameCount };
    const rawFrames = await Promise.all(frames.map((frame, index) => {
        const safeFrame = frame.map(value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);
        const svg = makeFrameSvg(safeFrame, index, renderOptions);
        return sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer();
    }));

    const stacked = Buffer.concat(rawFrames);
    return sharp(stacked, {
        raw: { width, height: height * frameCount, channels: 4, pageHeight: height },
    }).gif({ delay: rawFrames.map(() => delay), loop: 0 }).toBuffer();
}

module.exports = {
    DEFAULTS,
    fftMagnitudes,
    analyzePcmFrame,
    analyzePcmFrames,
    generateAudioReactiveVisualizer,
};
