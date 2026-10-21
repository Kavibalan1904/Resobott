'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    fftMagnitudes,
    analyzePcmFrame,
    analyzePcmFrames,
} = require('../src/utils/audioReactiveVisualizer');

function sineFrame(frequency, sampleRate = 48000, size = 2048) {
    return Float32Array.from({ length: size }, (_, index) =>
        0.8 * Math.sin(2 * Math.PI * frequency * index / sampleRate));
}

test('FFT identifies the dominant bin for a bin-centred sine wave', () => {
    const size = 2048;
    const bin = 24;
    const frame = Float32Array.from({ length: size }, (_, index) =>
        Math.sin(2 * Math.PI * bin * index / size));
    const magnitudes = fftMagnitudes(frame);
    let peakIndex = 0;
    for (let i = 1; i < magnitudes.length; i++) {
        if (magnitudes[i] > magnitudes[peakIndex]) peakIndex = i;
    }
    assert.equal(peakIndex, bin);
});

test('different input frequencies produce different band patterns', () => {
    const low = analyzePcmFrame(sineFrame(120), 48000, { bands: 32, fftSize: 2048 });
    const high = analyzePcmFrame(sineFrame(6000), 48000, { bands: 32, fftSize: 2048 });
    assert.equal(low.length, 32);
    assert.equal(high.length, 32);
    assert.notDeepEqual(low, high);
    const lowPeak = low.indexOf(Math.max(...low));
    const highPeak = high.indexOf(Math.max(...high));
    assert.ok(lowPeak < highPeak, `expected low-frequency peak ${lowPeak} below high-frequency peak ${highPeak}`);
});

test('silence produces finite zero-valued bands', () => {
    const spectrum = analyzePcmFrame(new Float32Array(2048), 48000, { bands: 24, fftSize: 2048 });
    assert.equal(spectrum.length, 24);
    assert.ok(spectrum.every(value => value === 0 && Number.isFinite(value)));
});

test('sequential analysis smooths changes and keeps values bounded', () => {
    const frames = analyzePcmFrames([
        sineFrame(120),
        sineFrame(6000),
        sineFrame(6000),
    ], 48000, { bands: 24, fftSize: 2048, smoothing: 0.5 });
    assert.equal(frames.length, 3);
    for (const frame of frames) {
        assert.equal(frame.length, 24);
        assert.ok(frame.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    }
    assert.notDeepEqual(frames[0], frames[1]);
});

test('invalid PCM input is rejected instead of generating synthetic output', () => {
    assert.throws(() => analyzePcmFrame([0, 1, 0, -1]), /Float32Array or Float64Array/);
    assert.throws(() => analyzePcmFrames([]), /non-empty array/);
    assert.throws(() => fftMagnitudes(new Float32Array(1000)), /power of two/);
});
