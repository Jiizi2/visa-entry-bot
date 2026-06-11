const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else if (file.endsWith('.tsx')) {
      results.push(file);
    }
  });
  return results;
}

const files = walk('src');
for (const f of files) {
  let text = fs.readFileSync(f, 'utf8');
  if (text.includes('useAppContext')) {
    console.log('Processing:', f);
    
    // Replace import
    let importPath = './store';
    if (f.includes('pages\\') || f.includes('pages/') || f.includes('components\\') || f.includes('components/')) {
      importPath = '../store';
    }
    
    text = text.replace(/import\s+\{\s*useAppContext\s*\}\s+from\s+['"].*AppContext['"];?/g, `import { useStore } from '${importPath}';`);
    
    // Replace hook call
    text = text.replace(/const\s+\{\s*state\s*,\s*updateState\s*\}\s*=\s*useAppContext\(\);/g, 'const state = useStore();\n  const updateState = useStore(s => s.updateState);');
    
    fs.writeFileSync(f, text);
  }
}
console.log('Done');
