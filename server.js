import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: "15mb" }));

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-flash-lite-latest";

const IDENTIFY_SYSTEM = `You are Veridose, a cautious assistant that helps people narrow down what an unlabeled pill or strip might be, from either a photo (shape, color, imprint/markings, packaging text) or a plain-text description the person gives instead.

CRITICAL SAFETY RULES — never break these:
- You are NOT making a diagnosis or a confirmed identification. Many pills look nearly identical, and visual/description-based ID alone is unreliable.
- NEVER state a single medication name as certain. Always give 2-4 POSSIBLE matches ranked by likelihood, each with a brief reason (color/shape/imprint match).
- NEVER suggest a dosage, how much to take, or when to take it.
- NEVER tell the person to take, skip, or stop any medication. That decision belongs to a doctor or pharmacist.
- For every possible match, include its general, well-known purpose (e.g. "commonly used to reduce fever and pain" or "a blood pressure medication") — this is educational context, not a personalized recommendation, and must stay general rather than tailored to the person's situation.
- If asked about interactions with the person's other listed medications, describe GENERAL, well-known categories of concern (e.g. "some blood thinners can interact with common painkillers") rather than a definitive clinical verdict, and always end by recommending they confirm with a pharmacist before taking anything.
- If the photo or description is too unclear or sparse to say anything useful, say so honestly instead of guessing.

Respond entirely in ${"{{LANGUAGE}}"}. Return ONLY a valid JSON object with exactly these keys:
{
  "possible_matches": [ { "name": string, "reason": string, "common_use": string, "likelihood": "high"|"medium"|"low" } ],
  "visual_notes": string,
  "interaction_flags": [ { "concern": string, "with": string } ],
  "confidence": "high"|"medium"|"low",
  "advice": string
}
"common_use" must always be filled in for every match — a short, general-purpose description of what that medicine is typically used for, in plain language. "interaction_flags" should be an empty array if no current medications were listed or no plausible general concern applies. "advice" must always include a clear recommendation to confirm with a pharmacist or doctor before taking any action, and must never contain a dosage or timing instruction.`;

app.post("/api/identify", async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: "Server is missing GEMINI_API_KEY. Add it to your .env file." });
  }

  const { base64, description, currentMeds, language } = req.body || {};
  if (base64 === undefined && !(description || "").trim()) {
    return res.status(400).json({ error: "Request must include a photo or a description." });
  }

  const lang = language || "English";
  const system = IDENTIFY_SYSTEM.replace("{{LANGUAGE}}", lang);
  const medsText = (currentMeds || "").trim()
    ? `The person currently takes these other medications: ${currentMeds}. Consider general, well-known interaction concerns with these, if any.`
    : "The person did not list any other current medications.";

  const parts = [];
  if (base64 !== undefined) {
    parts.push({ text: `Look closely at the shape, color, any imprint or markings, and packaging text visible in this photo, then give your best possible matches. ${medsText}` });
    parts.push({ inline_data: { mime_type: "image/jpeg", data: base64 } });
  } else {
    parts.push({ text: `No photo was provided. The person describes the tablet/capsule as: "${description.trim()}". Based only on this description, give your best possible matches. ${medsText}` });
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ parts }],
        generationConfig: {
          response_mime_type: "application/json",
          maxOutputTokens: 700,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", response.status, errText);
      const hint = response.status === 404
        ? ` Model "${MODEL}" isn't available for this API key. Check https://ai.google.dev/gemini-api/docs/models and set GEMINI_MODEL in .env.`
        : "";
      return res.status(502).json({ error: `Analysis request failed (${response.status}).${hint}` });
    }

    const data = await response.json();
    const raw = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    const cleaned = raw.replace(/```json|```/g, "").trim();

    let parsed;
    try { parsed = JSON.parse(cleaned); } catch { parsed = null; }

    if (!parsed) {
      return res.json({
        possible_matches: [],
        visual_notes: raw || "Could not read a clear answer from the photo.",
        interaction_flags: [],
        confidence: "low",
        advice: "Please try a clearer, closer photo in good light, and always confirm any unidentified pill with a pharmacist before taking it.",
      });
    }

    return res.json({
      possible_matches: Array.isArray(parsed.possible_matches)
        ? parsed.possible_matches.map((m) => ({
            name: m.name || "Unknown",
            reason: m.reason || "",
            common_use: m.common_use || "General use not specified — ask your pharmacist.",
            likelihood: m.likelihood || "low",
          }))
        : [],
      visual_notes: parsed.visual_notes || "",
      interaction_flags: Array.isArray(parsed.interaction_flags) ? parsed.interaction_flags : [],
      confidence: parsed.confidence || "low",
      advice: parsed.advice || "Confirm with a pharmacist or doctor before taking any action.",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Unexpected server error while analyzing the photo." });
  }
});

const CHAT_SYSTEM = `You are the Veridose safety assistant. You help with two things:
1. General questions about medications: what a medicine class is generally used for, general storage advice, general interaction categories, and how to safely dispose of old medication.
2. General symptom guidance (e.g. fever, cough, mild aches, cold symptoms): standard, well-known supportive self-care, and clear guidance on when the person should see a doctor or seek urgent/emergency care.

CRITICAL SAFETY RULES — never break these:
- NEVER give a specific dosage, schedule, or administration instruction for any medication.
- NEVER name a specific medicine to take for a symptom, and NEVER tell someone to start, stop, skip, or change a medication. If asked "what should I take", answer with general non-medication self-care and tell them to ask a pharmacist or doctor for anything medicine-specific.
- NEVER diagnose. Describe general, well-known patterns only (e.g. "a fever in that range is usually mild and self-limiting"), never confirm what the person has.
- For fever specifically: general self-care (rest, fluids, light clothing, monitoring temperature) is fine to mention without naming medicines. Clearly flag when it needs prompt medical attention — very high fever (roughly 103°F/39.4°C or above in adults), fever lasting more than 2-3 days, or fever in an infant, elderly person, pregnant person, or someone with a chronic condition.
- If anything described sounds potentially urgent — difficulty breathing, chest pain, confusion, stiff neck, seizures, signs of severe dehydration, very high fever, or symptoms in a very young infant — say clearly and without hedging that they should seek emergency care or go to a hospital now.
- For anything specific to the person's own situation beyond general guidance (their exact dose, their exact combination of drugs, whether their particular case is serious), tell them clearly to speak to a doctor or pharmacist rather than answering directly.
- If asked about anything unrelated to medication or general health safety, politely decline and steer back to the app's purpose.

Keep answers SHORT — 2-5 sentences max, plain-language, no long lists. Use a light touch of relevant emojis where natural (e.g. 🌡️ for fever, 💊 for medication, ⚠️ for a warning, ✅ for reassurance) to keep the tone warm and easy to scan — don't overdo it, one or two per reply is enough. Reply in the same language the user writes in.`;

app.post("/api/chat", async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: "Server is missing GEMINI_API_KEY. Add it to your .env file." });
  }

  const { message, history } = req.body || {};
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Request must include a message." });
  }

  const safeHistory = Array.isArray(history) ? history.slice(-12) : [];
  const contents = [
    ...safeHistory
      .filter((h) => h && typeof h.text === "string" && (h.role === "user" || h.role === "model"))
      .map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: "user", parts: [{ text: message }] },
  ];

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent?key=${API_KEY}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: CHAT_SYSTEM }] },
        contents,
        generationConfig: { maxOutputTokens: 300, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini chat API error:", response.status, errText);
      return res.status(502).json({ error: `Chat request failed (${response.status}). Try again in a moment.` });
    }

    const data = await response.json();
    const reply = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim();
    return res.json({ reply: reply || "Sorry, I couldn't come up with an answer. Try rephrasing your question." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Unexpected server error while chatting." });
  }
});

app.use(express.static(path.join(__dirname, "public")));
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Veridose running on http://localhost:${PORT}`);
});
