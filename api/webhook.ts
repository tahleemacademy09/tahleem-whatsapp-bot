// This file lives at /api/webhook.ts so Vercel automatically turns it into
// a live URL: https://tahleem-whatsapp-bot.vercel.app/api/webhook

import type { VercelRequest, VercelResponse } from "@vercel/node";

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN!;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN!;
const API_VERSION = "v21.0";

const SITE_INFO_URL =
  "https://tahleem-whatsapp-bot.vercel.app/academy-info.json";

const SYSTEM_PROMPT = `You are the official WhatsApp assistant for Tahleem Academy, an Islamic educational platform offering Quran and Islamic studies classes.

TONE:
- Official yet warm and friendly
- Use appropriate Islamic honorifics and greetings (e.g., "Assalamu Alaikum" as a greeting, "InshaAllah" where natural, "JazakAllahu Khairan" for thanks)
- Professional, respectful, concise — avoid overly long replies

WHEN TO RESPOND:
Only reply if the message is clearly about one of these topics:
- Registration / enrollment
- Class schedules or timings
- Fees or payment
- Course/curriculum information (Quran, Hifdh, Arabic, Islamic studies)
- General inquiries about Tahleem Academy's programs

WHEN TO STAY SILENT:
- Personal messages, casual chat, or anything unrelated to Tahleem Academy's programs
- If unsure whether the message qualifies, do NOT respond — respond with exactly: NO_REPLY

You will be given up-to-date academy information (courses, pricing, enrollment steps, contact info) as JSON context below. Use ONLY that data for facts — do not invent fees, schedules, or details not present in it. If something isn't covered, direct the user to WhatsApp +234 816 331 0471 or email Tahleemacademy09@gmail.com.

REQUIRED DISCLOSURE:
Every reply you send must begin with exactly this line, then a blank line, then your response:
"🤖 This is an automated response from Tahleem Academy."

If you decide not to reply, output exactly: NO_REPLY (nothing else).`;

// ---- Helper: fetch latest academy info ----
async function getAcademyInfo(): Promise<string> {
  try {
    const res = await fetch(SITE_INFO_URL);
    const data = await res.json();
    return JSON.stringify(data);
  } catch (err) {
    console.error("Failed to fetch academy-info.json", err);
    return "{}";
  }
}

// ---- Helper: ask Gemini for a reply ----
async function askGemini(userMessage: string, academyInfo: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `${SYSTEM_PROMPT}\n\nACADEMY INFO (JSON):\n${academyInfo}\n\nINCOMING MESSAGE:\n"${userMessage}"`,
          },
        ],
      },
    ],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  console.log("Gemini raw response:", JSON.stringify(data));
  const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  return reply || "NO_REPLY";
}

// ---- Helper: send a WhatsApp message back ----
async function sendWhatsAppReply(to: string, text: string) {
  const url = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });
  const data = await res.json();
  console.log("WhatsApp send response:", JSON.stringify(data));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // --- Meta webhook verification (GET request) ---
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      res.status(200).send(challenge);
    } else {
      res.status(403).send("Forbidden");
    }
    return;
  }

  // --- Incoming message (POST request) ---
  if (req.method === "POST") {
    try {
      // Log the full incoming payload so we can see its real shape
      console.log("Incoming webhook body:", JSON.stringify(req.body));

      const entry = req.body?.entry?.[0];
      const change = entry?.changes?.[0];
      const message = change?.value?.messages?.[0];

      if (!message) {
        console.log("No message object found in payload — likely a status update, ignoring.");
        res.status(200).send("EVENT_RECEIVED");
        return;
      }

      const from = message.from;
      const text = message.text?.body || "";
      console.log("Extracted message:", { from, text });

      const academyInfo = await getAcademyInfo();
      const reply = await askGemini(text, academyInfo);
      console.log("Gemini decided reply:", reply);

      if (reply && reply !== "NO_REPLY") {
        await sendWhatsAppReply(from, reply);
      }

      res.status(200).send("EVENT_RECEIVED");
    } catch (err) {
      console.error("Webhook error:", err);
      res.status(200).send("EVENT_RECEIVED"); // Always 200 so Meta doesn't retry endlessly
    }
    return;
  }

  res.status(405).send("Method Not Allowed");
}
