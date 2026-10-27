const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = function (f) { return fs.readFileSync(path.join(root, f), 'utf8'); };

function buildHtml() {
  const parts = {
    RULES: JSON.stringify(JSON.parse(read('rules.json'))).replace(/</g, '\\u003c'),
    DETECT: read('src/detect.js'),
    TREE: read('src/tree.js'),
    LEAKLOG: read('src/leaklog.js'),
    APP: read('src/app.js'),
    LEAKUI: read('src/leaklog-ui.js')
  };

  let html = read('src/template.html');
  Object.keys(parts).forEach(function (key) {
    const marker = '/*__' + key + '__*/';
    if (html.split(marker).length !== 2) throw new Error('Template must contain ' + marker + ' exactly once');
    if (key !== 'RULES' && /<\/script/i.test(parts[key])) throw new Error('src for ' + key + ' contains </script');
    html = html.split(marker).join(parts[key]);
  });

  return html;
}

module.exports = { buildHtml: buildHtml };

if (require.main === module) {
  const html = buildHtml();
  fs.writeFileSync(path.join(root, 'index.html'), html);
  console.log('Built index.html (' + html.length + ' bytes)');
}
