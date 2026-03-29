import { describe, expect, test } from "bun:test";
import {
  decryptPrivateKey,
  encryptPrivateKey,
  resolveEncryptionKey,
} from "./encryption";

describe("private key encryption", () => {
  test("round-trips encrypted keys", () => {
    const key = resolveEncryptionKey("12345678901234567890123456789012");
    const encrypted = encryptPrivateKey("0xabc123", key);

    expect(encrypted.startsWith("v1:")).toBe(true);
    expect(decryptPrivateKey(encrypted, key)).toBe("0xabc123");
  });

  test("rejects malformed payloads", () => {
    const key = resolveEncryptionKey("12345678901234567890123456789012");

    expect(() => decryptPrivateKey("bad-payload", key)).toThrow(
      "Encrypted private key payload is malformed.",
    );
  });
});
