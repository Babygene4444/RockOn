/* =======================================================
   RockOn — app.js
   Camera management + Gemini Vision API rock identification
   ======================================================= */

'use strict';

// ── State ──────────────────────────────────────────────
const state = {
    currentScreen: 'welcome',
    stream: null,
    capturedDataUrl: null,
    apiKey: localStorage.getItem('rockon_api_key') || ''
};

// ── Gemini model to use ────────────────────────────────
const GEMINI_MODEL = 'gemini-2.5-flash';

// ── Screen navigation ──────────────────────────────────
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    state.currentScreen = id;
}

// ── Toast ──────────────────────────────────────────────
let toastTimer;
function showToast(msg, duration = 3000) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), duration);
}

// ── Camera ─────────────────────────────────────────────
async function startCamera() {
    try {
        // Stop any existing stream
        if (state.stream) {
            state.stream.getTracks().forEach(t => t.stop());
        }
        const constraints = {
            video: {
                facingMode: { ideal: 'environment' }, // rear camera on iPhone
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            audio: false
        };
        state.stream = await navigator.mediaDevices.getUserMedia(constraints);
        const video = document.getElementById('video-feed');
        video.srcObject = state.stream;
        await video.play();
        showScreen('scanner-screen');
    } catch (err) {
        console.error('Camera error:', err);
        if (err.name === 'NotAllowedError') {
            showToast('📷 Camera permission denied — please allow access in Settings');
        } else {
            showToast('📷 Could not access camera: ' + err.message);
        }
    }
}

function stopCamera() {
    if (state.stream) {
        state.stream.getTracks().forEach(t => t.stop());
        state.stream = null;
    }
}

// ── Capture photo ──────────────────────────────────────
function capturePhoto() {
    const video = document.getElementById('video-feed');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // JPEG at 90% quality keeps file size reasonable for the API
    state.capturedDataUrl = canvas.toDataURL('image/jpeg', 0.90);
    return state.capturedDataUrl;
}

// ── Gemini Vision API call ─────────────────────────────
async function identifyRock(base64Data) {
    const key = state.apiKey.trim();
    if (!key) {
        throw new Error('NO_KEY');
    }

    // Strip the data URL prefix to get pure base64
    const base64 = base64Data.split(',')[1];

    const prompt = `You are a professional geologist and mineralogist. Examine this image carefully.

Identify the rock or mineral specimen shown and respond ONLY with a valid JSON object using exactly this structure:

{
  "name": "Common name of the rock/stone/mineral",
  "scientific_name": "Scientific or formal geological name",
  "type": "Igneous | Sedimentary | Metamorphic | Mineral | Gemstone | Other",
  "confidence": 85,
  "description": "2-3 sentence description of what this rock is and how it forms.",
  "hardness": "Mohs hardness value or range, e.g. 6-7",
  "color_luster": "Brief description of its typical color and luster",
  "common_uses": "How this rock or mineral is commonly used",
  "fun_facts": [
    "Interesting fact one about this rock",
    "Interesting fact two about this rock",
    "Interesting fact three about this rock"
  ],
  "found_in": "Geographic regions or environments where this rock is typically found",
  "not_a_rock": false
}

If the image does NOT clearly show a rock, stone, mineral, or geological specimen, set "not_a_rock" to true and fill "name" with a brief explanation.

Respond with ONLY the JSON. No markdown, no code fences, no extra text.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

    const body = {
        contents: [{
            parts: [
                {
                    inline_data: {
                        mime_type: 'image/jpeg',
                        data: base64
                    }
                },
                { text: prompt }
            ]
        }],
        generationConfig: {
            temperature: 0.2,
            topP: 0.8,
            maxOutputTokens: 1024
        }
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        const msg = errJson?.error?.message || `HTTP ${response.status}`;
        throw new Error(msg);
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Extract JSON — strip any accidental markdown fences
    const cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    try {
        return JSON.parse(cleaned);
    } catch {
        throw new Error('Could not parse AI response. Please try again.');
    }
}

// ── Render results ─────────────────────────────────────
function renderResults(rock, photoUrl) {
    // Photo
    const photoEl = document.getElementById('result-photo');
    photoEl.src = photoUrl;

    if (rock.not_a_rock) {
        document.getElementById('results-body').innerHTML = `
      <div class="error-card">
        <div class="error-icon">🪨</div>
        <p>${escHtml(rock.name || 'No rock detected in the image.')}</p>
        <p style="margin-top:8px; color: var(--text-muted); font-size:0.8rem;">Try pointing the camera directly at a rock or stone surface.</p>
      </div>`;
        return;
    }

    const confidence = Math.min(100, Math.max(0, rock.confidence || 75));
    const factsHtml = (rock.fun_facts || []).map(f =>
        `<div class="fun-fact-item">${escHtml(f)}</div>`
    ).join('');

    document.getElementById('results-body').innerHTML = `
    <div class="rock-name-card">
      <div class="rock-name-label">Identified Rock / Mineral</div>
      <div class="rock-name-value">${escHtml(rock.name || 'Unknown')}</div>
      ${rock.scientific_name ? `<div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:10px;font-style:italic;">${escHtml(rock.scientific_name)}</div>` : ''}
      <span class="rock-type-badge">${typeEmoji(rock.type)} ${escHtml(rock.type || 'Unknown')}</span>
      <div class="confidence-bar-wrap">
        <div class="confidence-bar-bg">
          <div class="confidence-bar-fill" id="conf-fill" style="width:0%"></div>
        </div>
        <span class="confidence-label">${confidence}% match</span>
      </div>
    </div>

    <div class="info-card">
      <div class="info-card-label">📖 Description</div>
      <div class="info-card-text">${escHtml(rock.description || '—')}</div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon">💎</div>
        <div class="stat-label">Hardness</div>
        <div class="stat-value">${escHtml(rock.hardness || '—')}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">✨</div>
        <div class="stat-label">Color / Luster</div>
        <div class="stat-value" style="font-size:0.8rem">${escHtml(rock.color_luster || '—')}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🏔️</div>
        <div class="stat-label">Found In</div>
        <div class="stat-value" style="font-size:0.78rem">${escHtml(rock.found_in || '—')}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🔧</div>
        <div class="stat-label">Common Uses</div>
        <div class="stat-value" style="font-size:0.78rem">${escHtml(rock.common_uses || '—')}</div>
      </div>
    </div>

    ${factsHtml ? `
    <div class="info-card">
      <div class="info-card-label">⚡ Fun Facts</div>
      <div class="fun-facts-list">${factsHtml}</div>
    </div>` : ''}
  `;

    // Animate confidence bar after layout
    requestAnimationFrame(() => {
        setTimeout(() => {
            const fill = document.getElementById('conf-fill');
            if (fill) fill.style.width = confidence + '%';
        }, 80);
    });
}

function typeEmoji(type) {
    const map = {
        'Igneous': '🌋', 'Sedimentary': '🏜️', 'Metamorphic': '♻️',
        'Mineral': '💎', 'Gemstone': '💠', 'Other': '🪨'
    };
    return map[type] || '🪨';
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── Event wiring ───────────────────────────────────────
function initEvents() {
    // Welcome → Settings (gear icon)
    document.getElementById('btn-settings-from-welcome').addEventListener('click', () => {
        showScreen('settings-screen');
    });

    // Welcome → scan
    document.getElementById('btn-start-scan').addEventListener('click', async () => {
        if (!state.apiKey.trim()) {
            showToast('⚙️ Please add your Gemini API key in Settings first');
            showScreen('settings-screen');
            return;
        }
        await startCamera();
    });

    // Scanner back button
    document.getElementById('btn-scanner-back').addEventListener('click', () => {
        stopCamera();
        showScreen('welcome-screen');
    });

    // Scanner settings
    document.getElementById('btn-scanner-settings').addEventListener('click', () => {
        stopCamera();
        showScreen('settings-screen');
    });

    // Capture button
    document.getElementById('btn-capture').addEventListener('click', async () => {
        const photoUrl = capturePhoto();
        stopCamera();

        // Show loading
        const loadingPreview = document.getElementById('loading-preview');
        loadingPreview.src = photoUrl;
        showScreen('loading-screen');

        // Set result photo eagerly
        document.getElementById('result-photo').src = photoUrl;

        try {
            const rock = await identifyRock(photoUrl);
            renderResults(rock, photoUrl);
            showScreen('results-screen');
        } catch (err) {
            if (err.message === 'NO_KEY') {
                showToast('⚙️ Please add your Gemini API key in Settings');
                showScreen('settings-screen');
            } else {
                // Show error in results screen
                document.getElementById('results-body').innerHTML = `
          <div class="error-card">
            <div class="error-icon">⚠️</div>
            <p>${escHtml(err.message)}</p>
          </div>`;
                showScreen('results-screen');
            }
        }
    });

    // Results → rescan
    document.getElementById('btn-rescan').addEventListener('click', async () => {
        await startCamera();
    });

    // Results → back to welcome
    document.getElementById('btn-results-back').addEventListener('click', () => {
        showScreen('welcome-screen');
    });

    // Settings back
    document.getElementById('btn-settings-back').addEventListener('click', () => {
        showScreen('welcome-screen');
    });

    // Save API key
    document.getElementById('btn-save-key').addEventListener('click', () => {
        const input = document.getElementById('api-key-input').value.trim();
        const notice = document.getElementById('save-notice');
        if (!input) {
            notice.textContent = '⚠️ Please enter an API key';
            notice.className = 'save-notice error';
            return;
        }
        localStorage.setItem('rockon_api_key', input);
        state.apiKey = input;
        notice.textContent = '✓ API key saved successfully!';
        notice.className = 'save-notice success';
        setTimeout(() => { notice.textContent = ''; }, 3000);
    });

    // Pre-fill API key input from storage
    const savedKey = localStorage.getItem('rockon_api_key') || '';
    if (savedKey) {
        document.getElementById('api-key-input').value = savedKey;
    }
}

// ── Service Worker registration ────────────────────────
function registerSW() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(() => {
            // SW optional — app works without it
        });
    }
}

// ── Boot ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initEvents();
    registerSW();
    showScreen('welcome-screen');
});
