/**
 * Crop a GIF to a 1:1 square ratio (center crop) and save it.
 * Usage: node animator/crop-square.js <input.gif> [output.gif]
 */
const sharp = require('sharp');
const path = require('path');

async function cropSquare() {
    const inputPath = process.argv[2];
    if (!inputPath) {
        console.error('Usage: node animator/crop-square.js <input.gif> [output.gif]');
        process.exit(1);
    }

    const resolvedInput = path.resolve(inputPath);
    const outputPath = process.argv[3]
        ? path.resolve(process.argv[3])
        : resolvedInput.replace(/\.gif$/i, '_square.gif');

    console.log(`📐 Reading: ${resolvedInput}`);

    // Get metadata to find dimensions
    const metadata = await sharp(resolvedInput, { animated: true }).metadata();
    const { width, height, pages } = metadata;

    // For animated GIFs, height = frame_height * number_of_frames
    const frameHeight = pages ? Math.round(height / pages) : height;

    console.log(`   Dimensions: ${width}×${frameHeight} (${pages || 1} frames)`);

    const size = Math.min(width, frameHeight);
    const left = Math.floor((width - size) / 2);
    const top = Math.floor((frameHeight - size) / 2);

    console.log(`✂️  Cropping to ${size}×${size} (center crop)`);

    await sharp(resolvedInput, { animated: true })
        .extract({ left, top, width: size, height: size })
        .gif()
        .toFile(outputPath);

    const fs = require('fs');
    const outputSize = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2);
    console.log(`✅ Saved: ${outputPath} (${outputSize} MB)`);
}

cropSquare().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
