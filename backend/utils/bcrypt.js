'use strict';

/**
 * utils/bcrypt.js — bcrypt compatibility shim
 *
 * Tries @node-rs/bcrypt first (Rust WASM — fastest, no deprecated build chain).
 * Falls back to bcryptjs (pure JS — always available, same API).
 *
 * Both libraries expose identical async API:
 *   hash(password, rounds)    → Promise<string>
 *   compare(password, hash)   → Promise<boolean>
 *
 * This shim means the app works whether or not npm install has been run yet
 * with @node-rs/bcrypt — eliminating the 500 errors on login seen in the browser.
 * To upgrade: npm install @node-rs/bcrypt && npm uninstall bcryptjs
 */

let bcrypt;
let provider;

try {
  bcrypt   = require('@node-rs/bcrypt');
  provider = '@node-rs/bcrypt (Rust WASM)';
} catch (_) {
  bcrypt   = require('bcryptjs');
  provider = 'bcryptjs (pure JS fallback)';
}

if (typeof bcrypt.hash !== 'function' || typeof bcrypt.compare !== 'function') {
  throw new Error(`[bcrypt] Loaded module has unexpected API: ${provider}`);
}

console.info(`[bcrypt] Using ${provider}`);
module.exports = bcrypt;
