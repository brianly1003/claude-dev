const fs = require('fs');
const path = require('path');
const sass = require('sass');

const scssInput = path.join(__dirname, 'src/ui/styles/scss/main.scss');
const cssOutput = path.join(__dirname, 'src/ui/styles/compiled.css');

try {
  const result = sass.compile(scssInput, {
    style: 'compressed',
    sourceMap: true
  });

  // Ensure output directory exists
  const outputDir = path.dirname(cssOutput);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write CSS file
  fs.writeFileSync(cssOutput, result.css);
  
  // Write source map if available
  if (result.sourceMap) {
    fs.writeFileSync(cssOutput + '.map', JSON.stringify(result.sourceMap));
  }

  console.log('✅ SCSS compiled successfully!');
  console.log(`📦 Output: ${cssOutput}`);
  console.log(`📏 Size: ${(Buffer.byteLength(result.css, 'utf8') / 1024).toFixed(2)} KB`);
} catch (error) {
  console.error('❌ SCSS compilation failed:', error.message);
  process.exit(1);
}