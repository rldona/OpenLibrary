/**
 * Software authenticator for tests: one P-256 discoverable credential, "none" attestation,
 * user presence and verification flags, and a signature counter the test can control.
 */
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers';

const b64 = (b: Uint8Array) => isoBase64URL.fromBuffer(new Uint8Array(b));
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest();

type Options = { challenge: string; rp?: { id?: string }; rpId?: string; user?: { id: string } };

export class VirtualAuthenticator {
  readonly credentialId = randomBytes(16);
  private readonly keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  private userHandle = '';
  counter = 0;
  /** Flags: user present (0x01) and verified (0x04). Tests clear UV to simulate a weak authenticator. */
  flags = 0x01 | 0x04;

  constructor(
    public origin: string,
    public rpId: string,
  ) {}

  get id(): string {
    return b64(this.credentialId);
  }

  private clientData(type: string, challenge: string): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }));
  }

  private authData(extra: Buffer = Buffer.alloc(0), flags = this.flags): Buffer {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    return Buffer.concat([sha(this.rpId), Buffer.from([flags]), counter, extra]);
  }

  /** Answer to navigator.credentials.create() for the given registration options. */
  register(options: Options) {
    this.userHandle = options.user?.id ?? '';
    const jwk = this.keys.publicKey.export({ format: 'jwk' });
    const cose = new Map<number, number | Uint8Array>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, isoBase64URL.toBuffer(jwk.x!)],
      [-3, isoBase64URL.toBuffer(jwk.y!)],
    ]);
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(this.credentialId.length);
    const attested = Buffer.concat([
      Buffer.alloc(16), // AAGUID
      idLen,
      this.credentialId,
      Buffer.from(isoCBOR.encode(cose)),
    ]);
    const authData = this.authData(attested, this.flags | 0x40);
    const attestation = new Map<string, unknown>([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', new Uint8Array(authData)],
    ]);
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: b64(this.clientData('webauthn.create', options.challenge)),
        attestationObject: b64(isoCBOR.encode(attestation as never)),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  /** Answer to navigator.credentials.get(); each call increments the counter, like a real one. */
  login(options: Options, opts: { keepCounter?: boolean } = {}) {
    if (!opts.keepCounter) this.counter++;
    const clientData = this.clientData('webauthn.get', options.challenge);
    const authData = this.authData();
    const signature = createSign('sha256')
      .update(Buffer.concat([authData, sha(clientData)]))
      .sign(this.keys.privateKey);
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: b64(clientData),
        authenticatorData: b64(authData),
        signature: b64(signature),
        userHandle: this.userHandle,
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }
}
