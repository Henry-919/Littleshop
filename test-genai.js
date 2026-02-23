import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

(async () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not set');
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const r = await ai.models.generateContent({
      model: "gemini3flash",
      contents: [{ parts: [{ text: "简单测试：请返回一个 JSON 对象 {\"ok\": true, \"message\": \"hello\"} 。" }] }],
      config: { responseMimeType: "application/json", temperature: 0 }
    });

    console.log('=== GEMINI RESPONSE TEXT START ===');
    console.log(r?.text ?? JSON.stringify(r, null, 2));
    console.log('=== GEMINI RESPONSE TEXT END ===');
  } catch (err) {
    const e = err || {};
    console.error('=== GEMINI ERROR ===');
    // Prefer structured information when available
    if (e.response) {
      try {
        console.error('status:', e.response.status);
        console.error('headers:', JSON.stringify(e.response.headers || {}, null, 2));
        console.error('body:', JSON.stringify(e.response.data || e.response.body || e.response, null, 2));
      } catch (x) {
        console.error('Error serializing response:', x);
      }
    } else {
      console.error(e.message || e);
    }
    // set exit code and allow graceful shutdown
    process.exitCode = 1;
    return;
  }
})();
