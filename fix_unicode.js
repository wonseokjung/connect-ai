const fs = require('fs');
let text = fs.readFileSync('src/webview.html', 'utf8');
// We need to parse unicode escapes \uXXXX and \u{XXXXX}
text = text.replace(/\\u([0-9a-fA-F]{4})/g, (m, g) => String.fromCharCode(parseInt(g, 16)));
// and surrogate pairs? The above already handles \ud83d\udcc1 by replacing each half, which JS string concatenation merges correctly.
// what about \n inside strings? Actually, if there's \n in HTML it's fine, but in JS it might need to stay as literal newline?
// No, the original TS had \\n, which means it became \n in the HTML string. So in src/webview.html, it's literal \n.
// Let's just fix the \u unicode escapes.
fs.writeFileSync('src/webview.html', text, 'utf8');
console.log('Fixed webview.html unicode escapes');
