// Renders docs/how-it-works.html to docs/how-it-works.pdf (one tabloid landscape page) and a PNG preview, with the
// Electron the project already depends on:  npx electron scripts/render-how-it-works.cjs [--png <path>]
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const root = path.join(__dirname, '..');
const source = path.join(root, 'docs', 'how-it-works.html');
const output = path.join(root, 'docs', 'how-it-works.pdf');
const pngFlag = process.argv.indexOf('--png');
const pngPath = pngFlag > -1 ? process.argv[pngFlag + 1] : '';

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1632, height: 1056, useContentSize: true, webPreferences: { sandbox: true } });
  try {
    await win.loadFile(source);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
    // Fail instead of writing a clipped page: every block must fit inside the page and inside its own box.
    const overflow = await win.webContents.executeJavaScript(`(() => {
      const page = document.querySelector('.page').getBoundingClientRect();
      const blocks = [...document.querySelectorAll('.page > *, .stage, .panel, .ask-item, .hood .box')];
      return blocks.filter((el) => el.getBoundingClientRect().bottom > page.bottom + 0.5 || el.scrollHeight > el.clientHeight + 1)
        .map((el) => el.className || el.tagName);
    })()`);
    if (overflow.length) throw new Error(`Content overflows: ${overflow.join(', ')}. Shorten the copy in docs/how-it-works.html.`);
    const pdf = await win.webContents.printToPDF({ pageSize: { width: 17, height: 11 }, printBackground: true, margins: { marginType: 'none' }, preferCSSPageSize: true });
    fs.writeFileSync(output, pdf);
    if (pngPath) fs.writeFileSync(pngPath, (await win.webContents.capturePage()).toPNG());
    console.log(`Wrote ${path.relative(root, output)} (${Math.round(pdf.length / 1024)} KB)`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
