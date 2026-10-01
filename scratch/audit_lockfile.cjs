const fs = require('fs');
const path = require('path');

const lockPath = path.resolve(__dirname, '../package-lock.json');

if (!fs.existsSync(lockPath)) {
  console.log('package-lock.json does NOT exist.');
  process.exit(0);
}

try {
  const content = fs.readFileSync(lockPath, 'utf8');
  const lock = JSON.parse(content);
  console.log('package-lock.json JSON.parse: PASS');
  console.log('lockfileVersion:', lock.lockfileVersion);
  console.log('name:', lock.name);
  
  if (lock.packages) {
    const pkgKeys = Object.keys(lock.packages);
    console.log('Total packages in lock:', pkgKeys.length);
    const workspacesInLock = pkgKeys.filter(k => k.startsWith('apps/') || k.startsWith('packages/') || k === 'Front' || k === 'node-api');
    console.log('Workspaces present in lock:', workspacesInLock);
  }
} catch (err) {
  console.log('package-lock.json JSON.parse: FAIL');
  console.log('Error:', err.message);
}
