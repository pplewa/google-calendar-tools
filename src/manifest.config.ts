// @ts-nocheck
import { defineManifest } from '@crxjs/vite-plugin'

// Get OAuth2 client ID from environment variable
const clientId = process.env.VITE_GOOGLE_CLIENT_ID

if (!clientId) {
  throw new Error(
    'Missing VITE_GOOGLE_CLIENT_ID environment variable. ' +
    'Please create a .env file in the project root with: ' +
    'VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com'
  )
}

const manifest = defineManifest({
  name: 'Google Calendar Tools',
  description: 'Enhance Google Calendar with powerful productivity tools.',
  version: '0.0.1',
  manifest_version: 3,
  icons: {
    16: 'img/logo-16.png',
    32: 'img/logo-32.png',
    48: 'img/logo-48.png',
    128: 'img/logo-128.png',
  },
  action: {
    default_popup: 'popup.html',
    default_icon: 'img/logo-48.png',
  },
  options_page: 'options.html',
  devtools_page: 'devtools.html',
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['https://calendar.google.com/*'],
      js: ['src/contentScript/index.ts'],
    },
  ],
  side_panel: {
    default_path: 'sidepanel.html',
  },
  web_accessible_resources: [
    {
      resources: ['img/logo-16.png', 'img/logo-32.png', 'img/logo-48.png', 'img/logo-128.png'],
      matches: ['https://calendar.google.com/*'],
    },
  ],
  permissions: ['storage', 'activeTab', 'identity'],
  oauth2: {
    client_id: clientId,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  },
  chrome_url_overrides: {
    newtab: 'newtab.html',
  },
  host_permissions: ['https://calendar.google.com/*', 'https://www.googleapis.com/*'],
})

export default manifest 