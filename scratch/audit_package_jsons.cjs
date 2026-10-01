const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

function findPackageJsons(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== 'dist' && file !== 'build' && file !== '.next') {
        results = results.concat(findPackageJsons(filePath));
      }
    } else if (file === 'package.json') {
      results.push(filePath);
    }
  });
  return results;
}

const files = findPackageJsons(rootDir);
console.log(`Found ${files.length} package.json files.\n`);

const results = [];

files.forEach(file => {
  const relPath = path.relative(rootDir, file);
  const content = fs.readFileSync(file, 'utf8');
  let isValid = false;
  let errorMsg = null;
  let parsed = null;

  try {
    parsed = JSON.parse(content);
    isValid = true;
  } catch (err) {
    isValid = false;
    errorMsg = err.message;
  }

  // Check for trailing characters after valid JSON (e.g. extra closing brace } at end of file)
  if (isValid) {
    const trimmed = content.trim();
    // Parse again or check if there's text after closing brace
    let lastBrace = trimmed.lastIndexOf('}');
    if (lastBrace !== -1 && lastBrace < trimmed.length - 1) {
      const remainder = trimmed.slice(lastBrace + 1);
      if (remainder.trim().length > 0) {
        isValid = false;
        errorMsg = `Extra trailing content after closing brace: ${JSON.stringify(remainder)}`;
      }
    }
  }

  results.push({
    file: relPath,
    fullPath: file,
    isValid,
    error: errorMsg,
    name: parsed ? parsed.name : null,
    workspaces: parsed ? parsed.workspaces : null
  });
});

console.log(JSON.stringify(results, null, 2));
