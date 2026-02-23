import dotenv from "dotenv";

dotenv.config();

(async () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not set');
    process.exitCode = 1;
    return;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url, { method: 'GET' });
    const body = await res.text();
    console.log('status:', res.status);
    try {
      console.log(JSON.stringify(JSON.parse(body), null, 2));
    } catch (e) {
      console.log('raw body:', body);
    }
  } catch (e) {
    console.error('fetch error:', e);
    process.exitCode = 1;
  }
})();
