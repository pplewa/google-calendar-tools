// @ts-nocheck
import { defineManifest } from '@crxjs/vite-plugin'

const manifest = defineManifest({
  name: 'Google Calendar Tools',
  description: 'Enhance Google Calendar with powerful productivity tools: duplicate events, copy entire days, batch operations, and quick duration adjustments.',
  version: '0.0.1',
  manifest_version: 3,
  icons: {
    16: 'img/logo-16.png',
    32: 'img/logo-32.png',
    48: 'img/logo-48.png',
    128: 'img/logo-128.png',
  },
  content_scripts: [
    {
      matches: ['https://calendar.google.com/*'],
      js: ['src/contentScript/index.ts'],
    },
  ],
  web_accessible_resources: [
    {
      resources: ['img/logo-16.png', 'img/logo-32.png', 'img/logo-48.png', 'img/logo-128.png'],
      matches: ['https://calendar.google.com/*'],
    },
  ],
  permissions: ['storage', 'activeTab'],
  host_permissions: ['https://calendar.google.com/*'],
})

export default manifest 