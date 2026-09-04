import { describe, expect, it } from 'vitest';

import {
  CODE_CHALLENGE_METHOD,
  CODE_VERIFIER_MAX_LENGTH,
  CODE_VERIFIER_MIN_LENGTH,
  createCodeVerifier,
  createPkcePair,
  createState,
  deriveCodeChallenge,
  isValidCodeVerifier,
} from '@/server/integrations/oauth/pkce';

const UNRESERVED = /^[A-Za-z0-9\-._~]+$/;

describe('pkce', () => {
  it('generates code verifiers within the RFC 7636 length and charset bounds', () => {
    for (let i = 0; i < 20; i += 1) {
      const verifier = createCodeVerifier();
      expect(verifier.length).toBeGreaterThanOrEqual(CODE_VERIFIER_MIN_LENGTH);
      expect(verifier.length).toBeLessThanOrEqual(CODE_VERIFIER_MAX_LENGTH);
      expect(verifier).toMatch(UNRESERVED);
    }
  });

  it('produces distinct verifiers and states on every call', () => {
    const verifiers = new Set(Array.from({ length: 50 }, () => createCodeVerifier()));
    const states = new Set(Array.from({ length: 50 }, () => createState()));

    expect(verifiers.size).toBe(50);
    expect(states.size).toBe(50);
  });

  it('matches the RFC 7636 appendix B S256 test vector', () => {
    // RFC 7636 Appendix B:
    //   code_verifier  = dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
    //   code_challenge = E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

    expect(deriveCodeChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('emits base64url challenges without padding', () => {
    const challenge = deriveCodeChallenge(createCodeVerifier());

    expect(challenge).not.toContain('=');
    expect(challenge).not.toContain('+');
    expect(challenge).not.toContain('/');
    // SHA-256 → 32 bytes → 43 base64url chars.
    expect(challenge).toHaveLength(43);
  });

  it('rejects verifiers that violate the spec', () => {
    expect(isValidCodeVerifier('short')).toBe(false);
    expect(isValidCodeVerifier('a'.repeat(CODE_VERIFIER_MAX_LENGTH + 1))).toBe(false);
    expect(isValidCodeVerifier(`${'a'.repeat(42)}+`)).toBe(false);
    expect(isValidCodeVerifier(123)).toBe(false);
    expect(isValidCodeVerifier(null)).toBe(false);

    expect(() => deriveCodeChallenge('too-short')).toThrow(TypeError);
  });

  it('createPkcePair only ever advertises S256', () => {
    const pair = createPkcePair();

    expect(pair.codeChallengeMethod).toBe('S256');
    expect(CODE_CHALLENGE_METHOD).toBe('S256');
    expect(pair.codeChallenge).toBe(deriveCodeChallenge(pair.codeVerifier));
  });

  it('createState yields url-safe high-entropy tokens', () => {
    const state = createState();

    expect(state).toMatch(UNRESERVED);
    // 32 bytes → 43 base64url chars.
    expect(state).toHaveLength(43);
  });
});
