const fs = require('fs').promises;
const path = require('path');

const API_URL = process.env.ANALYZE_URL || 'http://localhost:3000/api/analyze';
const IMAGES_DIR = path.join(__dirname, '..', 'test_images');
const OUT_DIR = path.join(__dirname, '..', 'test_results');
const MAX_CONCURRENCY = 3;
const RETRY_ATTEMPTS = 3;

async function ensureDir(d) {
  try { await fs.mkdir(d, { recursive: true }); } catch (e) {}
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function postImage(filePath) {
  const name = path.basename(filePath);
  const b = await fs.readFile(filePath);
  const base64 = b.toString('base64');
  const body = { base64Data: `data:image/jpeg;base64,${base64}`, mimeType: 'image/jpeg' };

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch (e) { parsed = { raw: text }; }
      const out = { status: res.status, ok: res.ok, body: parsed };
      await fs.writeFile(path.join(OUT_DIR, name + '.json'), JSON.stringify(out, null, 2));
      console.log(`${name}: ${res.status}`);
      return out;
    } catch (e) {
      console.warn(`${name}: attempt ${attempt} failed: ${e.message}`);
      if (attempt < RETRY_ATTEMPTS) await sleep(1000 * attempt);
      else {
        const out = { error: String(e) };
        await fs.writeFile(path.join(OUT_DIR, name + '.json'), JSON.stringify(out, null, 2));
        return out;
      }
    }
  }
}

async function run() {
  await ensureDir(IMAGES_DIR);
  await ensureDir(OUT_DIR);
  const files = (await fs.readdir(IMAGES_DIR)).filter(f => /\.(jpg|jpeg|png)$/i.test(f));
  if (!files.length) {
    console.log('No images found in', IMAGES_DIR);
    return;
  }

  console.log(`Found ${files.length} images — starting with concurrency ${MAX_CONCURRENCY}`);

  const results = [];
  let idx = 0;
  const workers = new Array(Math.min(MAX_CONCURRENCY, files.length)).fill(0).map(async () => {
    while (idx < files.length) {
      const i = idx++;
      const file = path.join(IMAGES_DIR, files[i]);
      try {
        const r = await postImage(file);
        results.push({ file: files[i], result: r });
      } catch (e) {
        results.push({ file: files[i], error: String(e) });
      }
    }
  });

  await Promise.all(workers);
  await fs.writeFile(path.join(OUT_DIR, 'summary.json'), JSON.stringify(results, null, 2));
  console.log('Done. Results in', OUT_DIR);
}

run().catch(e => { console.error(e); process.exitCode = 1; });
