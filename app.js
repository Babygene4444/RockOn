/* =======================================================
   RockOn v2 — app.js
   Uses gemini-3.8-flash · No service worker (avoids cache issues)
   ======================================================= */
'use strict';

// ── Config ─────────────────────────────────────────────
const GEMINI_MODEL = 'gemini-3.8-flash';

// ── State ──────────────────────────────────────────────
const state = {
    stream: null,
    capturedDataUrl: null,
    apiKey: localStorage.getItem('rockon_api_key') || ''
};

// ── Screens ────────────────────────────────────────────
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

// ── Toast ──────────────────────────────────────────────
let toastTimer;
function toast(msg, ms = 3200) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ── Camera ─────────────────────────────────────────────
async function startCamera() {
    if (state.stream) state.stream.getTracks().forEach(t => t.stop());
    try {
        state.stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false
        });
        const v = document.getElementById('video-feed');
        v.srcObject = state.stream;
        await v.play();
        showScreen('scanner-screen');
    } catch (e) {
        if (e.name === 'NotAllowedError') {
            toast('📷 Camera permission denied — allow access in iPhone Settings');
        } else {
            toast('📷 Camera unavailable: ' + e.message);
        }
    }
}

function stopCamera() {
    if (state.stream) { state.stream.getTracks().forEach(t => t.stop()); state.stream = null; }
}

// ── Capture ────────────────────────────────────────────
function capturePhoto() {
    const v = document.getElementById('video-feed');
    const c = document.createElement('canvas');
    c.width = v.videoWidth || 1280; c.height = v.videoHeight || 720;
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    state.capturedDataUrl = c.toDataURL('image/jpeg', 0.9);
    return state.capturedDataUrl;
}

// ── Gemini API ─────────────────────────────────────────
async function identifyRock(dataUrl) {
    const key = state.apiKey.trim();
    if (!key) throw new Error('NO_KEY');

    const base64 = dataUrl.split(',')[1];

    const prompt = `You are a professional geologist and mineralogist. Analyse this image carefully.

Identify the rock, stone, or mineral shown, then respond ONLY with a valid JSON object in exactly this structure:

{
  "name": "Common name",
  "scientific_name": "Formal geological/mineralogical name",
  "type": "Igneous | Sedimentary | Metamorphic | Mineral | Gemstone | Other",
  "confidence": 82,
  "description": "2–3 sentence description of what this rock is and how it forms.",
  "hardness": "Mohs scale value or range",
  "color_luster": "Typical colour and luster description",
  "common_uses": "Common uses of this rock or mineral",
  "found_in": "Typical geographic regions or geological environments",
  "fun_facts": [
    "Interesting fact 1",
    "Interesting fact 2",
    "Interesting fact 3"
  ],
  "not_a_rock": false
}

If the image does NOT show a rock, stone, or mineral, set "not_a_rock": true and put a short explanation in "name".

Respond with ONLY the raw JSON — no markdown fences, no extra text.`;

    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { inline_data: { mime_type: 'image/jpeg', data: base64 } },
                        { text: prompt }
                    ]
                }],
                generationConfig: { temperature: 0.2, topP: 0.8, maxOutputTokens: 1024 }
            })
        }
    );

    if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message || `API error ${res.status}`);
    }

    const data = await res.json();
    const raw = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '')
        .replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    try { return JSON.parse(raw); }
    catch { throw new Error('Could not read AI response — please try again.'); }
}

// ── Render results ─────────────────────────────────────
function h(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const typeEmoji = { Igneous: '🌋', Sedimentary: '🏜️', Metamorphic: '♻️', Mineral: '💎', Gemstone: '💠', Other: '🪨' };

function renderResults(rock, photo) {
    document.getElementById('result-photo').src = photo;
    const body = document.getElementById('results-body');

    if (rock.not_a_rock) {
        body.innerHTML = `
      <div class="err-card">
        <div class="err-icon">🪨</div>
        <p>${h(rock.name || 'No rock detected.')}</p>
        <p style="margin-top:8px;color:var(--muted);font-size:.78rem;">Point the camera directly at a rock or stone and try again.</p>
      </div>`;
        return;
    }

    const conf = Math.min(100, Math.max(0, rock.confidence || 75));
    const facts = (rock.fun_facts || []).map(f => `<div class="fact-item">${h(f)}</div>`).join('');

    body.innerHTML = `
    <div class="rock-hero">
      <div class="label-tag">Identified Rock / Mineral</div>
      <div class="rock-name">${h(rock.name || 'Unknown')}</div>
      ${rock.scientific_name ? `<div class="sci-name">${h(rock.scientific_name)}</div>` : ''}
      <span class="type-badge">${typeEmoji[rock.type] || '🪨'} ${h(rock.type || 'Unknown')}</span>
      <div class="conf-wrap">
        <div class="conf-bg"><div class="conf-fill" id="cf" style="width:0%"></div></div>
        <span class="conf-pct">${conf}% match</span>
      </div>
    </div>

    <div class="info-card">
      <div class="info-label">📖 Description</div>
      <div class="info-text">${h(rock.description || '—')}</div>
    </div>

    <div class="stats-grid">
      <div class="stat-card"><div class="stat-icon">💎</div><div class="stat-lbl">Hardness</div><div class="stat-val">${h(rock.hardness || '—')}</div></div>
      <div class="stat-card"><div class="stat-icon">✨</div><div class="stat-lbl">Color / Luster</div><div class="stat-val" style="font-size:.78rem">${h(rock.color_luster || '—')}</div></div>
      <div class="stat-card"><div class="stat-icon">🏔️</div><div class="stat-lbl">Found In</div><div class="stat-val" style="font-size:.76rem">${h(rock.found_in || '—')}</div></div>
      <div class="stat-card"><div class="stat-icon">🔧</div><div class="stat-lbl">Common Uses</div><div class="stat-val" style="font-size:.76rem">${h(rock.common_uses || '—')}</div></div>
    </div>

    ${facts ? `<div class="info-card"><div class="info-label">⚡ Fun Facts</div><div style="display:flex;flex-direction:column;gap:9px;margin-top:4px">${facts}</div></div>` : ''}
  `;

    requestAnimationFrame(() => setTimeout(() => {
        const cf = document.getElementById('cf');
        if (cf) cf.style.width = conf + '%';
    }, 60));
}

// ── Event wiring ───────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Pre-fill API key
    const keyInput = document.getElementById('api-key-input');
    if (state.apiKey) keyInput.value = state.apiKey;

    // Welcome → Settings
    document.getElementById('btn-welcome-settings').addEventListener('click', () => showScreen('settings-screen'));

    // Welcome → Scan
    document.getElementById('btn-start-scan').addEventListener('click', async () => {
        if (!state.apiKey.trim()) {
            toast('⚙️ Add your Gemini API key in Settings first');
            showScreen('settings-screen');
            return;
        }
        await startCamera();
    });

    // Scanner back
    document.getElementById('btn-scanner-back').addEventListener('click', () => { stopCamera(); showScreen('welcome-screen'); });

    // Scanner settings
    document.getElementById('btn-scanner-settings').addEventListener('click', () => { stopCamera(); showScreen('settings-screen'); });

    // Capture
    document.getElementById('btn-capture').addEventListener('click', async () => {
        const photo = capturePhoto();
        stopCamera();
        document.getElementById('loading-preview').src = photo;
        document.getElementById('result-photo').src = photo;
        showScreen('loading-screen');
        try {
            const rock = await identifyRock(photo);
            renderResults(rock, photo);
            showScreen('results-screen');
        } catch (e) {
            if (e.message === 'NO_KEY') {
                toast('⚙️ Add your Gemini API key in Settings');
                showScreen('settings-screen');
            } else {
                document.getElementById('results-body').innerHTML = `
          <div class="err-card">
            <div class="err-icon">⚠️</div>
            <p>${h(e.message)}</p>
          </div>`;
                showScreen('results-screen');
            }
        }
    });

    // Results back
    document.getElementById('btn-results-back').addEventListener('click', () => showScreen('welcome-screen'));

    // Rescan
    document.getElementById('btn-rescan').addEventListener('click', async () => await startCamera());

    // Settings back
    document.getElementById('btn-settings-back').addEventListener('click', () => showScreen('welcome-screen'));

    // Save API key
    document.getElementById('btn-save-key').addEventListener('click', () => {
        const val = keyInput.value.trim();
        const note = document.getElementById('save-note');
        if (!val) { note.textContent = '⚠️ Please enter a key'; note.className = 'save-note err'; return; }
        localStorage.setItem('rockon_api_key', val);
        state.apiKey = val;
        note.textContent = '✓ Saved!'; note.className = 'save-note ok';
        setTimeout(() => { note.textContent = ''; note.className = 'save-note'; }, 2500);
    });

    showScreen('welcome-screen');
});
