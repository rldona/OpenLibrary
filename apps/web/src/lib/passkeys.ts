/**
 * The browser side of passkeys (WebAuthn), behind one small module so the screens stay testable:
 * jsdom has no WebAuthn and the tests replace this module.
 */
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  WebAuthnError,
} from '@simplewebauthn/browser';

export const passkeysSupported = () => browserSupportsWebAuthn();

/** Asks the browser for a passkey sign-in with the server's options; returns the answer to send back. */
export const getPasskey = (options: Record<string, unknown>) =>
  startAuthentication({ optionsJSON: options as never }) as unknown as Promise<Record<string, unknown>>;

/** Asks the browser to create a passkey with the server's options. */
export const createPasskey = (options: Record<string, unknown>) =>
  startRegistration({ optionsJSON: options as never }) as unknown as Promise<Record<string, unknown>>;

/** The owner closed the browser's passkey prompt (or it timed out): not an error worth a red message. */
export function wasCancelled(e: unknown): boolean {
  const name = e instanceof WebAuthnError ? (e.cause as Error | undefined)?.name : (e as Error)?.name;
  return (
    name === 'NotAllowedError' ||
    name === 'AbortError' ||
    (e instanceof WebAuthnError && e.code === 'ERROR_CEREMONY_ABORTED')
  );
}
