import fs from 'fs';
import path from 'path';

// The Hub's Website Management and the public site's /admin share one client and one set of admin screens. The Hub
// copies must match the public site's copies byte for byte, so the two entry points always enforce the same contract.
// The one intentional difference is components/ui.tsx: the public site's copy reads the site brand from its content
// context, which the Hub does not have. The Hub keeps its own copy of that file (see src/website/components/ui.tsx).
const SITE_SRC = path.resolve(__dirname, '..', '..', '..', 'site', 'src');
const HUB_SRC = path.resolve(__dirname, '..');

const SHARED = [
  'api/websiteApi.ts',
  'api/config.ts',
  'admin/AdminLayout.tsx',
  'admin/common.tsx',
  'admin/ContentScreens.tsx',
  'admin/logic.ts',
  'admin/MediaScreen.tsx',
  'admin/OperationsScreens.tsx',
  'admin/permissions.ts',
  'admin/RhapsodyScreen.tsx',
  'lib/mediaRules.ts',
];

describe('Website Management copies stay identical', () => {
  it.each(SHARED)('%s matches the public site', (rel) => {
    const hub = fs.readFileSync(path.join(HUB_SRC, rel), 'utf8');
    const site = fs.readFileSync(path.join(SITE_SRC, rel), 'utf8');
    expect(hub).toBe(site);
  });

  it('the Hub keeps its own shared UI primitives, and that is the only exception', () => {
    expect(fs.existsSync(path.join(HUB_SRC, 'components', 'ui.tsx'))).toBe(true);
  });
});
