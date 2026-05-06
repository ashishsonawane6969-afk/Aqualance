'use strict';

/**
 * utils/bcrypt.js — bcrypt wrapper using @node-rs/bcrypt
 *
 * @node-rs/bcrypt: Rust WASM implementation — fastest, no node-gyp, no deprecated build chain.
 * Pure JS fallback removed (A06: Vulnerable Components fix).
 *
 * API:
 *   hash(password, rounds)    → Promise<string>
 *   compare(password, hash)   → Promise<boolean>
 */

const bcrypt = require('@node-rs/bcrypt');
const provider = '@node-rs/bcrypt (Rust WASM)';

if (typeof bcrypt.hash !== 'function' || typeof bcrypt.compare !== 'function') {
  throw new Error(`[bcrypt] Loaded module has unexpected API: ${provider}`);
}

console.info(`[bcrypt] Using ${provider}`);
module.exports = bcrypt;
