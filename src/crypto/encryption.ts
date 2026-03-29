import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ConfigError, CryptoError } from "../errors";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

const decodeHex = (value: string) => {
  if (!/^[0-9a-fA-F]+$/.test(value) || value.length % 2 !== 0) {
    return null;
  }

  return Buffer.from(value, "hex");
};

const decodeBase64 = (value: string) => {
  try {
    const decoded = Buffer.from(value, "base64");
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
};

export const resolveEncryptionKey = (rawKey: string) => {
  const trimmed = rawKey.trim();
  const utf8 = Buffer.from(trimmed, "utf8");
  const hex = decodeHex(trimmed);
  const base64 = decodeBase64(trimmed);

  const candidates = [utf8, hex, base64].filter(
    (value): value is Exclude<typeof value, null> =>
      value !== null && value.length === 32,
  );

  if (candidates.length === 0) {
    throw new ConfigError(
      "USER_WALLET_ENCRYPTION_KEY must decode to exactly 32 bytes.",
    );
  }

  return candidates[0]!;
};

export const encryptPrivateKey = (privateKey: string, encryptionKey: Buffer) => {
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, encryptionKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(privateKey, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [
      VERSION,
      iv.toString("hex"),
      ciphertext.toString("hex"),
      tag.toString("hex"),
    ].join(":");
  } catch (error) {
    throw new CryptoError("Failed to encrypt the generated private key.", error);
  }
};

export const decryptPrivateKey = (
  encryptedPrivateKey: string,
  encryptionKey: Buffer,
) => {
  const [version, ivHex, ciphertextHex, tagHex] = encryptedPrivateKey.split(":");

  if (version !== VERSION || !ivHex || !ciphertextHex || !tagHex) {
    throw new CryptoError("Encrypted private key payload is malformed.");
  }

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      encryptionKey,
      Buffer.from(ivHex, "hex"),
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex, "hex")),
      decipher.final(),
    ]);

    return plaintext.toString("utf8");
  } catch (error) {
    throw new CryptoError("Failed to decrypt the stored private key.", error);
  }
};
