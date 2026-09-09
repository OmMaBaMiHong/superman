import { describe, expect, it } from 'vitest';
import { toHashHref } from '@/h5/lib/router';

describe('H5 navigation', () => {
  it('maps the shared settings link to the plugin settings page', () => {
    expect(toHashHref('/?settings=open')).toBe('#/settings');
    expect(toHashHref('/')).toBe('#/reader');
    expect(toHashHref('/studio')).toBe('#/studio');
  });
});
