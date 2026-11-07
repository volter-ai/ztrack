// DSSE (Dead Simple Signing Envelope) signing + verification for in-toto
// statements (roadmap item 5 m2). Ed25519 local keys for now — Sigstore
// keyless is the CI follow-up (needs an OIDC identity). The envelope and
// PAE follow the DSSE v1 spec exactly; the independent-verifier proof
// (scripts/dsse-proof.ts) rebuilds the PAE in python and verifies the
// signature with openssl — neither this file's PAE nor its crypto is
// trusted by the proof.
import { createHash, generateKeyPairSync, sign, verify, createPublicKey, createPrivateKey } from 'node:crypto';
import type { InTotoStatement } from './attest.ts';

export const PAYLOAD_TYPE = 'application/vnd.in-toto+json';

export type DsseEnvelope = {
  payload: string; // base64(JSON statement)
  payloadType: typeof PAYLOAD_TYPE;
  signatures: Array<{ keyid: string; sig: string }>;
};

/** DSSE v1 Pre-Authentication Encoding over the raw payload bytes. */
export function preAuthEncoding(payloadType: string, payload: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${Buffer.byteLength(payloadType)} ${payloadType} ${payload.byteLength} `),
    payload,
  ]);
}

export function generateSigningKey(): { privateKeyPem: string; publicKeyPem: string; keyid: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem,
    keyid: keyidFor(publicKeyPem),
  };
}

export function keyidFor(publicKeyPem: string): string {
  return createHash('sha256').update(publicKeyPem.trim()).digest('hex').slice(0, 16);
}

export function signStatement(statement: InTotoStatement, privateKeyPem: string, publicKeyPem: string): DsseEnvelope {
  const payload = Buffer.from(JSON.stringify(statement));
  const signature = sign(null, preAuthEncoding(PAYLOAD_TYPE, payload), createPrivateKey(privateKeyPem));
  return {
    payload: payload.toString('base64'),
    payloadType: PAYLOAD_TYPE,
    signatures: [{ keyid: keyidFor(publicKeyPem), sig: signature.toString('base64') }],
  };
}

export type VerifyResult =
  | { ok: true; statement: InTotoStatement; keyid: string }
  | { ok: false; reason: 'payload-type' | 'no-signature' | 'keyid-mismatch' | 'bad-signature' | 'malformed' };

export function verifyEnvelope(envelope: DsseEnvelope, publicKeyPem: string): VerifyResult {
  if (envelope.payloadType !== PAYLOAD_TYPE) return { ok: false, reason: 'payload-type' };
  const signature = envelope.signatures?.[0];
  if (!signature) return { ok: false, reason: 'no-signature' };
  const expectedKeyid = keyidFor(publicKeyPem);
  if (signature.keyid && signature.keyid !== expectedKeyid) return { ok: false, reason: 'keyid-mismatch' };
  const payload = Buffer.from(envelope.payload, 'base64');
  const valid = verify(null, preAuthEncoding(PAYLOAD_TYPE, payload), createPublicKey(publicKeyPem), Buffer.from(signature.sig, 'base64'));
  if (!valid) return { ok: false, reason: 'bad-signature' };
  try {
    return { ok: true, statement: JSON.parse(payload.toString()) as InTotoStatement, keyid: expectedKeyid };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}
