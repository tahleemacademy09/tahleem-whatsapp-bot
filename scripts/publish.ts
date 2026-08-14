import fs from "fs";
import path from "path";

const POSTS_PATH = path.join(__dirname, "../posts.json");
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN!;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!;
const API_VERSION = "v21.0";

interface Post {
  id: string;
  platform: string;
  type: "text" | "template";
  content?: string;
  templateName?: string;
  templateLanguage?: string;
  templateParams?: string[];
  recipients: string[];
  scheduledTime: string;
  status: "pending" | "posted" | "failed";
  error?: string;
}

async function callWhatsAppAPI(body: Record<string, unknown>) {
  const url = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || "WhatsApp API error");
  }
  return data;
}

async function sendTextMessage(to: string, text: string) {
  return callWhatsAppAPI({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  });
}

async function sendTemplateMessage(
  to: string,
  templateName: string,
  languageCode: string,
  params: string[] = []
) {
  const components =
    params.length > 0
      ? [
          {
            type: "body",
            parameters: params.map((p) => ({ type: "text", text: p })),
          },
        ]
      : undefined;

  return callWhatsAppAPI({
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components ? { components } : {}),
    },
  });
}

async function main() {
  const posts: Post[] = JSON.parse(fs.readFileSync(POSTS_PATH, "utf-8"));
  const now = new Date();
  let updated = false;

  for (const post of posts) {
    if (
      post.platform !== "whatsapp" ||
      post.status !== "pending" ||
      new Date(post.scheduledTime) > now
    ) {
      continue;
    }

    try {
      for (const recipient of post.recipients) {
        if (post.type === "template") {
          if (!post.templateName || !post.templateLanguage) {
            throw new Error("Missing templateName or templateLanguage");
          }
          await sendTemplateMessage(
            recipient,
            post.templateName,
            post.templateLanguage,
            post.templateParams ?? []
          );
        } else {
          if (!post.content) throw new Error("Missing content for text message");
          await sendTextMessage(recipient, post.content);
        }
      }
      post.status = "posted";
      console.log(`Sent post ${post.id}`);
    } catch (err: any) {
      post.status = "failed";
      post.error = err.message;
      console.error(`Failed post ${post.id}: ${err.message}`);
    }
    updated = true;
  }

  if (updated) {
    fs.writeFileSync(POSTS_PATH, JSON.stringify(posts, null, 2));
  }
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
