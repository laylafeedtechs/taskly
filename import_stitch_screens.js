import fs from 'fs';
import path from 'path';
import https from 'https';

const screensData = JSON.parse(fs.readFileSync('C:/Users/agenc/.gemini/antigravity-ide/brain/8856bba9-8357-4f13-9e39-651d42be0e1f/.system_generated/steps/23/output.txt', 'utf8'));

const outDir = path.resolve('stitch_imports');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download ${url}: status ${res.statusCode}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', reject);
  });
}

async function run() {
  console.log(`Starting import of ${screensData.screens.length} Stitch screens and assets...`);
  
  const manifest = [];

  for (const screen of screensData.screens) {
    const id = screen.name.split('/').pop();
    const title = screen.title || id;
    const sanitizedTitle = title.toLowerCase().replace(/[^a-z0-9_-]/gi, '_').substring(0, 50);
    const item = {
      id,
      title,
      screenName: screen.name,
      width: screen.width,
      height: screen.height,
      deviceType: screen.deviceType,
    };

    if (screen.htmlCode && screen.htmlCode.downloadUrl) {
      const ext = screen.htmlCode.mimeType === 'image/svg+xml' ? 'svg' : 'html';
      const filename = `${id}_${sanitizedTitle}.${ext}`;
      const filePath = path.join(outDir, filename);
      console.log(`Downloading code for "${title}" -> ${filename}...`);
      try {
        await downloadFile(screen.htmlCode.downloadUrl, filePath);
        item.codeFile = filename;
      } catch (err) {
        console.error(`Error downloading code for ${title}:`, err.message);
      }
    }

    if (screen.screenshot && screen.screenshot.downloadUrl) {
      const imgFilename = `${id}_screenshot.webp`;
      const imgPath = path.join(outDir, imgFilename);
      try {
        await downloadFile(screen.screenshot.downloadUrl, imgPath);
        item.screenshotFile = imgFilename;
      } catch (err) {
        console.error(`Error downloading screenshot for ${title}:`, err.message);
      }
    }

    manifest.push(item);
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log('Stitch screens import completed successfully!');
}

run().catch(console.error);
