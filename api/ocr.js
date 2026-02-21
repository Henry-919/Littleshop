import { GoogleGenAI, Type } from '@google/genai';

export default async function handler(req, res) {
  // 仅允许 POST 请求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { base64Data, mimeType } = req.body;

    if (!base64Data || !mimeType) {
      return res.status(400).json({ error: 'Missing image data' });
    }

    // 从环境变量读取 Gemini API Key
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Data,
              mimeType: mimeType
            }
          },
          {
            text: "Extract the following information from this receipt/invoice: product name, unit price, quantity, total amount, and sale date. If the year is missing from the date, default to 2026. Format date as YYYY-MM-DD. If the image is blurry, unreadable, or missing key information, provide an error message explaining what is missing."
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  productName: { type: Type.STRING },
                  unitPrice: { type: Type.NUMBER },
                  quantity: { type: Type.NUMBER },
                  totalAmount: { type: Type.NUMBER }
                },
                required: ["productName", "unitPrice", "quantity", "totalAmount"]
              }
            },
            saleDate: { type: Type.STRING, description: "Date of the sale in YYYY-MM-DD format" },
            error: { type: Type.STRING, description: "Error message if information is missing or blurry" }
          }
        }
      }
    });

    const jsonStr = response.text;
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      return res.status(200).json(parsed);
    } else {
      return res.status(500).json({ error: 'Failed to parse the receipt.' });
    }
  } catch (error) {
    console.error('OCR Error:', error);
    return res.status(500).json({ error: 'An error occurred while processing the image.' });
  }
}
