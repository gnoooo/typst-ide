const fs = require('fs');
const path = require('path');

const distSrc = path.join(__dirname, '..', 'dist', 'src', 'index.html');
const out = path.join(__dirname, '..', 'dist', 'index.html');
const cssLink = '    <link rel="stylesheet" href="css/output.css">\n';

if (!fs.existsSync(distSrc)) {
  console.error('dist/src/index.html not found, aborting injection');
  process.exitCode = 1;
  return;
}

let html = fs.readFileSync(distSrc, 'utf8');
if (html.includes('href="css/output.css"')) {
  // already injected
  fs.writeFileSync(out, html, 'utf8');
  console.log('Tailwind CSS link already present — copied to dist/index.html');
  process.exit(0);
}

// Insert before closing </head>
const idx = html.indexOf('</head>');
if (idx === -1) {
  console.error('no </head> found in dist/src/index.html');
  process.exitCode = 1;
  return;
}

const injected = html.slice(0, idx) + cssLink + html.slice(idx);
fs.writeFileSync(out, injected, 'utf8');
console.log('Injected Tailwind CSS link into dist/index.html');