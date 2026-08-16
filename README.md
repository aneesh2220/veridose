# Veridose

Photograph an unlabeled tablet or capsule — or simply describe it — and get
ranked possible matches, general purpose, and safety warnings, with every
close alternative considered. Same reliable setup as Crop Journal: plain
HTML/CSS/JS, no build step, free Google Gemini API.

**This is not a diagnosis tool.** It's designed to help someone — especially
in a household with several elderly family members and mixed pill boxes —
ask the right question of a pharmacist, not replace one. That framing is
baked into the AI prompts, the UI (a permanent disclaimer banner), and every
result card.

## Run it locally

```bash
npm install
cp .env.example .env
```
Paste your free Gemini API key (from aistudio.google.com/apikey) into `.env`,
then:
```bash
npm start
```
Open http://localhost:3001.

## Deploy on Render (free, to get a shareable link)

1. Push this folder to a new GitHub repo.
2. On Render: New + → Web Service → select the repo.
3. **Build Command**: `npm install`
4. **Start Command**: `npm start`
5. Add environment variable `GEMINI_API_KEY` with your key.
6. Create Web Service, wait for "Live," open the URL.

No build step — same reliable setup as Crop Journal.

## How it works

- **Hero landing** — two entry points: "Begin identification" (photo) or
  "Describe it instead" (plain-text description of shape/colour/imprint),
  matching the flow in your original design reference.
- `POST /api/identify` — takes a photo, a text description, or both, plus
  an optional list of current medications. Asks Gemini to suggest 2-4
  possible matches ranked by likelihood (never a single certain answer),
  plus general interaction flags and a mandatory pharmacist-confirmation
  note.
- `POST /api/chat` — a small chat assistant restricted to general
  medication-safety topics (storage, disposal, what a drug class is
  generally for). Instructed to never give a dosage or tell someone to
  start/stop a medication.
- History of past checks is saved in the browser's `localStorage`.

## For your presentation / demo

- **Why ranked possible matches, not one confident answer:** many pills
  look nearly identical, so a tool that states one name with false
  confidence is more dangerous than one that's honest about uncertainty.
- **Why two entry modes:** not everyone has the pill in hand when they
  think to check — someone might be describing what a relative took over
  the phone, for instance.
- **Why no dosage advice, ever:** the app is scoped narrowly on purpose —
  identification and general caution, not clinical guidance.
- **Real use case:** elderly households where pills get transferred out of
  original packaging into weekly organizers, and a family member needs to
  quickly check "is this the blood pressure one or the diabetes one?"

## Known limitations (good to mention proactively)

- Visual/description-based pill identification has real accuracy limits
  even for trained pharmacists — many pills share size, shape, and color
  across different drugs and manufacturers. The ranked-list,
  confidence-labeled approach is a mitigation, not a solve.
- No connection to a verified pharmaceutical database (e.g. a real
  NDC/RxNorm lookup) yet — matches come from the AI's general knowledge.
- Not intended for controlled substances or emergency situations. For a
  suspected overdose or poisoning, the right first step is always a poison
  control center or emergency services, not this app.
