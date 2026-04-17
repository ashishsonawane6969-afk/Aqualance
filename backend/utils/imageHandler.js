'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Saves a base64 string as an image file.
 * @param {string} base64Data The base64 string (may or may not include data:image/xxx;base64,).
 * @param {string} uploadDir The directory to save the image to.
 * @returns {Promise<string>} The filename of the saved image.
 */
async function saveBase64Image(base64Data, uploadDir) {
  if (!base64Data || typeof base64Data !== 'string') return null;

  // If it's already a URL, return it
  if (base64Data.startsWith('http://') || base64Data.startsWith('https://')) {
    return base64Data;
  }

  // Extract the actual base64 content
  const matches = base64Data.match(/^data:image\/([A-Za-z-+/]+);base64,(.+)$/);
  let extension = 'png';
  let buffer;

  if (matches && matches.length === 3) {
    extension = matches[1];
    buffer = Buffer.from(matches[2], 'base64');
  } else {
    // If it's base64 but without the prefix
    buffer = Buffer.from(base64Data, 'base64');
  }

  // Generate a random filename
  const filename = `${crypto.randomBytes(16).toString('hex')}.${extension}`;
  const filepath = path.join(uploadDir, filename);

  // Ensure directory exists
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  fs.writeFileSync(filepath, buffer);

  return `/uploads/${filename}`;
}

module.exports = { saveBase64Image };
