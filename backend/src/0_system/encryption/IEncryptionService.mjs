// backend/src/0_system/encryption/IEncryptionService.mjs

/**
 * Interface for encryption backends.
 * Implementations handle key management internally.
 */
export class IEncryptionService {
  /**
   * Encrypt plaintext
   * @param {string} plaintext - Data to encrypt
   * @returns {string} Base64-encoded ciphertext
   */
  encrypt(plaintext) { throw new Error('Not implemented'); }

  /**
   * Decrypt ciphertext
   * @param {string} ciphertext - Base64-encoded ciphertext
   * @returns {string} Decrypted plaintext
   */
  decrypt(ciphertext) { throw new Error('Not implemented'); }
}

export default IEncryptionService;
