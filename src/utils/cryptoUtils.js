/**
 * Utility functions for secure password hashing and verification in Kadai WebApp.
 * Ensures plaintext passwords are NEVER stored in Firestore.
 */

const SALT_PREFIX = "kadai_salt_v1_";

/**
 * Computes a SHA-256 hash of a string using Web Crypto API or JS fallback.
 * @param {string} rawString 
 * @returns {Promise<string>} Hex-encoded SHA-256 hash
 */
async function computeSha256(rawString) {
  if (typeof window !== "undefined" && window.crypto && window.crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(rawString);
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Fallback bitwise SHA-256 implementation if crypto.subtle is not accessible
  return simpleSha256Fallback(rawString);
}

/**
 * Hashes a plaintext password securely for storage in Firestore.
 * Format: "kadai_v1$<hash>"
 * @param {string} password 
 * @returns {Promise<string>}
 */
export async function hashPassword(password) {
  if (!password) return "";
  const trimmed = String(password).trim();
  const hash = await computeSha256(SALT_PREFIX + trimmed);
  return `kadai_v1$${hash}`;
}

/**
 * Verifies a plaintext password against a stored passwordHash or legacy plaintext password.
 * 100% backward-compatible with older waiter/kitchen staff accounts.
 * @param {string} enteredPassword 
 * @param {string} [storedHash] 
 * @param {string} [legacyPlaintext] 
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(enteredPassword, storedHash, legacyPlaintext) {
  if (!enteredPassword) return false;
  const trimmedEntered = String(enteredPassword).trim();

  // 1. Check against salted hash format
  if (storedHash) {
    if (storedHash.startsWith("kadai_v1$")) {
      const computed = await hashPassword(trimmedEntered);
      if (computed === storedHash) return true;
    }
    // Also check raw SHA-256 if without prefix
    const rawHash = await computeSha256(trimmedEntered);
    if (rawHash.toLowerCase() === storedHash.toLowerCase()) return true;

    // Check with salt without prefix
    const saltedRaw = await computeSha256(SALT_PREFIX + trimmedEntered);
    if (saltedRaw.toLowerCase() === storedHash.toLowerCase()) return true;
  }

  // 2. Fallback check for legacy staff with plaintext password in Firestore
  if (legacyPlaintext !== undefined && legacyPlaintext !== null && String(legacyPlaintext).trim() !== "") {
    return String(legacyPlaintext).trim() === trimmedEntered;
  }

  return false;
}

/**
 * Standalone pure-JS SHA-256 fallback implementation
 */
function simpleSha256Fallback(ascii) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }

  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let lengthProperty = "length";
  let i, j;
  let result = "";

  const words = [];
  const asciiBitLength = ascii[lengthProperty] * 8;

  let hash = [];
  const k = [];
  let primeCounter = 0;

  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 300; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  hash = hash.slice(0, 8);

  ascii += "\x80";
  while ((ascii[lengthProperty] % 64) - 56) ascii += "\x00";
  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) return "";
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
  words[words[lengthProperty]] = asciiBitLength;

  for (j = 0; j < words[lengthProperty]; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash;
    hash = hash.slice(0, 8);

    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];

      const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      w[i] = i < 16 ? w[i] : (w[i - 16] + s0 + w[i - 7] + s1) | 0;

      const s1_maj = rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25);
      const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      const temp1 = (hash[7] + s1_maj + ch + k[i] + w[i]) | 0;
      const s0_maj = rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22);
      const maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      const temp2 = (s0_maj + maj) | 0;

      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }

    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (i = 0; i < 8; i++) {
    for (j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? "0" : "") + b.toString(16);
    }
  }
  return result;
}
