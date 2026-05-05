const fs = require('fs');
let ext = fs.readFileSync('src/extension.ts', 'utf8');
let html = fs.readFileSync('src/webview.html', 'utf8');

// Escape backticks and ${}
html = html.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

let replacement = '    private _getHtml(): string {\n        return `' + html + '`;\n    }';

ext = ext.replace(/\s*private _getHtml\(\): string \{\s*const htmlPath = path\.join\(this\._extensionUri\.fsPath, 'src', 'webview\.html'\);\s*return fs\.readFileSync\(htmlPath, 'utf-8'\);\s*\}/, '\n\n' + replacement);

fs.writeFileSync('src/extension.ts', ext, 'utf8');
console.log('Restored _getHtml string literal');
