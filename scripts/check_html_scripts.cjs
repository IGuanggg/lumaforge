const fs = require("fs");

const files = [
  "static/index.html",
  "static/canvas.html",
  "static/smart-canvas.html",
  "static/gpt-chat.html",
  "static/assets.html",
  "static/enhance.html",
];

for (const file of files) {
  const html = fs.readFileSync(file, "utf8");
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  scripts.forEach((code, index) => {
    try {
      new Function(code);
    } catch (error) {
      throw new Error(`${file} inline script #${index + 1}: ${error.message}`);
    }
  });
}
