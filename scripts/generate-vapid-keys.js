#!/usr/bin/env node
/**
 * Generate VAPID key pair for Web Push notifications.
 *
 * Usage (after npm ci, web-push is a dev dependency):
 *   node scripts/generate-vapid-keys.js
 *
 * Or without installing anything:
 *   npx --yes web-push generate-vapid-keys
 *
 * Output:
 *   Public key  → paste into .env as REACT_APP_VAPID_PUBLIC_KEY
 *   Private key → paste into Supabase project secrets as VAPID_PRIVATE_KEY
 */

try {
  const webpush = require('web-push');
  const keys = webpush.generateVAPIDKeys();

  console.log('\n✅  VAPID Keys Generated\n');
  console.log('─────────────────────────────────────────────');
  console.log('PUBLIC KEY (→ .env as REACT_APP_VAPID_PUBLIC_KEY):');
  console.log(keys.publicKey);
  console.log('\nPRIVATE KEY (→ Supabase secrets as VAPID_PRIVATE_KEY):');
  console.log(keys.privateKey);
  console.log('─────────────────────────────────────────────');
  console.log('\n⚠️  Never commit the private key to git.\n');
} catch (err) {
  if (err.code === 'MODULE_NOT_FOUND') {
    console.error('web-push is not installed. Run:\n  npm install web-push\nthen try again.');
  } else {
    console.error(err);
  }
  process.exit(1);
}
