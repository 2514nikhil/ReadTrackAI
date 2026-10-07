# ReadTrack

ReadTrack measures how long a student actually reads a PDF or DOCX document.
While the document is open, the webcam runs **entirely in the browser** — no video
or images ever leave the device. The server only receives reading-time numbers
(active seconds, idle seconds, page number) and one face embedding per student.

---

## Features

- **PDF & DOCX viewer** — in-browser rendering with page tracking
- **Face detection** — MediaPipe Face Landmarker (WASM, runs in the browser)
- **Head-pose estimation** — yaw / pitch from the facial transformation matrix
- **Liveness check** — requires blinks or head movement every 60 seconds
- **Identity verification** — ONNX MobileFaceNet embedding compared against enrolled face
- **Full state machine** — grace period (8 s), idle auto-end (5 min), interaction timeout (3 min)
- **Teacher dashboard** — per-document table + Recharts bar chart
- **Role-based auth** — Supabase email/password, roles: `student` / `teacher`

---

## Tech Stack

| Layer | Library |
|---|---|
| Framework | Next.js 14+ (App Router), TypeScript |
| Styling | Tailwind CSS |
| Database / Auth | Supabase (Postgres + Auth + Storage) |
| Face detection | `@mediapipe/tasks-vision` (Face Landmarker) |
| Face identity | `onnxruntime-web` + MobileFaceNet ONNX |
| PDF viewer | `pdfjs-dist` |
| DOCX viewer | `docx-preview` |
| Charts | `recharts` |

---

## Prerequisites

- Node.js 18+
- A free [Supabase](https://supabase.com) project
- Internet access (MediaPipe WASM loads from `cdn.jsdelivr.net` on first use)

---

## Setup

### 1. Clone & install

```bash
git clone <your-repo-url> readtrack
cd readtrack
npm install
```

### 2. Environment variables

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in the three values from your Supabase project
(**Settings → API**):

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### 3. Database migration

In the **Supabase SQL Editor**, paste and run the entire contents of:

```
supabase/migrations/001_initial.sql
```

This creates:
- Tables: `profiles`, `documents`, `assignments`, `reading_sessions`
- Row Level Security policies for all tables
- An `on_auth_user_created` trigger that auto-populates `profiles`
- The `documents` Storage bucket

### 4. Copy the PDF worker

```powershell
# Windows (PowerShell)
Copy-Item "node_modules/pdfjs-dist/build/pdf.worker.min.js" "public/pdf.worker.min.js"
```

```bash
# macOS / Linux
cp node_modules/pdfjs-dist/build/pdf.worker.min.js public/pdf.worker.min.js
```

### 5. Copy ONNX Runtime WASM files

```powershell
# Windows (PowerShell)
Copy-Item "node_modules/onnxruntime-web/dist/*.wasm" "public/"
```

```bash
# macOS / Linux
cp node_modules/onnxruntime-web/dist/*.wasm public/
```

### 6. Download AI model files

#### Face Landmarker (MediaPipe) — required for detection

```powershell
New-Item -ItemType Directory -Force -Path "public/models"
Invoke-WebRequest `
  -Uri "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" `
  -OutFile "public/models/face_landmarker.task"
```

```bash
mkdir -p public/models
curl -L \
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" \
  -o public/models/face_landmarker.task
```

#### MobileFaceNet ONNX — required for identity verification

Download a MobileFaceNet ONNX model and save it as **`public/models/mobilefacenet.onnx`**.

Sources:
- [InsightFace buffalo_sc](https://github.com/deepinsight/insightface) — `w600k_mbf.onnx` (rename it)
- [ONNX Model Zoo](https://github.com/onnx/models) — search "mobilefacenet"

Expected model spec:
- Input: `float32[1, 3, 112, 112]` — RGB, normalized with mean=0.5, std=0.5
- Output: `float32[1, 128]` — embedding vector

If this file is missing, the app will display a clear error message with the
exact path and download instructions. Face detection and head-pose tracking
still work without it — only identity verification is disabled.

### 7. Install remaining packages (if not already present)

```bash
npm install pdfjs-dist@3.11.174 docx-preview @mediapipe/tasks-vision onnxruntime-web recharts
```

### 8. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Usage

### As a Teacher

1. Sign up at `/signup` — choose **Teacher**
2. Log in → redirected to `/teacher`
3. Click **Upload Document** → upload a PDF or DOCX and assign it to students
4. Click **View Report** on any document to see per-student reading time, a bar chart, and session history

### As a Student

1. Sign up at `/signup` — choose **Student**
2. Log in → redirected to `/student`
3. *(Recommended)* Go to **Enroll Face** → check the consent box, allow camera, click **Start Enrollment**
4. Click **Read** on an assigned document
5. Allow camera access when prompted
6. The status badge shows **Tracking OK** (green) when all conditions are met
7. Click **Stop Reading** when done

---

## Tracking Conditions

Active reading time is counted only while ALL of the following are true
simultaneously:

| Condition | Detail |
|---|---|
| Tab focused | `document.visibilityState === 'visible'` AND `document.hasFocus()` |
| Face detected | Exactly 1 face in the webcam frame |
| Looking at screen | Head yaw ∈ [−25°, +25°] AND pitch ∈ [−25°, +20°] |
| Eyes open | Both eyes not closed for more than 2 consecutive seconds |
| Identity match | Cosine similarity ≥ 0.55 vs enrolled embedding (if enrolled) |
| Liveness | At least one blink or >2° head movement in the last 60 seconds |
| Interaction | At least one scroll, key press, or page change in the last 3 minutes |

### State machine

```
frameActive = true  →  ACTIVE (activeSeconds++)
frameActive = false →  8 s GRACE PERIOD (still counts as active)
                    →  after grace: IDLE (idleSeconds++)
                    →  IDLE for 5 min: session auto-ends
```

---

## Tuning

All thresholds live in one file: [`src/lib/attention/config.ts`](src/lib/attention/config.ts)

| Constant | Default | What it controls |
|---|---|---|
| `FRAME_INTERVAL_MS` | 200 | Detection loop rate (200 ms = 5 fps) |
| `YAW_THRESHOLD` | 25° | Max horizontal head turn |
| `PITCH_MIN` / `PITCH_MAX` | −25° / +20° | Vertical head tilt range |
| `BLINK_THRESHOLD` | 0.6 | Blendshape score for "eye closed" |
| `BLINK_CLOSED_MAX_SECONDS` | 2 s | Eyes can stay closed this long |
| `IDENTITY_SIMILARITY_THRESHOLD` | 0.55 | Cosine similarity for identity match |
| `EMBEDDING_COMPUTE_INTERVAL_MS` | 5 000 ms | How often to re-run the ONNX model |
| `EMBEDDING_VALID_FOR_MS` | 10 000 ms | How long to trust the last embedding |
| `GRACE_PERIOD_SECONDS` | 8 s | Grace before going IDLE |
| `IDLE_AUTO_END_MINUTES` | 5 min | IDLE duration before session auto-ends |
| `INTERACTION_TIMEOUT_SECONDS` | 180 s | No-interaction timeout |
| `LIVENESS_CHECK_SECONDS` | 60 s | Window for blink / head-movement check |
| `LIVENESS_HEAD_MOVEMENT_DEGREES` | 2° | Minimum movement for liveness |
| `SESSION_SAVE_INTERVAL_MS` | 15 000 ms | How often to save to Supabase |

---

## Project Structure

```
readtrack/
├── public/
│   ├── models/
│   │   ├── face_landmarker.task   ← download (see step 6)
│   │   └── mobilefacenet.onnx     ← download (see step 6)
│   ├── pdf.worker.min.js          ← copy from node_modules (step 4)
│   └── *.wasm                     ← copy from onnxruntime-web (step 5)
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   └── signup/page.tsx
│   │   ├── api/
│   │   │   ├── profile/route.ts   ← GET/PATCH/DELETE face embedding
│   │   │   ├── session/route.ts   ← POST create/update reading session
│   │   │   └── upload/route.ts    ← POST upload document + assign
│   │   ├── student/
│   │   │   ├── enroll/page.tsx    ← face enrollment
│   │   │   ├── read/[documentId]/ ← document viewer + tracking
│   │   │   └── page.tsx           ← assigned document list
│   │   └── teacher/
│   │       ├── documents/[id]/    ← per-document report + charts
│   │       ├── upload/page.tsx    ← upload + assign
│   │       └── page.tsx           ← teacher dashboard
│   ├── lib/
│   │   ├── attention/
│   │   │   ├── config.ts          ← all tunable constants
│   │   │   ├── engine.ts          ← AttentionEngine (detection loop + state machine)
│   │   │   └── embedding.ts       ← EmbeddingEngine (ONNX face embedding)
│   │   ├── supabase/
│   │   │   ├── client.ts          ← browser Supabase client
│   │   │   ├── server.ts          ← server Supabase client (cookie-aware)
│   │   │   └── middleware.ts      ← updateSession helper
│   │   └── utils/
│   │       └── time.ts            ← formatSeconds()
│   └── middleware.ts              ← auth + role guards
└── supabase/
    └── migrations/
        └── 001_initial.sql        ← run this in Supabase SQL Editor
```

---

## Privacy & Security

- **Video never leaves the browser.** All AI inference (MediaPipe, ONNX) runs client-side.
- The server only receives: `active_seconds`, `idle_seconds`, `last_page`, and (once, at enrollment) a 128-float numeric embedding.
- Face enrollment requires explicit consent from the student before the camera starts.
- Students can delete their face embedding at any time from `/student/enroll`.
- Row Level Security is enabled on all Supabase tables:
  - Students can only read/write their own sessions and assigned documents.
  - Teachers can only read sessions for their own documents.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| "Face landmarker model not found" | Download `face_landmarker.task` to `public/models/` (step 6) |
| "Face recognition model not found" | Download `mobilefacenet.onnx` to `public/models/` (step 6) |
| PDF does not render | Copy `pdf.worker.min.js` to `public/` (step 4); check browser console |
| ONNX fails to initialise | Copy `*.wasm` files to `public/` (step 5) |
| Camera permission denied | Allow camera in browser settings and reload |
| "Unauthorized" on API calls | Make sure you are logged in and cookies are present |
| Wrong role redirect | Check `profiles` table in Supabase — `role` column must be `student` or `teacher` |
| MediaPipe WASM won't load | Requires internet access (loads from `cdn.jsdelivr.net`) |
| Identity always "Different person" | Lower `IDENTITY_SIMILARITY_THRESHOLD` in `config.ts` (try 0.40) |
| Tracking too sensitive | Increase `YAW_THRESHOLD` or `GRACE_PERIOD_SECONDS` in `config.ts` |

---

## Scripts

```bash
npm run dev      # Start development server (http://localhost:3000)
npm run build    # Production build
npm run start    # Start production server
```

---

## License

MIT
