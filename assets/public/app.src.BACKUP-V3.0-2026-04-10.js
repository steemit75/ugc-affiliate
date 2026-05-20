// MoonRay APK v3.0 — Error reporting + Native upload bridge

// ==================== CONFIG ==
// ⚡ MOONRAY APK: Direct API calls via Capacitor Native HTTP
const API_BASE = 'https://api.freepik.com/v1/ai';

// 🔗 Google Apps Script URL — PASTE YOUR DEPLOYMENT URL HERE
const AUTH_URL = 'https://script.google.com/macros/s/AKfycbyMiTKl6bdRfrpf5UOBAsqyNke18JabWkXWZh_8cA56jZIDxImbI86dfjvpXGOwoATkxg/exec';

// 📦 Storage Server (opsional — kosongkan jika tidak dipakai)
const STORAGE_URL = '';

// ==================== CAPACITOR NATIVE HTTP ====================
// Bypass CapacitorHttp patched-fetch header bugs by calling native HTTP directly
function _isCapacitorNative() {
    return typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform && Capacitor.isNativePlatform();
}

// Open URL in system browser (Chrome) instead of WebView — avoids 403 from Freepik
function openExternal(url) { if (_isCapacitorNative() && Capacitor.Plugins && Capacitor.Plugins.Browser) { Capacitor.Plugins.Browser.open({ url: url }); } else { window.open(url, '_blank'); } }

async function freepikRequest(url, method, apiKey, body) {
    console.log('[Moonray] freepikRequest:', method, url, '| Native:', _isCapacitorNative());

    if (_isCapacitorNative() && Capacitor.Plugins && Capacitor.Plugins.CapacitorHttp) {
        // === NATIVE HTTP: headers guaranteed to be sent ===
        const opts = {
            url: url,
            method: method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                'x-freepik-api-key': apiKey,
                'Accept': 'application/json'
            }
        };
        if (body && method !== 'GET') opts.data = body; // Capacitor uses 'data' not 'body'

        try {
            const res = await Capacitor.Plugins.CapacitorHttp.request(opts);
            console.log('[Moonray] Native response:', res.status);
            // Safely parse JSON — handle plain text errors like "stream timeout"
            let parsedData;
            if (typeof res.data === 'string') {
                try { parsedData = JSON.parse(res.data); }
                catch (parseErr) {
                    console.error('[Moonray] Non-JSON response:', res.data);
                    const txt = (res.data || '').toLowerCase();
                    if (txt.includes('timeout') || txt.includes('upstream')) throw new Error('Server sedang sibuk (Timeout). Silakan coba lagi.');
                    if (txt.includes('bad gateway') || txt.includes('502')) throw new Error('Server tidak tersedia (502). Coba lagi nanti.');
                    throw new Error('Server error: ' + res.data.substring(0, 100));
                }
            } else { parsedData = res.data; }
            return {
                ok: res.status >= 200 && res.status < 300,
                status: res.status,
                data: parsedData
            };
        } catch (err) {
            console.error('[Moonray] Native HTTP error:', err);
            throw err;
        }
    } else {
        // === FALLBACK: regular fetch (for browser testing) ===
        const opts = {
            method: method || 'GET',
            headers: { 'Content-Type': 'application/json', 'x-freepik-api-key': apiKey }
        };
        if (body && method !== 'GET') opts.body = JSON.stringify(body);

        const res = await fetch(url, opts);
        // Safely parse JSON — handle plain text errors
        let data;
        const rawText = await res.text();
        try { data = JSON.parse(rawText); }
        catch (parseErr) {
            console.error('[Moonray] Non-JSON fetch response:', rawText);
            const txt = (rawText || '').toLowerCase();
            if (txt.includes('timeout') || txt.includes('upstream')) throw new Error('Server sedang sibuk (Timeout). Silakan coba lagi.');
            if (txt.includes('bad gateway') || txt.includes('502')) throw new Error('Server tidak tersedia (502). Coba lagi nanti.');
            throw new Error('Server error: ' + rawText.substring(0, 100));
        }
        console.log('[Moonray] Fetch response:', res.status);
        return { ok: res.ok, status: res.status, data };
    }
}

// Device ID — unik per install
function getDeviceId() {
    let id = localStorage.getItem('mr_device_id');
    if (!id) { id = 'dev_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9); localStorage.setItem('mr_device_id', id); }
    return id;
}

// ==================== RATE LIMITER ====================
const RATE_LIMIT = {
    maxRequests: 20, windowMs: 60000, cooldownMs: 3000,
    maxConcurrent: 10, timestamps: [], cooldownUntil: 0
};



function canGenerate() {
    const now = Date.now();
    if (now < RATE_LIMIT.cooldownUntil) { toast(`⏳ Cooldown — tunggu ${Math.ceil((RATE_LIMIT.cooldownUntil - now) / 1000)}s`, 'error'); return false; }
    if (state.activeTasks.length >= RATE_LIMIT.maxConcurrent) { toast(`⚠️ Max ${RATE_LIMIT.maxConcurrent} task bersamaan`, 'error'); return false; }
    RATE_LIMIT.timestamps = RATE_LIMIT.timestamps.filter(t => now - t < RATE_LIMIT.windowMs);
    if (RATE_LIMIT.timestamps.length >= RATE_LIMIT.maxRequests) { toast(`⚠️ Rate limit. Tunggu ${Math.ceil((RATE_LIMIT.windowMs - (now - RATE_LIMIT.timestamps[0])) / 1000)}s`, 'error'); return false; }
    return true;
}
function recordRequest() { RATE_LIMIT.timestamps.push(Date.now()); RATE_LIMIT.cooldownUntil = Date.now() + RATE_LIMIT.cooldownMs; startCooldownTimer(); }
function startCooldownTimer() {
    const btn = document.getElementById('generateBtn'), cdWrap = document.getElementById('cooldownWrap');
    if (!btn || !cdWrap) return;
    btn.disabled = true; cdWrap.style.display = 'block';
    const total = RATE_LIMIT.cooldownMs, startTime = Date.now();
    const interval = setInterval(() => {
        const remaining = Math.max(0, total - (Date.now() - startTime));
        const pct = ((total - remaining) / total) * 100;
        const fill = cdWrap.querySelector('.cooldown-fill'), text = cdWrap.querySelector('.cooldown-text');
        if (fill) fill.style.width = pct + '%';
        if (text) text.textContent = `⏳ Cooldown: ${Math.ceil(remaining / 1000)}s`;
        if (remaining <= 0) { clearInterval(interval); cdWrap.style.display = 'none'; if (state.activeTasks.length < RATE_LIMIT.maxConcurrent) btn.disabled = false; btn.innerHTML = '🚀 Generate ' + getOutputLabel() + (state.activeTasks.length > 0 ? ` (${state.activeTasks.length}/${RATE_LIMIT.maxConcurrent})` : ''); }
    }, 500);
}
function getOutputLabel() { const gen = GENERATORS[state.activeGenerator]; return !gen ? 'Video' : gen.outputType === 'image' ? 'Gambar' : gen.outputType === 'audio' ? 'Audio' : 'Video'; }

// ==================== GENERATORS ====================
const GENERATORS = {
    'motion-control-std': { id: 'motion-control-std', name: 'Motion Control Standard', icon: '🎭', category: 'motion', desc: 'Transfer gerakan dari video referensi ke gambar karakter (Standard)', endpoint: '/video/kling-v2-6-motion-control-std', taskEndpoint: '/image-to-video/kling-v2-6', inputs: ['image', 'video', 'prompt'], settings: { character_orientation: { type: 'select', label: 'Orientation', options: [{ value: 'video', label: 'Video' }, { value: 'image', label: 'Image' }], default: 'video' }, cfg_scale: { type: 'range', label: 'CFG Scale', min: 0, max: 1, step: 0.1, default: 0.5 } } },
    'motion-control-pro': { id: 'motion-control-pro', name: 'Motion Control Pro', icon: '🎭', category: 'motion', badge: 'PRO', desc: 'Transfer gerakan (Pro — kualitas tinggi)', endpoint: '/video/kling-v2-6-motion-control-pro', taskEndpoint: '/image-to-video/kling-v2-6', inputs: ['image', 'video', 'prompt'], settings: { character_orientation: { type: 'select', label: 'Orientation', options: [{ value: 'video', label: 'Video (max 30s)' }, { value: 'image', label: 'Image (max 10s)' }], default: 'video' }, cfg_scale: { type: 'range', label: 'CFG Scale', min: 0, max: 1, step: 0.1, default: 0.5 } } },
    'kling-v2-6-pro': { id: 'kling-v2-6-pro', name: 'Kling 2.6 Pro', icon: '🎬', category: 'i2v', badge: 'HOT', desc: 'Image-to-Video terbaru dari Kling', endpoint: '/image-to-video/kling-v2-6-pro', taskEndpoint: '/image-to-video/kling-v2-6', imageField: 'image', imageBase64: true, inputs: ['image', 'prompt'], settings: { duration: { type: 'select', label: 'Durasi', options: [{ value: '5', label: '5 detik' }, { value: '10', label: '10 detik' }], default: '5' }, aspect_ratio: { type: 'select', label: 'Aspect Ratio', options: [{ value: 'widescreen_16_9', label: '16:9' }, { value: 'social_story_9_16', label: '9:16' }, { value: 'square_1_1', label: '1:1' }], default: 'widescreen_16_9' } } },
    'kling-v3-pro': { id: 'kling-v3-pro', name: 'Kling V3 Pro', icon: '🎬', category: 'i2v', badge: 'V3', desc: 'Kling V3 kualitas tertinggi — 3-15 detik', endpoint: '/video/kling-v3-pro', taskEndpoint: '/video/kling-v3', imageField: 'start_image_url', inputs: ['image', 'prompt'], settings: { aspect_ratio: { type: 'select', label: 'Aspect Ratio', options: [{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: '1:1', label: '1:1' }], default: '16:9' }, duration: { type: 'select', label: 'Durasi', options: [{ value: '3', label: '3s' }, { value: '5', label: '5s' }, { value: '10', label: '10s' }, { value: '15', label: '15s' }], default: '5' }, cfg_scale: { type: 'range', label: 'CFG Scale', min: 0, max: 1, step: 0.1, default: 0.5 } } },
    'kling-v3-std': { id: 'kling-v3-std', name: 'Kling V3 Std', icon: '🎬', category: 'i2v', badge: 'V3', desc: 'Kling V3 cepat & terjangkau — 3-10 detik', endpoint: '/video/kling-v3-std', taskEndpoint: '/video/kling-v3', imageField: 'start_image_url', inputs: ['image', 'prompt'], settings: { aspect_ratio: { type: 'select', label: 'Aspect Ratio', options: [{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: '1:1', label: '1:1' }], default: '16:9' }, duration: { type: 'select', label: 'Durasi', options: [{ value: '3', label: '3s' }, { value: '5', label: '5s' }, { value: '10', label: '10s' }], default: '5' }, cfg_scale: { type: 'range', label: 'CFG Scale', min: 0, max: 1, step: 0.1, default: 0.5 } } },
    'kling-v3-omni-pro': { id: 'kling-v3-omni-pro', name: 'Kling V3 Omni Pro', icon: '🧠', category: 'i2v', badge: 'V3', desc: 'Kling V3 Omni — multi-modal, element control', endpoint: '/video/kling-v3-omni-pro', taskEndpoint: '/video/kling-v3-omni', imageField: 'image_url', inputs: ['image', 'prompt'], settings: { aspect_ratio: { type: 'select', label: 'Aspect Ratio', options: [{ value: 'auto', label: 'Auto' }, { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: '1:1', label: '1:1' }], default: '16:9' }, duration: { type: 'select', label: 'Durasi', options: [{ value: '3', label: '3s' }, { value: '5', label: '5s' }, { value: '10', label: '10s' }, { value: '15', label: '15s' }], default: '5' }, generate_audio: { type: 'select', boolean: true, label: 'Audio AI', options: [{ value: 'false', label: 'Tanpa Audio' }, { value: 'true', label: 'Dengan Audio' }], default: 'false' } } },
    'kling-v3-omni-std': { id: 'kling-v3-omni-std', name: 'Kling V3 Omni Std', icon: '🧠', category: 'i2v', badge: 'V3', desc: 'Kling V3 Omni Standard — cepat & terjangkau', endpoint: '/video/kling-v3-omni-std', taskEndpoint: '/video/kling-v3-omni', imageField: 'image_url', inputs: ['image', 'prompt'], settings: { aspect_ratio: { type: 'select', label: 'Aspect Ratio', options: [{ value: 'auto', label: 'Auto' }, { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: '1:1', label: '1:1' }], default: '16:9' }, duration: { type: 'select', label: 'Durasi', options: [{ value: '3', label: '3s' }, { value: '5', label: '5s' }, { value: '10', label: '10s' }], default: '5' }, generate_audio: { type: 'select', boolean: true, label: 'Audio AI', options: [{ value: 'false', label: 'Tanpa Audio' }, { value: 'true', label: 'Dengan Audio' }], default: 'false' } } },
    'kling-o1-pro': { id: 'kling-o1-pro', name: 'Kling O1 Pro', icon: '🧠', category: 'i2v', badge: 'NEW', desc: 'Enhanced reasoning untuk prompt kompleks', endpoint: '/image-to-video/kling-o1-pro', taskEndpoint: '/image-to-video/kling-o1', imageField: 'first_frame', inputs: ['image', 'prompt'], settings: { aspect_ratio: { type: 'select', label: 'Aspect Ratio', options: [{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: '1:1', label: '1:1' }], default: '16:9' }, duration: { type: 'select', label: 'Durasi', options: [{ value: '5', label: '5s' }, { value: '10', label: '10s' }], default: '5' } } },
    'minimax-hailuo-02': { id: 'minimax-hailuo-02', name: 'Hailuo 02', icon: '🌊', category: 'i2v', desc: 'Gerakan manusia ultra-realistis, 1080p', endpoint: '/image-to-video/minimax-hailuo-02-1080p', imageField: 'first_frame_image', imageBase64: true, inputs: ['image', 'prompt'], settings: {} },
    'minimax-hailuo-2-3': { id: 'minimax-hailuo-2-3', name: 'Hailuo 2.3', icon: '🌊', category: 'i2v', badge: 'NEW', desc: 'Versi terbaru Minimax', endpoint: '/image-to-video/minimax-hailuo-2-3-1080p', imageField: 'first_frame_image', imageBase64: true, inputs: ['image', 'prompt'], settings: {} },
    'wan-2-6-i2v': { id: 'wan-2-6-i2v', name: 'WAN 2.6 I2V', icon: '🏔️', category: 'i2v', desc: 'I2V 720p — cepat & terjangkau', endpoint: '/image-to-video/wan-v2-6-720p', imageField: 'image', imageBase64: true, inputs: ['image', 'prompt'], settings: { duration: { type: 'select', label: 'Durasi', options: [{ value: '5', label: '5s' }, { value: '10', label: '10s' }], default: '5' } } },
    'wan-2-5-t2v': { id: 'wan-2-5-t2v', name: 'WAN T2V', icon: '✍️', category: 't2v', desc: 'Text-to-Video 1080p', endpoint: '/text-to-video/wan-2-5-t2v-1080p', inputs: ['prompt'], settings: {} },
    'runway-4-5': { id: 'runway-4-5', name: 'Runway 4.5', icon: '⚡', category: 'i2v', badge: 'NEW', desc: 'Generasi video kualitas tinggi', endpoint: '/image-to-video/runway-4-5', imageField: 'image', imageBase64: true, inputs: ['image', 'prompt'], settings: { ratio: { type: 'select', label: 'Ratio', options: [{ value: '1280:720', label: '16:9' }, { value: '720:1280', label: '9:16' }, { value: '960:960', label: '1:1' }], default: '1280:720' }, duration: { type: 'select', numeric: true, label: 'Durasi', options: [{ value: '5', label: '5s' }, { value: '8', label: '8s' }, { value: '10', label: '10s' }], default: '8' } } },
    'seedance-pro': { id: 'seedance-pro', name: 'Seedance Pro', icon: '💃', category: 'i2v', desc: 'ByteDance model', endpoint: '/image-to-video/seedance-pro-1080p', imageField: 'image', imageBase64: true, inputs: ['image', 'prompt'], settings: {} },
    'pixverse-v5': { id: 'pixverse-v5', name: 'PixVerse v5', icon: '✨', category: 'i2v', desc: 'Efek video kreatif', endpoint: '/image-to-video/pixverse-v5', imageField: 'image', imageBase64: true, inputs: ['image', 'prompt'], settings: { resolution: { type: 'select', label: 'Resolusi', options: [{ value: '360p', label: '360p' }, { value: '540p', label: '540p' }, { value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }], default: '720p' }, duration: { type: 'select', numeric: true, label: 'Durasi', options: [{ value: '5', label: '5s' }, { value: '8', label: '8s' }, { value: '10', label: '10s' }], default: '5' } } },
    'vfx': { id: 'vfx', name: 'VFX Effects', icon: '🔥', category: 'special', desc: 'AI-powered visual effects', endpoint: '/video/vfx', videoField: 'video', inputs: ['video', 'prompt'], settings: { filter_type: { type: 'select', numeric: true, label: 'Filter Type', options: [{ value: '1', label: 'Bloom' }, { value: '2', label: 'Motion' }, { value: '3', label: 'Glow' }], default: '1' } } },
    'flux-2-klein': { id: 'flux-2-klein', name: 'FLUX.2 Klein', icon: '🎨', category: 'image-gen', badge: 'FAST', desc: 'Text-to-Image cepat', outputType: 'image', endpoint: '/text-to-image/flux-2-klein', inputs: ['prompt'], settings: { aspect_ratio: { type: 'select', label: 'Ratio', options: [{ value: 'square_1_1', label: '1:1' }, { value: 'widescreen_16_9', label: '16:9' }, { value: 'social_story_9_16', label: '9:16' }], default: 'square_1_1' }, resolution: { type: 'select', label: 'Resolusi', options: [{ value: '1k', label: '1K' }, { value: '2k', label: '2K' }], default: '1k' } } },
    'music-generation': { id: 'music-generation', name: 'Music Gen', icon: '🎶', category: 'audio', desc: 'Generate musik 10-240 detik', outputType: 'audio', endpoint: '/music-generation', inputs: ['prompt'], settings: { music_length_seconds: { type: 'range', label: 'Durasi (s)', min: 10, max: 240, step: 10, default: 30 } } },
    'text-to-icon': { id: 'text-to-icon', name: 'Icon Generator', icon: '💠', category: 'utility', desc: 'Generate ikon dari teks', outputType: 'image', endpoint: '/text-to-icon', inputs: ['prompt'], settings: {} }
};

const CATEGORIES = [
    { id: 'motion', label: 'Motion Control', icon: '🎭' },
    { id: 'i2v', label: 'Image → Video', icon: '🎬' },
    { id: 't2v', label: 'Text → Video', icon: '✍️' },
    { id: 'special', label: 'Special Tools', icon: '⚡' },
    { id: 'image-gen', label: 'Image Gen', icon: '🎨' },
    { id: 'image-edit', label: 'Image Edit', icon: '✏️' },
    { id: 'audio', label: 'Audio', icon: '🎵' },
    { id: 'utility', label: 'Utility', icon: '🛠️' }
];

// ==================== HELPERS ====================
function sanitizeApiKey(key) { return key.replace(/[^\x20-\x7E]/g, '').trim(); }
function fileToBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); }); }

// Langkah 3: Validasi gambar sebelum upload/konversi
function validateImage(file) {
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) return { valid: false, reason: `Ukuran gambar terlalu besar (${(file.size / 1024 / 1024).toFixed(1)}MB, max 10MB). Gunakan gambar lebih kecil.` };
    const name = (file.name || '').toLowerCase();
    const type = (file.type || '').toLowerCase();
    const isJpg = type.includes('jpeg') || type.includes('jpg') || name.endsWith('.jpg') || name.endsWith('.jpeg');
    const isPng = type.includes('png') || name.endsWith('.png');
    const isWebp = type.includes('webp') || name.endsWith('.webp');
    const isHeic = type.includes('heic') || type.includes('heif') || name.endsWith('.heic') || name.endsWith('.heif');
    // WebP dan HEIC bisa diproses lewat kompresi (canvas konversi ke JPEG)
    if (!isJpg && !isPng && !isWebp && !isHeic) return { valid: false, reason: `Format gambar tidak didukung (${file.type || 'unknown'}). Gunakan JPG atau PNG.` };
    return { valid: true, needsConversion: isWebp || isHeic };
}

// Langkah 4: Kompres gambar — resize max 2048px, JPEG 90%, handle EXIF orientation
function compressImage(file) {
    return new Promise((resolve) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
            try {
                URL.revokeObjectURL(objectUrl);
                const MAX_DIM = 2048;
                let w = img.naturalWidth, h = img.naturalHeight;
                // Resize jika lebih besar dari MAX_DIM
                if (w > MAX_DIM || h > MAX_DIM) {
                    if (w > h) { h = Math.round(h * (MAX_DIM / w)); w = MAX_DIM; }
                    else { w = Math.round(w * (MAX_DIM / h)); h = MAX_DIM; }
                }
                // Cek resolusi minimum
                if (w < 300 || h < 300) {
                    console.warn('[Moonray] Gambar terlalu kecil:', w, 'x', h);
                    resolve({ success: false, reason: `Resolusi gambar terlalu kecil (${img.naturalWidth}×${img.naturalHeight}px, min 300×300px).` });
                    return;
                }
                // Cek aspect ratio (1:2.5 sampai 2.5:1)
                const ratio = w / h;
                if (ratio < 0.4 || ratio > 2.5) {
                    resolve({ success: false, reason: `Rasio gambar terlalu ekstrem (${ratio.toFixed(1)}:1). Gunakan gambar dengan rasio antara 1:2.5 dan 2.5:1.` });
                    return;
                }
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                // Export sebagai JPEG 90%
                canvas.toBlob((blob) => {
                    if (!blob) { resolve({ success: false, reason: 'Gagal kompres gambar' }); return; }
                    const compressed = new File([blob], 'moonray-compressed.jpg', { type: 'image/jpeg' });
                    console.log(`[Moonray] Compressed: ${(file.size/1024).toFixed(0)}KB → ${(compressed.size/1024).toFixed(0)}KB (${w}×${h})`);
                    resolve({ success: true, file: compressed });
                }, 'image/jpeg', 0.9);
            } catch (e) {
                console.error('[Moonray] Compress error:', e);
                resolve({ success: false, reason: 'Error saat kompres: ' + e.message });
            }
        };
        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            console.error('[Moonray] Gagal membaca gambar untuk kompresi');
            resolve({ success: false, reason: 'Gagal membaca gambar. Coba gambar lain.' });
        };
        img.src = objectUrl;
    });
}

// ==================== FIX ANDROID 11+ SCOPED STORAGE ====================
// File dari <input type="file"> di Android 11+ menghasilkan content:// URI
// yang tidak bisa dibaca oleh JavaScript FileReader. Fungsi ini mencoba
// 5 metode berbeda untuk membaca file tersebut.
async function makeFileReadable(file) {
    if (!file || file.size === 0) return file;

    // Layer 1: FileReader standar (Android 10 dan desktop)
    try {
        const slice = file.slice(0, 4);
        const buf = await new Promise((ok, fail) => {
            const r = new FileReader();
            r.onload = () => ok(r.result);
            r.onerror = fail;
            r.readAsArrayBuffer(slice);
        });
        if (buf && buf.byteLength > 0) {
            console.log('[Moonray] makeFileReadable: Layer 1 OK (FileReader)');
            return file;
        }
    } catch(e) { console.warn('[Moonray] Layer 1 gagal:', e); }

    // Layer 2: fetch(blobURL) — bypass Scoped Storage
    try {
        const blobUrl = URL.createObjectURL(file);
        const response = await fetch(blobUrl);
        const blob = await response.blob();
        URL.revokeObjectURL(blobUrl);
        if (blob && blob.size > 0) {
            console.log('[Moonray] makeFileReadable: Layer 2 OK (fetch blobURL), size:', blob.size);
            return new File([blob], file.name, { type: file.type });
        }
    } catch(e) { console.warn('[Moonray] Layer 2 gagal:', e); }

    // Layer 3: XMLHttpRequest(blobURL) — jalur engine berbeda dari fetch
    try {
        const blobUrl = URL.createObjectURL(file);
        const blob = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', blobUrl, true);
            xhr.responseType = 'blob';
            xhr.onload = () => resolve(xhr.response);
            xhr.onerror = reject;
            xhr.send();
        });
        URL.revokeObjectURL(blobUrl);
        if (blob && blob.size > 0) {
            console.log('[Moonray] makeFileReadable: Layer 3 OK (XHR blobURL), size:', blob.size);
            return new File([blob], file.name, { type: file.type });
        }
    } catch(e) { console.warn('[Moonray] Layer 3 gagal:', e); }

    // Layer 4: Canvas (khusus gambar)
    if (file.type && file.type.startsWith('image/')) {
        try {
            const blobUrl = URL.createObjectURL(file);
            const blob = await new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    const c = document.createElement('canvas');
                    c.width = img.naturalWidth;
                    c.height = img.naturalHeight;
                    c.getContext('2d').drawImage(img, 0, 0);
                    c.toBlob(b => b ? resolve(b) : reject('no blob'), file.type || 'image/jpeg', 0.95);
                    URL.revokeObjectURL(blobUrl);
                };
                img.onerror = () => { URL.revokeObjectURL(blobUrl); reject('img load error'); };
                img.src = blobUrl;
            });
            if (blob && blob.size > 0) {
                console.log('[Moonray] makeFileReadable: Layer 4 OK (Canvas), size:', blob.size);
                return new File([blob], file.name, { type: file.type });
            }
        } catch(e) { console.warn('[Moonray] Layer 4 gagal:', e); }
    }

    // Layer 5: Native Java bridge — CHUNKED (bypass Binder IPC size limit)
    if (typeof MoonrayBridge !== 'undefined' && MoonrayBridge.getFileChunk && MoonrayBridge.hasFile) {
        window._l5dbg = '';
        try {
            const hasF = MoonrayBridge.hasFile(file.name);
            window._l5dbg += 'hasFile:' + hasF;
            if (hasF) {
                const fileSize = MoonrayBridge.getFileSize(file.name);
                window._l5dbg += ', size:' + fileSize;
                if (fileSize > 0) {
                    const CHUNK = 4096; // 4KB binary → ~5.5KB base64 (sangat kecil, pasti lolos Binder)
                    const chunks = [];
                    let ok = true;
                    let failIdx = -1;
                    let failErr = '';
                    const totalChunks = Math.ceil(fileSize / CHUNK);
                    for (let off = 0; off < fileSize; off += CHUNK) {
                        try {
                            const b64 = MoonrayBridge.getFileChunk(file.name, off, CHUNK);
                            if (!b64 || b64.length === 0) { ok = false; failIdx = Math.floor(off / CHUNK); failErr = 'empty'; break; }
                            const raw = atob(b64);
                            const arr = new Uint8Array(raw.length);
                            for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
                            chunks.push(arr);
                        } catch(ce) { ok = false; failIdx = Math.floor(off / CHUNK); failErr = ce.message || 'unknown'; break; }
                    }
                    window._l5dbg += ', chunks:' + chunks.length + '/' + totalChunks + (ok ? ' OK' : ' FAIL@' + failIdx + '(' + failErr + ')');
                    if (ok && chunks.length > 0) {
                        const blob = new Blob(chunks, { type: file.type });
                        window._l5dbg += ', blob:' + blob.size;
                        if (blob.size > 0) {
                            const newFile = new File([blob], file.name, { type: file.type });
                            // Test apakah file baru benar-benar bisa dibaca
                            try {
                                const testResult = await new Promise((res) => {
                                    const tr = new FileReader();
                                    tr.onload = () => res('OK(' + tr.result.byteLength + ')');
                                    tr.onerror = () => res('FAIL(' + (tr.error?.message || '?') + ')');
                                    tr.readAsArrayBuffer(newFile.slice(0, 1024));
                                });
                                window._l5dbg += ', readable:' + testResult;
                            } catch(te) { window._l5dbg += ', readable:ERR(' + te.message + ')'; }
                            if (blob.size > 0) {
                                console.log('[Moonray] makeFileReadable: Layer 5 OK, debug:', window._l5dbg);
                                if (MoonrayBridge.cleanupFile) MoonrayBridge.cleanupFile(file.name);
                                return newFile;
                            }
                        }
                    }
                }
            }
        } catch(e) { window._l5dbg += ', ERROR:' + (e.message || e); console.warn('[Moonray] Layer 5 gagal:', e); }
    }

    // Fallback: kembalikan file asli (perilaku sama seperti V2.6)
    console.warn('[Moonray] makeFileReadable: SEMUA layer gagal, pakai file asli');
    return file;
}

// Extract error detail dari berbagai format response Freepik
function extractErrorDetail(data) {
    const candidates = [
        data?.data?.error, data?.data?.message, data?.data?.reason,
        data?.data?.detail, data?.data?.error_message, data?.data?.failure_reason,
        data?.error, data?.message, data?.detail, data?.reason
    ];
    for (const val of candidates) {
        if (!val) continue;
        if (typeof val === 'string' && val.trim()) return val.trim();
        if (typeof val === 'object') {
            if (val.message) return String(val.message);
            if (val.detail) return String(val.detail);
            if (val.description) return String(val.description);
            if (val.reason) return String(val.reason);
            try { return JSON.stringify(val); } catch(e) { return '[error object]'; }
        }
    }
    // Cek array errors
    const errs = data?.data?.errors || data?.errors;
    if (Array.isArray(errs) && errs.length > 0) {
        return errs.map(e => (e.field ? e.field + ': ' : '') + (e.msg || e.message || JSON.stringify(e))).join('; ');
    }
    return '';
}

// ==================== STATE ====================
let state = {
    apiKey: sanitizeApiKey(localStorage.getItem('fpk_api_key') || ''),
    activeGenerator: 'motion-control-std',
    uploadedFiles: { image: null, video: null, audio: null },
    uploadedUrls: { image: '', video: '', audio: '' },
    currentPrompt: '',
    activeTasks: [],
    completedResults: [],
    history: JSON.parse(localStorage.getItem('fpk_history') || '[]')
};

// ==================== ERROR REPORTING ====================
// Kirim error dari device user ke Google Sheets untuk analisa
const _errorTimestamps = [];
let _errorCooldown = 0;

function getDeviceInfo() {
    const ua = navigator.userAgent || 'unknown';
    let deviceModel = 'unknown', androidVersion = 'unknown', webviewVersion = 'unknown';
    try { const m = ua.match(/;\s*([^;)]+)\s*Build\//); if (m) deviceModel = m[1].trim(); } catch(e) {}
    try { const m = ua.match(/Android\s+([\d.]+)/); if (m) androidVersion = m[1]; } catch(e) {}
    try { const m = ua.match(/Chrome\/([\d.]+)/); if (m) webviewVersion = m[1]; } catch(e) {}
    let fetchPatched = 'unknown';
    try { fetchPatched = window.fetch.toString().includes('native') ? 'no' : 'yes'; } catch(e) {}
    return {
        deviceModel, androidVersion, webviewVersion,
        isNative: _isCapacitorNative(),
        fetchPatched,
        appVersion: 'v2.7',
        ram: navigator.deviceMemory || 'unknown',
        hasBridge: typeof MoonrayBridge !== 'undefined'
    };
}

async function reportError(errorType, errorMessage, context = {}) {
    const now = Date.now();
    if (now < _errorCooldown) return;
    // Rate limit: max 5 per menit
    while (_errorTimestamps.length > 0 && now - _errorTimestamps[0] > 60000) _errorTimestamps.shift();
    if (_errorTimestamps.length >= 5) { _errorCooldown = now + 60000; return; }
    _errorTimestamps.push(now);

    if (!AUTH_URL) return;

    try {
        const device = getDeviceInfo();
        const payload = {
            action: 'error-report',
            timestamp: new Date().toISOString(),
            email: localStorage.getItem('mr_email') || 'unknown',
            errorType: errorType,
            errorMessage: String(errorMessage || '').substring(0, 500),
            stackTrace: context.stack ? String(context.stack).substring(0, 500) : '',
            step: context.step || '',
            generator: context.generator || '',
            fileInfo: context.fileInfo || '',
            hostResults: context.hostResults || '',
            apiStatus: context.apiStatus ? String(context.apiStatus) : '',
            apiResponse: context.apiResponse ? String(context.apiResponse).substring(0, 300) : '',
            device: JSON.stringify(device)
        };
        // Fire-and-forget — jangan blok user
        fetch(AUTH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(() => {});
    } catch(e) {
        console.warn('[Moonray] Error reporting failed:', e);
    }
}

// ==================== INIT ====================
function init() { renderContent(); updateKeyStatus(); }

// ==================== MODEL SELECTION ====================
function selectGenerator(id) {
    // Simpan prompt sebelum pindah model
    const promptEl = document.getElementById('promptInput');
    if (promptEl) state.currentPrompt = promptEl.value;
    state.activeGenerator = id;
    renderContent();
}

// ==================== RENDER CONTENT ====================
function renderContent() {
    const mc = document.getElementById('content');
    if (!state.apiKey) { renderOnboarding(mc); return; }
    const gen = GENERATORS[state.activeGenerator]; if (!gen) return;
    let html = '';

    // Model Stories — semua model langsung tampil
    const allModels = Object.values(GENERATORS);
    html += '<div class="model-stories">';
    allModels.forEach(m => {
        const isActive = state.activeGenerator === m.id;
        const badge = m.badge ? `<span class="model-story-badge">${m.badge}</span>` : '';
        html += `<div class="model-story ${isActive ? 'active' : ''}" onclick="selectGenerator('${m.id}')">`;
        html += `<div class="model-story-ring">${badge}<div class="model-story-inner">${m.icon}</div></div>`;
        html += `<div class="model-story-name">${m.name}</div></div>`;
    });
    html += '</div>';

    // Model Info
    html += `<div class="model-info"><span class="model-info-icon">${gen.icon}</span><div class="model-info-text"><h3>${gen.name}</h3><p>${gen.desc}</p></div></div>`;

    // Upload zones
    const hasImage = gen.inputs.includes('image'), hasVideo = gen.inputs.includes('video');
    if (hasImage && hasVideo) { html += '<div class="upload-row">' + buildUploadZone('image', '📸 Gambar', 'JPG, PNG, WEBP', 'image/*') + buildUploadZone('video', '🎥 Video', 'MP4, MOV', 'video/*') + '</div>'; }
    else { if (hasImage) html += buildUploadZone('image', '📸 Upload Gambar', 'JPG, PNG, WEBP — Max 10MB', 'image/*'); if (hasVideo) html += buildUploadZone('video', '🎥 Upload Video', 'MP4, MOV, WEBM', 'video/*'); }
    if (gen.inputs.includes('audio')) html += buildUploadZone('audio', '🎵 Upload Audio', 'MP3, WAV, M4A', 'audio/*');

    // Prompt
    if (gen.inputs.includes('prompt')) {
        html += `<div class="card" style="margin-top:12px"><div class="card-title"><span>💬</span> Prompt</div><div class="form-group" style="margin-bottom:0"><textarea class="form-textarea" id="promptInput" placeholder="Deskripsikan yang diinginkan..." maxlength="2500" oninput="updateCharCount()">${state.currentPrompt || ''}</textarea><div style="text-align:right;font-size:10px;color:var(--text-muted);margin-top:3px"><span id="charCount">${(state.currentPrompt || '').length}</span>/2500</div></div></div>`;
    }

    // Settings
    const settings = Object.entries(gen.settings);
    if (settings.length > 0) {
        html += '<div class="card" style="margin-top:12px"><div class="card-title"><span>⚙️</span> Settings</div>';
        settings.forEach(([key, cfg]) => {
            if (cfg.type === 'select') html += `<div class="form-group"><label class="form-label">${cfg.label}</label><select class="form-select" id="setting_${key}">${cfg.options.map(o => `<option value="${o.value}" ${o.value === cfg.default ? 'selected' : ''}>${o.label}</option>`).join('')}</select></div>`;
            else if (cfg.type === 'range') html += `<div class="form-group"><label class="form-label">${cfg.label}</label><div class="range-group"><input type="range" class="range-slider" id="setting_${key}" min="${cfg.min}" max="${cfg.max}" step="${cfg.step}" value="${cfg.default}" oninput="document.getElementById('rv_${key}').textContent=this.value"><span class="range-value" id="rv_${key}">${cfg.default}</span></div></div>`;
        });
        html += '</div>';
    }

    // Rate limit info
    const recentReqs = RATE_LIMIT.timestamps.filter(t => Date.now() - t < RATE_LIMIT.windowMs).length;
    html += `<div class="rate-limit-info"><span>🛡️</span><span>Task: ${state.activeTasks.length}/${RATE_LIMIT.maxConcurrent} — Req: ${recentReqs}/${RATE_LIMIT.maxRequests}/min</span></div>`;

    // Generate button
    const isCooldown = Date.now() < RATE_LIMIT.cooldownUntil, atMax = state.activeTasks.length >= RATE_LIMIT.maxConcurrent;
    html += `<button class="btn btn-primary btn-block" style="padding:14px;font-size:15px" id="generateBtn" onclick="generate()" ${isCooldown || atMax ? 'disabled' : ''}>🚀 Generate ${gen.outputType === 'image' ? 'Gambar' : gen.outputType === 'audio' ? 'Audio' : 'Video'}</button>`;
    html += `<div id="cooldownWrap" style="display:${isCooldown ? 'block' : 'none'}"><div class="cooldown-bar"><div class="cooldown-fill" style="width:0%"></div></div><div class="cooldown-text" style="font-size:10px;color:var(--text-muted);margin-top:3px;text-align:center"></div></div>`;
    if (isCooldown) setTimeout(() => startCooldownTimer(), 50);

    // Active Tasks
    if (state.activeTasks.length > 0) { html += '<div id="activeTasksArea" style="margin-top:12px">'; state.activeTasks.forEach(t => { html += buildTaskCardHtml(t); }); html += '</div>'; }

    // Results
    html += '<div id="resultArea">';
    state.completedResults.forEach(result => {
        html += `<div class="card" style="margin-top:10px;position:relative"><button onclick="removeResult(${result.timestamp})" style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.5);border:none;color:#fff;cursor:pointer;font-size:16px;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center">✕</button><h4 style="font-size:13px;margin-bottom:8px;color:var(--accent)">✅ ${result.genName}</h4>`;
        if (result.outputType === 'image' && result.url) html += `<img src="${result.url}" style="max-width:100%;border-radius:8px;margin-bottom:8px"><br><button class="btn btn-primary btn-sm" onclick="downloadFile('${result.url}','moonray-image.png')">⬇️ Download</button>`;
        else if (result.outputType === 'audio' && result.url) html += `<audio src="${result.url}" controls style="width:100%;margin-bottom:8px"></audio><br><button class="btn btn-primary btn-sm" onclick="downloadFile('${result.url}','moonray-audio.mp3')">⬇️ Download</button>`;
        else if (result.url) html += `<video src="${result.url}" controls muted loop playsinline style="max-width:100%;border-radius:8px;margin-bottom:8px"></video><br><button class="btn btn-primary btn-sm" onclick="downloadFile('${result.url}','moonray-video.mp4')">⬇️ Download</button>`;
        else html += `<pre style="font-size:10px;color:var(--text-secondary);overflow:auto;max-height:200px">${JSON.stringify(result.data, null, 2)}</pre>`;
        html += '</div>';
    });
    if (state.completedResults.length > 1) html += '<button class="btn btn-secondary btn-sm" style="margin-top:6px" onclick="state.completedResults=[];renderContent()">🗑️ Hapus Semua</button>';
    html += '</div>';

    // Disclaimer
    html += `<div class="disclaimer-text">🛡️ Dengan menggunakan Moonray, Anda menyetujui <a href="#" onclick="event.preventDefault();openDisclaimer()">Syarat & Ketentuan</a>.<br>API key tersimpan lokal di perangkat.<br><span style="font-size:9px;color:var(--text-muted);margin-top:3px;display:inline-block">Powered by <a href="#" onclick="event.preventDefault();openExternal('https://www.freepik.com/developers')" style="color:var(--text-muted)">Freepik API</a></span></div>`;
    mc.innerHTML = html;
}

function removeResult(ts) { state.completedResults = state.completedResults.filter(r => r.timestamp !== ts); renderContent(); }

// ==================== ONBOARDING ====================
function renderOnboarding(mc) {
    mc.innerHTML = `<div style="text-align:center;padding:20px 0"><div style="margin-bottom:10px"><img src="logo.png" alt="Moonray" style="width:72px;height:72px;object-fit:contain"></div><h1 style="font-size:26px;font-weight:800;background:var(--accent-gradient);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:6px">Selamat Datang di Moonray</h1><p style="color:var(--text-secondary);font-size:13px;max-width:360px;margin:0 auto">AI Video Generator dengan 20+ model AI</p>
    <div class="card" style="margin-top:16px;text-align:left;border-left:3px solid var(--accent)"><div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><div style="width:30px;height:30px;border-radius:50%;background:var(--accent-gradient);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0;color:#fff">1</div><div><div style="font-weight:600;font-size:13px">Daftar Akun Freepik (Gratis)</div><div style="font-size:11px;color:var(--text-muted)">Dapatkan $5 kredit gratis</div></div></div><a href="#" onclick="event.preventDefault();openExternal('https://www.freepik.com/sign-up')" style="display:block;text-align:center;padding:10px;background:var(--bg-input);border:1px solid var(--border);border-radius:8px;color:var(--accent);text-decoration:none;font-size:12px;font-weight:600">📝 Buka Halaman Daftar →</a></div>
    <div class="card" style="margin-top:10px;text-align:left;border-left:3px solid var(--accent2)"><div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><div style="width:30px;height:30px;border-radius:50%;background:var(--accent-gradient-r);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0;color:#fff">2</div><div><div style="font-weight:600;font-size:13px">Ambil API Key</div><div style="font-size:11px;color:var(--text-muted)">Developer Dashboard → copy key</div></div></div><a href="#" onclick="event.preventDefault();openExternal('https://www.freepik.com/developers/dashboard/api-key')" style="display:block;text-align:center;padding:10px;background:var(--bg-input);border:1px solid var(--border);border-radius:8px;color:var(--accent2);text-decoration:none;font-size:12px;font-weight:600">🔑 Buka Dashboard →</a></div>
    <div class="card" style="margin-top:10px;text-align:left;border-left:3px solid var(--warning)"><div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><div style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,var(--warning),#f97316);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0;color:#fff">3</div><div><div style="font-weight:600;font-size:13px">Paste API Key</div><div style="font-size:11px;color:var(--text-muted)">Disimpan lokal di perangkat ini</div></div></div><div style="display:flex;gap:8px"><input type="password" id="onboardKeyInput" class="form-input" placeholder="fpk-xxxxxxxxxxxxx" style="flex:1;font-size:12px"><button class="btn btn-primary" style="white-space:nowrap;padding:8px 14px;font-size:12px" onclick="const k=sanitizeApiKey(document.getElementById('onboardKeyInput').value);if(!k){toast('Masukkan API key','error');return;}state.apiKey=k;localStorage.setItem('fpk_api_key',k);updateKeyStatus();renderContent();toast('API key disimpan! 🎉','success');if(!localStorage.getItem('fpk_disclaimer_accepted'))setTimeout(()=>openDisclaimer(),500);">Simpan</button></div></div>
    <div style="margin-top:14px;padding:12px;background:rgba(99,102,241,0.05);border:1px solid rgba(99,102,241,0.15);border-radius:10px;font-size:11px;color:var(--text-secondary);line-height:1.7;text-align:left"><strong style="color:var(--accent)">💡 Info:</strong><br>• Pendaftaran & API key <strong>100% gratis</strong> — dapat $5 kredit<br>• API key disimpan <strong>hanya di perangkat ini</strong><br>• Setiap generate menggunakan kredit dari akun Freepik</div></div>`;
}

// ==================== UPLOAD ZONE ====================
function buildUploadZone(type, title, hint, accept) {
    const hasFile = state.uploadedFiles[type] || state.uploadedUrls[type];
    return `<div class="card" style="margin-top:12px"><div class="card-title"><span>${type === 'image' ? '📸' : type === 'video' ? '🎥' : '🎵'}</span> ${title}</div><div class="upload-zone" id="zone_${type}" ondrop="handleDrop(event,'${type}')" ondragover="handleDragOver(event,'${type}')" ondragleave="handleDragLeave(event,'${type}')" onclick="handleZoneClick(event,'${type}')"><input type="file" id="file_${type}" accept="${accept}" onchange="handleFileSelect(event,'${type}')">${hasFile ? buildPreview(type) : `<div class="icon">${type === 'image' ? '📸' : type === 'video' ? '🎥' : '🎵'}</div><div class="text">Klik atau drag file</div><div class="hint">${hint}</div>`}</div><div class="input-toggle" onclick="toggleUrlInput('${type}')">🔗 Atau masukkan URL</div><div id="urlInputWrap_${type}" style="display:none;margin-top:6px"><input class="form-input" id="urlInput_${type}" placeholder="https://..." value="${state.uploadedUrls[type]}" onchange="state.uploadedUrls['${type}']=this.value"></div></div>`;
}
function buildPreview(type) {
    const file = state.uploadedFiles[type];
    const savedUrl = state._uploadedPreviewUrls && state._uploadedPreviewUrls[type];
    if (!file && !savedUrl) return '';
    let url;
    if (file) {
        try { url = URL.createObjectURL(file); if (!state._objectUrls) state._objectUrls = []; state._objectUrls.push(url); } catch (e) { url = savedUrl || ''; }
    } else { url = savedUrl || ''; }
    if (!url) return `<div class="preview"><div style="color:var(--success)">✅ File sudah diupload</div><button class="remove-btn" onclick="event.stopPropagation();removeFile('${type}')">✕</button></div>`;
    if (type === 'image') return `<div class="preview"><img src="${url}"><button class="remove-btn" onclick="event.stopPropagation();removeFile('${type}')">✕</button></div>`;
    if (type === 'video') return `<div class="preview"><video src="${url}" controls muted playsinline onclick="event.stopPropagation()"></video><button class="remove-btn" onclick="event.stopPropagation();removeFile('${type}')">✕</button></div>`;
    return `<div class="preview"><div style="color:var(--accent)">🎵 ${file ? file.name : 'Audio file'}</div><button class="remove-btn" onclick="event.stopPropagation();removeFile('${type}')">✕</button></div>`;
}
function handleZoneClick(e, type) { if (e.target.tagName === 'VIDEO' || e.target.tagName === 'BUTTON') return; if (e.target.closest('.preview') && e.target.closest('video,button')) return; document.getElementById('file_' + type).click(); }
function handleDragOver(e, type) { e.preventDefault(); document.getElementById('zone_' + type).classList.add('dragover'); }
function handleDragLeave(e, type) { e.preventDefault(); document.getElementById('zone_' + type).classList.remove('dragover'); }
async function handleDrop(e, type) { e.preventDefault(); document.getElementById('zone_' + type).classList.remove('dragover'); const f = e.dataTransfer.files[0]; if (f) { state.uploadedFiles[type] = await makeFileReadable(f); renderContent(); } }
async function handleFileSelect(e, type) { const f = e.target.files[0]; if (f) { state.uploadedFiles[type] = await makeFileReadable(f); renderContent(); } }
function removeFile(type) { state.uploadedFiles[type] = null; state.uploadedUrls[type] = ''; if (state._uploadedPreviewUrls) state._uploadedPreviewUrls[type] = ''; if (state._objectUrls) { state._objectUrls.forEach(u => URL.revokeObjectURL(u)); state._objectUrls = []; } renderContent(); }
function toggleUrlInput(type) { const w = document.getElementById('urlInputWrap_' + type); w.style.display = w.style.display === 'none' ? 'block' : 'none'; }
function updateCharCount() { const el = document.getElementById('promptInput'); if (el) document.getElementById('charCount').textContent = el.value.length; }

// ==================== API KEY ====================
function openApiKeyModal() { document.getElementById('apiKeyModal').classList.add('active'); document.getElementById('apiKeyInput').value = state.apiKey; }
function closeApiKeyModal() { document.getElementById('apiKeyModal').classList.remove('active'); }
function saveApiKey() { const key = sanitizeApiKey(document.getElementById('apiKeyInput').value); if (!key) { toast('Masukkan API key', 'error'); return; } state.apiKey = key; localStorage.setItem('fpk_api_key', key); updateKeyStatus(); closeApiKeyModal(); renderContent(); toast('API key disimpan!', 'success'); }
function removeApiKey() { state.apiKey = ''; localStorage.removeItem('fpk_api_key'); updateKeyStatus(); closeApiKeyModal(); renderContent(); toast('API key dihapus', 'info'); }
function updateKeyStatus() { const dot = document.getElementById('keyDot'), status = document.getElementById('keyStatus'); if (state.apiKey) { dot.className = 'dot active'; status.textContent = 'Terhubung'; } else { dot.className = 'dot inactive'; status.textContent = 'Belum Terhubung'; } }

// ==================== FILE UPLOAD TO HOST ====================
async function safeFetch(url, options = {}, timeoutMs = 30000) { const c = new AbortController(); const t = setTimeout(() => c.abort(), timeoutMs); try { const r = await fetch(url, { ...options, signal: c.signal }); clearTimeout(t); return r; } catch (err) { clearTimeout(t); throw err.name === 'AbortError' ? new Error('Timeout') : err; } }

// Helper: convert File to base64 string for native bridge
function _fileToBase64ForUpload(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]); // strip data:xxx;base64, prefix
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Helper: check if native upload is available
function _hasNativeUpload() {
    return typeof MoonrayBridge !== 'undefined' && typeof MoonrayBridge.nativeUpload === 'function';
}

// Langkah 2: Verifikasi URL masih bisa diakses sebelum kirim ke Freepik
async function verifyUrl(url) {
    if (!url) return false;
    try {
        const r = await safeFetch(url, { method: 'HEAD', mode: 'no-cors' }, 5000);
        // no-cors mode: opaque response (status 0) berarti server merespons → URL hidup
        return true;
    } catch (e) {
        console.warn('[Moonray] URL verification failed:', url, e.message);
        return false;
    }
}
async function verifyAndReupload(url, file, uploadFn, statusCallback) {
    const alive = await verifyUrl(url);
    if (alive) return url;
    console.warn('[Moonray] URL mati, re-uploading...', url);
    if (statusCallback) statusCallback('URL expired, uploading ulang...');
    const newUrl = await uploadFn(file, statusCallback);
    return newUrl || url; // fallback ke URL lama jika re-upload juga gagal
}
// Timeout dinamis berdasarkan ukuran file: kecil=30s, besar=max 120s
function uploadTimeout(file) { return Math.min(120000, Math.max(30000, Math.round(file.size / 1024 * 30))); }

// --- Upload functions: coba native dulu, fallback fetch ---
async function tryTmpfiles(file) {
    // Native upload (bypass CORS)
    if (_hasNativeUpload()) {
        try {
            console.log('[Moonray] tryTmpfiles: using native upload');
            const b64 = await _fileToBase64ForUpload(file);
            const raw = MoonrayBridge.nativeUpload(b64, 'https://tmpfiles.org/api/v1/upload', 'file', file.name || 'upload.jpg');
            if (raw) {
                const d = JSON.parse(raw);
                if (d.status === 'success' && d.data?.url) return d.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
            }
        } catch (e) { console.warn('[Moonray] tryTmpfiles native failed:', e.message); }
    }
    // Fallback: fetch biasa
    const fd = new FormData(); fd.append('file', file);
    const r = await safeFetch('https://tmpfiles.org/api/v1/upload', { method: 'POST', body: fd }, uploadTimeout(file));
    const d = await r.json();
    return (d.status === 'success' && d.data?.url) ? d.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/') : null;
}

async function tryCatbox(file) {
    // Native upload (bypass CORS) — catbox butuh extra field "reqtype"
    if (_hasNativeUpload() && typeof MoonrayBridge.nativeUploadWithFields === 'function') {
        try {
            console.log('[Moonray] tryCatbox: using native upload');
            const b64 = await _fileToBase64ForUpload(file);
            const raw = MoonrayBridge.nativeUploadWithFields(b64, 'https://catbox.moe/user/api.php', 'fileToUpload', file.name || 'upload.jpg', 'reqtype=fileupload');
            if (raw && raw.startsWith('https://')) return raw.trim();
        } catch (e) { console.warn('[Moonray] tryCatbox native failed:', e.message); }
    }
    // Fallback: fetch biasa
    const fd = new FormData(); fd.append('reqtype', 'fileupload'); fd.append('fileToUpload', file);
    const r = await safeFetch('https://catbox.moe/user/api.php', { method: 'POST', body: fd }, uploadTimeout(file));
    const url = await r.text();
    return (url && url.startsWith('https://')) ? url.trim() : null;
}

async function tryFreeimage(file) {
    // Native upload (bypass CORS) — freeimage butuh extra fields
    if (_hasNativeUpload() && typeof MoonrayBridge.nativeUploadWithFields === 'function') {
        try {
            console.log('[Moonray] tryFreeimage: using native upload');
            const b64 = await _fileToBase64ForUpload(file);
            const raw = MoonrayBridge.nativeUploadWithFields(b64, 'https://freeimage.host/api/1/upload?key=6d207e02198a847aa98d0a2a901485a5', 'source', file.name || 'upload.jpg', 'type=file&action=upload');
            if (raw) {
                const d = JSON.parse(raw);
                if (d.image?.url) return d.image.url;
            }
        } catch (e) { console.warn('[Moonray] tryFreeimage native failed:', e.message); }
    }
    // Fallback: fetch biasa
    const fd = new FormData(); fd.append('source', file); fd.append('type', 'file'); fd.append('action', 'upload');
    const r = await safeFetch('https://freeimage.host/api/1/upload?key=6d207e02198a847aa98d0a2a901485a5', { method: 'POST', body: fd }, uploadTimeout(file));
    const d = await r.json();
    return d.image?.url || null;
}

async function tryLabsStorage(file) {
    if (!STORAGE_URL) return null;
    // Native upload
    if (_hasNativeUpload()) {
        try {
            console.log('[Moonray] tryLabsStorage: using native upload');
            const b64 = await _fileToBase64ForUpload(file);
            const raw = MoonrayBridge.nativeUpload(b64, STORAGE_URL + '/upload', 'file', file.name || 'upload.jpg');
            if (raw) { const d = JSON.parse(raw); if (d.success) return d.url; }
        } catch (e) { console.warn('[Moonray] tryLabsStorage native failed:', e.message); }
    }
    // Fallback: fetch biasa
    const fd = new FormData(); fd.append('file', file);
    const r = await safeFetch(STORAGE_URL + '/upload', { method: 'POST', body: fd }, uploadTimeout(file));
    const d = await r.json();
    return d.success ? d.url : null;
}

async function try0x0st(file) {
    // Native upload (bypass CORS)
    if (_hasNativeUpload()) {
        try {
            console.log('[Moonray] try0x0st: using native upload');
            const b64 = await _fileToBase64ForUpload(file);
            const raw = MoonrayBridge.nativeUpload(b64, 'https://0x0.st', 'file', file.name || 'upload.jpg');
            if (raw && raw.startsWith('https://')) return raw.trim();
        } catch (e) { console.warn('[Moonray] try0x0st native failed:', e.message); }
    }
    // Fallback: fetch biasa
    const fd = new FormData(); fd.append('file', file);
    const r = await safeFetch('https://0x0.st', { method: 'POST', body: fd }, uploadTimeout(file));
    const url = await r.text();
    return (url && url.startsWith('https://')) ? url.trim() : null;
}

// ==================== DIAGNOSTIK UPLOAD ====================
async function showUploadDiagnostic(file, hostErrors) {
    let report = '📋 MOONRAY DIAGNOSTIK v4\n';
    report += '━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    // Device info
    const ua = navigator.userAgent || 'unknown';
    const capActive = (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform && Capacitor.isNativePlatform()) ? 'YA' : 'TIDAK';
    let fetchPatched = 'TIDAK DIKETAHUI';
    try { const fs = window.fetch.toString(); fetchPatched = fs.includes('native') ? 'TIDAK (native)' : 'YA (di-patch)'; } catch(e) { fetchPatched = 'Error: ' + e.message; }
    let bridgeInfo = 'TIDAK';
    if (typeof MoonrayBridge !== 'undefined') {
        bridgeInfo = 'YA';
        try {
            const fn = file.name || '?';
            bridgeInfo += ', hasFile(' + fn + '): ' + (MoonrayBridge.hasFile ? MoonrayBridge.hasFile(fn) : 'N/A');
            if (MoonrayBridge.getFileSize) bridgeInfo += ', size: ' + MoonrayBridge.getFileSize(fn);
            if (MoonrayBridge.getFileChunk) { const c0 = MoonrayBridge.getFileChunk(fn, 0, 100); bridgeInfo += ', chunk0: ' + (c0 && c0.length > 0 ? 'OK(' + c0.length + ')' : 'FAIL'); }
        } catch(e) { bridgeInfo += ', error: ' + e.message; }
    }
    report += '🔧 Device Info:\n';
    report += '- UA: ' + ua.substring(0, 100) + '\n';
    report += '- CapacitorNative: ' + capActive + '\n';
    report += '- Fetch patched: ' + fetchPatched + '\n';
    report += '- NativeBridge: ' + bridgeInfo + '\n';
    if (window._l5dbg) report += '- Layer5 Debug: ' + window._l5dbg + '\n';
    report += '\n';
    // File info
    report += '📁 File Info:\n';
    report += '- Nama: ' + (file.name || 'unknown') + '\n';
    report += '- Ukuran: ' + (file.size / 1024).toFixed(1) + ' KB\n';
    report += '- Tipe: ' + (file.type || 'unknown') + '\n';
    // File readability test
    try {
        const slice = file.slice(0, 1024);
        const buf = await new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fail; r.readAsArrayBuffer(slice); });
        report += '- File bisa dibaca: ✅ YA (' + buf.byteLength + ' bytes terbaca)\n\n';
    } catch(e) {
        report += '- File bisa dibaca: ❌ TIDAK (' + e.message + ')\n\n';
    }
    // Network test
    report += '🌐 Network Test:\n';
    const testUrls = ['https://tmpfiles.org', 'https://catbox.moe', 'https://0x0.st'];
    for (const testUrl of testUrls) {
        try {
            const r = await fetch(testUrl, { method: 'HEAD', mode: 'no-cors', signal: AbortSignal.timeout(5000) });
            report += '- HEAD ' + testUrl + ': ✅ OK\n';
        } catch(e) {
            report += '- HEAD ' + testUrl + ': ❌ ' + e.message + '\n';
        }
    }
    report += '\n';
    // Upload results
    report += '📤 Upload Results:\n';
    for (const he of hostErrors) {
        report += '- ' + he.name + ': ' + he.result + '\n';
    }
    report += '\n💡 Screenshot halaman ini dan kirim ke developer.';
    console.log(report);
    alert(report);
}

async function uploadImageToHost(file, statusCallback) {
    const hosts = [{ name: 'tmpfiles', fn: () => tryTmpfiles(file) }, { name: '0x0', fn: () => try0x0st(file) }, { name: 'freeimage', fn: () => tryFreeimage(file) }, { name: 'catbox', fn: () => tryCatbox(file) }, { name: 'labs-storage', fn: () => tryLabsStorage(file) }];
    const hostErrors = [];
    for (let i = 0; i < hosts.length; i++) {
        const host = hosts[i];
        try {
            console.log(`[Moonray] Trying ${host.name}...`);
            if (i > 0 && statusCallback) statusCallback('Mencoba server lain...');
            const url = await host.fn();
            if (url) { console.log(`[Moonray] ✅ ${host.name}:`, url); return url; }
            hostErrors.push({ name: host.name, result: '❌ Return null (no URL)' });
        } catch (e) {
            console.warn(`[Moonray] ${host.name} failed:`, e);
            hostErrors.push({ name: host.name, result: '❌ ' + (e.name || '') + ': ' + (e.message || String(e)) });
        }
    }
    toast('Upload gagal. Menampilkan diagnostik...', 'error');
    reportError('upload_image_fail', 'Semua host gagal', { step: 'upload_image', fileInfo: `${file.name}|${file.size}|${file.type}`, hostResults: JSON.stringify(hostErrors.map(h => h.name + ':' + h.result)).substring(0, 400), generator: state.activeGenerator });
    await showUploadDiagnostic(file, hostErrors);
    return null;
}
async function uploadVideoToHost(file, statusCallback) {
    const hosts = [{ name: 'tmpfiles', fn: () => tryTmpfiles(file) }, { name: '0x0', fn: () => try0x0st(file) }, { name: 'catbox', fn: () => tryCatbox(file) }, { name: 'labs-storage', fn: () => tryLabsStorage(file) }];
    const hostErrors = [];
    for (let i = 0; i < hosts.length; i++) {
        const host = hosts[i];
        try {
            console.log(`[Moonray] Trying ${host.name}...`);
            if (i > 0 && statusCallback) statusCallback('Mencoba server lain...');
            const url = await host.fn();
            if (url) { console.log(`[Moonray] ✅ ${host.name}:`, url); return url; }
            hostErrors.push({ name: host.name, result: '❌ Return null (no URL)' });
        } catch (e) {
            console.warn(`[Moonray] ${host.name} failed:`, e);
            hostErrors.push({ name: host.name, result: '❌ ' + (e.name || '') + ': ' + (e.message || String(e)) });
        }
    }
    toast('Upload video gagal. Menampilkan diagnostik...', 'error');
    reportError('upload_video_fail', 'Semua host gagal', { step: 'upload_video', fileInfo: `${file.name}|${file.size}|${file.type}`, hostResults: JSON.stringify(hostErrors.map(h => h.name + ':' + h.result)).substring(0, 400), generator: state.activeGenerator });
    await showUploadDiagnostic(file, hostErrors);
    return null;
}

// ==================== GENERATE ====================
async function generate() {
    const gen = GENERATORS[state.activeGenerator]; if (!gen) return;
    if (!state.apiKey) { toast('Masukkan API key', 'error'); return; }
    if (!canGenerate()) return;

    const promptEl = document.getElementById('promptInput');
    const prompt = promptEl ? promptEl.value.trim() : '';
    state.currentPrompt = prompt;
    let imageUrl = state.uploadedUrls.image || '', videoUrl = state.uploadedUrls.video || '', audioUrl = state.uploadedUrls.audio || '';

    // ⚠️ Simpan setting values SEBELUM renderContent() me-reset dropdown ke default
    const savedSettings = {};
    Object.entries(gen.settings).forEach(([key, cfg]) => {
        const el = document.getElementById('setting_' + key);
        if (el) savedSettings[key] = el.value;
        else savedSettings[key] = cfg.default;
    });

    // Tampilkan loading card SEGERA
    const tempTaskId = 'prep_' + Date.now();
    const prepTask = { id: tempTaskId, genId: gen.id, genName: gen.name, outputType: gen.outputType || 'video', progress: 2, statusText: 'Mempersiapkan...' };
    state.activeTasks.push(prepTask);
    renderContent();

    if (!state._uploadedPreviewUrls) state._uploadedPreviewUrls = {};
    // Base64 mode: convert image to base64 instead of uploading to host (for Kling 2.6 etc.)
    let imageBase64Data = null;
    // Langkah 3+4: Validasi dan kompres gambar jika ada file gambar
    let processedImageFile = state.uploadedFiles.image;
    if (gen.inputs.includes('image') && processedImageFile && !imageUrl) {
        // Langkah 3: Validasi
        const validation = validateImage(processedImageFile);
        if (!validation.valid) { removeTask(tempTaskId); toast(validation.reason, 'error'); return; }
        // Langkah 4: Kompres gambar (resize + konversi format)
        prepTask.statusText = 'Memproses gambar...'; prepTask.progress = 5; updateActiveTasksUI();
        const compressed = await compressImage(processedImageFile);
        if (compressed.success) {
            processedImageFile = compressed.file;
            console.log('[Moonray] Using compressed image');
        } else if (compressed.reason && compressed.reason.includes('terlalu kecil') || compressed.reason && compressed.reason.includes('terlalu ekstrem')) {
            // Validasi resolusi/ratio gagal → tampilkan error
            removeTask(tempTaskId); toast(compressed.reason, 'error'); return;
        } else {
            // Kompresi gagal tapi bukan karena validasi → fallback ke file asli
            console.warn('[Moonray] Compression failed, using original file');
        }
    }

    if (gen.imageBase64 && gen.inputs.includes('image') && processedImageFile && !imageUrl) {
        prepTask.statusText = 'Konversi gambar...'; prepTask.progress = 10; updateActiveTasksUI();
        try { imageBase64Data = await fileToBase64(processedImageFile); console.log('[Moonray] Image converted to base64, length:', imageBase64Data.length); } catch (e) { console.error('[Moonray] Base64 error:', e); removeTask(tempTaskId); toast('Gagal konversi gambar. Coba gambar lebih kecil atau format JPG/PNG.', 'error'); return; }
    }
    if (!gen.imageBase64 && gen.inputs.includes('image') && processedImageFile && !imageUrl) { prepTask.statusText = 'Uploading gambar...'; prepTask.progress = 10; updateActiveTasksUI(); imageUrl = await uploadImageToHost(processedImageFile, (msg) => { prepTask.statusText = msg; updateActiveTasksUI(); }); if (!imageUrl) { removeTask(tempTaskId); return; } state._uploadedPreviewUrls.image = imageUrl; }
    if (gen.inputs.includes('video') && state.uploadedFiles.video && !videoUrl) { prepTask.statusText = 'Uploading video...'; prepTask.progress = 25; updateActiveTasksUI(); videoUrl = await uploadVideoToHost(state.uploadedFiles.video, (msg) => { prepTask.statusText = msg; updateActiveTasksUI(); }); if (!videoUrl) { removeTask(tempTaskId); return; } state._uploadedPreviewUrls.video = videoUrl; }
    if (gen.inputs.includes('audio') && state.uploadedFiles.audio && !audioUrl) { prepTask.statusText = 'Uploading audio...'; prepTask.progress = 25; updateActiveTasksUI(); audioUrl = await uploadVideoToHost(state.uploadedFiles.audio, (msg) => { prepTask.statusText = msg; updateActiveTasksUI(); }); if (!audioUrl) { removeTask(tempTaskId); return; } state._uploadedPreviewUrls.audio = audioUrl; }

    // Langkah 2: Verifikasi URL gambar dan video masih bisa diakses
    if (imageUrl && processedImageFile) {
        prepTask.statusText = 'Verifikasi URL gambar...'; updateActiveTasksUI();
        imageUrl = await verifyAndReupload(imageUrl, processedImageFile, uploadImageToHost, (msg) => { prepTask.statusText = msg; updateActiveTasksUI(); });
        if (imageUrl) state._uploadedPreviewUrls.image = imageUrl;
    }
    if (videoUrl && state.uploadedFiles.video) {
        prepTask.statusText = 'Verifikasi URL video...'; updateActiveTasksUI();
        videoUrl = await verifyAndReupload(videoUrl, state.uploadedFiles.video, uploadVideoToHost, (msg) => { prepTask.statusText = msg; updateActiveTasksUI(); });
        if (videoUrl) state._uploadedPreviewUrls.video = videoUrl;
    }

    if (gen.inputs.includes('image') && !imageUrl && !imageBase64Data) { removeTask(tempTaskId); toast('Upload gambar', 'error'); return; }
    if (gen.inputs.includes('video') && !videoUrl) { removeTask(tempTaskId); toast('Upload video', 'error'); return; }

    const body = {};
    const forceHttps = (url) => url ? url.replace(/^http:\/\//i, 'https://') : url;
    if (prompt) body[gen.promptKey || 'prompt'] = prompt;
    if (imageBase64Data) {
        // Base64 mode: send raw base64 data
        body[gen.imageField || 'image'] = imageBase64Data;
        console.log('[Moonray] Sending base64 image as:', gen.imageField || 'image');
    } else if (imageUrl) {
        imageUrl = forceHttps(imageUrl);
        const imgField = gen.imageField || 'image_url';
        if (imgField === 'reference_images') body.reference_images = [imageUrl];
        else body[imgField] = imageUrl;
    }
    if (videoUrl) body[gen.videoField || 'video_url'] = forceHttps(videoUrl);
    if (audioUrl) body[gen.audioField || 'audio_url'] = forceHttps(audioUrl);
    Object.entries(gen.settings).forEach(([key, cfg]) => {
        const val = savedSettings[key];
        if (val !== undefined) {
            if (cfg.type === 'range') body[key] = parseFloat(val);
            else if (cfg.numeric) body[key] = Number(val);
            else if (cfg.boolean) body[key] = val === 'true';
            else body[key] = val;
        }
    });
    body.webhook_url = 'https://webhook.site/placeholder';

    recordRequest();
    prepTask.statusText = 'Mengirim ke API...'; prepTask.progress = 40; updateActiveTasksUI();

    // ⚡ RETRY LOGIC: hanya retry untuk timeout/network error (kredit TIDAK terpotong)
    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            if (attempt > 0) {
                prepTask.statusText = `⏳ Retry ${attempt}/${MAX_RETRIES}... menunggu 3 detik`;
                prepTask.progress = 35; updateActiveTasksUI();
                await new Promise(resolve => setTimeout(resolve, 3000));
                prepTask.statusText = 'Mengirim ke API...'; prepTask.progress = 40; updateActiveTasksUI();
            }

            const response = await freepikRequest(API_BASE + gen.endpoint, 'POST', state.apiKey, body);
            const data = response.data;
            if (!response.ok) {
                console.error('[Moonray] API Error:', response.status, JSON.stringify(data));
                console.error('[Moonray] Request body was:', JSON.stringify(body));
                let errMsg = data?.message || data?.detail || data?.error || JSON.stringify(data);
                if (response.status === 401 || response.status === 403) errMsg = 'API key tidak valid atau expired. (HTTP ' + response.status + ')';
                else if (response.status === 429) errMsg = 'Rate limit tercapai. Tunggu lalu coba lagi.';
                else if (response.status === 402) errMsg = 'Saldo kredit habis.';
                else if (response.status === 400) {
                    let detail = data?.message || 'Validation error';
                    if (data?.invalid_params && data.invalid_params.length > 0) {
                        detail += ': ' + data.invalid_params.map(p => p.field + ' → ' + p.reason).join('; ');
                    }
                    errMsg = detail;
                }
                // Jangan retry untuk error HTTP — error permanen
                reportError('generate_api_error', errMsg, { step: 'generate', generator: gen.id, apiStatus: response.status, apiResponse: JSON.stringify(data).substring(0, 300) });
                removeTask(tempTaskId); showError(errMsg); addToHistory(gen.name, 'FAILED', null, gen.outputType);
                return;
            }

            const taskId = data?.data?.task_id || data?.task_id;
            if (taskId) {
                removeTask(tempTaskId);
                const task = { id: taskId, genId: gen.id, genName: gen.name, outputType: gen.outputType || 'video', progress: 5, statusText: 'Queued...' };
                state.activeTasks.push(task); renderContent(); pollTask(task, gen);
            } else {
                removeTask(tempTaskId);
                handleResult(data, gen.outputType, gen.name);
                addToHistory(gen.name, 'COMPLETED', data, gen.outputType);
                toast('✅ Selesai!', 'success');
            }
            return; // Berhasil — keluar dari loop retry

        } catch (err) {
            console.error(`[Moonray] Generate error (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`, err);
            const errMsg = err.message || '';
            const isTimeoutOrNetwork = /timeout|sibuk|network|failed to fetch|load failed|internet|end of stream/i.test(errMsg);

            if (!isTimeoutOrNetwork || attempt >= MAX_RETRIES) {
                reportError('generate_network_error', errMsg, { step: 'generate_network', generator: gen.id, stack: err.stack });
                removeTask(tempTaskId);
                showError(errMsg || 'Terjadi kesalahan jaringan. Coba lagi.');
                addToHistory(gen.name, 'FAILED', null, gen.outputType);
                return;
            }
            console.log(`[Moonray] Timeout/network error, will retry (${attempt + 1}/${MAX_RETRIES})...`);
        }
    }
}

// ==================== POLLING ====================
async function pollTask(task, gen) {
    const endpoint = gen.taskEndpoint || gen.endpoint;
    const pollUrl = API_BASE + endpoint + '/' + task.id;
    let attempts = 0;
    if (!task._failRetries) task._failRetries = 0;
    const MAX_FAIL_RETRIES = 2;
    const poll = async () => {
        if (attempts >= 360) { task.statusText = 'Timeout'; removeTask(task.id); addToHistory(task.genName, 'FAILED', null, task.outputType); toast(`⏰ Timeout: ${task.genName}`, 'error'); return; }
        attempts++;
        try {
            // ⚡ NATIVE HTTP POLL — via Capacitor native or fetch fallback
            const r = await freepikRequest(pollUrl, 'GET', state.apiKey, null);
            const data = r.data;
            const status = data?.data?.status || data?.status || '';
            const progress = data?.data?.progress || data?.progress || 0;
            task.progress = Math.min(95, Math.max(task.progress, progress, Math.round(Math.log(attempts + 1) * 20)));
            task.statusText = status === 'IN_QUEUE' ? 'Dalam antrian...' : status === 'IN_PROGRESS' ? `Processing... ${Math.round(task.progress)}%` : status;
            updateActiveTasksUI();
            if (status === 'COMPLETED' || status === 'completed') { removeTask(task.id); handleResult(data, task.outputType, task.genName); addToHistory(task.genName, 'COMPLETED', data, task.outputType); toast(`✅ ${task.genName} selesai!`, 'success'); }
            else if (status === 'FAILED' || status === 'failed' || status === 'ERROR') {
                console.error('[Moonray] Task FAILED — full response:', JSON.stringify(data));
                const errDetail = extractErrorDetail(data);
                // Jika tidak ada detail error dan belum max retry → coba poll ulang
                if (!errDetail && task._failRetries < MAX_FAIL_RETRIES) {
                    task._failRetries++;
                    console.log(`[Moonray] FAILED tanpa detail, retry poll ${task._failRetries}/${MAX_FAIL_RETRIES} dalam 10 detik...`);
                    task.statusText = `⏳ Retry ${task._failRetries}/${MAX_FAIL_RETRIES}... menunggu konfirmasi server`;
                    updateActiveTasksUI();
                    setTimeout(poll, 10000);
                } else {
                    reportError('poll_task_failed', errDetail || 'no detail', { step: 'poll_failed', generator: task.genId, apiResponse: JSON.stringify(data).substring(0, 300) });
                    removeTask(task.id);
                    const userMsg = errDetail || 'Gagal tanpa detail — kemungkinan: gambar ditolak content policy, URL file tidak bisa diakses server, atau server sedang bermasalah. Coba ganti gambar atau coba lagi.';
                    showError(`${task.genName} gagal: ${userMsg}`);
                    addToHistory(task.genName, 'FAILED', data, task.outputType);
                }
            }
            else { setTimeout(poll, 5000); }
        } catch (err) { console.warn('[Moonray] Poll error:', err); setTimeout(poll, 8000); }
    };
    setTimeout(poll, 3000);
}


function removeTask(taskId) { state.activeTasks = state.activeTasks.filter(t => t.id !== taskId); const btn = document.getElementById('generateBtn'); if (btn && state.activeTasks.length < RATE_LIMIT.maxConcurrent && Date.now() >= RATE_LIMIT.cooldownUntil) btn.disabled = false; renderContent(); }
function updateActiveTasksUI() { const area = document.getElementById('activeTasksArea'); if (!area) return; let html = ''; state.activeTasks.forEach(t => { html += buildTaskCardHtml(t); }); area.innerHTML = html; }
function buildTaskCardHtml(task) { const pct = Math.round(task.progress || 5); return `<div class="card" style="margin-bottom:8px;padding:10px 14px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px"><span style="font-size:12px;font-weight:600;color:var(--accent)"><span class="spinner" style="width:12px;height:12px;border-width:2px;vertical-align:middle;margin-right:4px"></span>${task.genName}</span><span style="font-size:11px;font-weight:600;color:var(--accent)">${pct}%</span></div><div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div><div style="font-size:10px;color:var(--text-muted);margin-top:3px">${task.statusText || 'Processing...'}</div></div>`; }

// ==================== RESULT ====================
function handleResult(data, passedOutputType, passedGenName) {
    const gen = GENERATORS[state.activeGenerator];
    const outputType = passedOutputType || gen?.outputType || 'video', genName = passedGenName || gen?.name || 'Result';
    let resultUrl = '';
    if (outputType === 'image') resultUrl = data.data?.generated?.[0] || data.data?.image?.url || data.data?.images?.[0]?.url || data.data?.result?.url || data.url || '';
    else if (outputType === 'audio') resultUrl = data.data?.generated?.[0] || data.data?.audio?.url || data.data?.result?.url || data.url || '';
    else resultUrl = data.data?.generated?.[0] || data.data?.video?.url || data.data?.output?.url || data.data?.result?.url || data.url || '';
    state.completedResults.unshift({ outputType, url: resultUrl, data, genName, timestamp: Date.now() });
    renderContent();
}

function showError(msg) { const area = document.getElementById('resultArea'); if (!area) return; const div = document.createElement('div'); div.innerHTML = `<div class="card" style="margin-top:10px;border-color:rgba(248,113,113,0.3)"><p style="color:var(--danger);font-size:13px">❌ ${msg}</p><button class="btn btn-secondary btn-sm" style="margin-top:8px" onclick="this.parentElement.remove()">Tutup</button></div>`; area.prepend(div); }

// ==================== HISTORY ====================
function addToHistory(genName, status, data, outputType) {
    let resultUrl = '';
    if (data) resultUrl = data.data?.generated?.[0] || data.data?.video?.url || data.data?.image?.url || data.data?.audio?.url || data.url || '';
    if (!resultUrl && status === 'COMPLETED' && state.completedResults.length > 0) resultUrl = state.completedResults[0]?.url || '';
    state.history.unshift({ generator: genName, status, outputType: outputType || 'video', timestamp: new Date().toISOString(), result: resultUrl });
    if (state.history.length > 50) state.history = state.history.slice(0, 50);
    localStorage.setItem('fpk_history', JSON.stringify(state.history));
}

function toggleHistory() {
    const dd = document.getElementById('historyDropdown');
    const isOpen = dd.style.display === 'block';
    dd.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
        let html = '';
        if (state.history.length === 0) html = '<div style="padding:12px;font-size:11px;color:var(--text-muted)">Belum ada history</div>';
        else state.history.slice(0, 20).forEach((h, i) => {
            const sc = h.status === 'COMPLETED' ? 'completed' : h.status === 'FAILED' ? 'failed' : 'processing';
            html += `<div class="history-item" onclick="viewHistory(${i})"><span class="history-dot ${sc}"></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h.generator}</span></div>`;
        });
        dd.innerHTML = html;
    }
}

function viewHistory(index) {
    const h = state.history[index]; if (!h) return;
    document.getElementById('historyDropdown').style.display = 'none';
    const area = document.getElementById('resultArea'); if (!area) return;
    if (h.result) {
        const oType = h.outputType || 'video'; let media = '', dl = 'moonray-result';
        if (oType === 'image') { media = `<img src="${h.result}" style="max-width:100%;border-radius:8px">`; dl = 'moonray-image.png'; }
        else if (oType === 'audio') { media = `<audio src="${h.result}" controls style="width:100%"></audio>`; dl = 'moonray-audio.mp3'; }
        else { media = `<video src="${h.result}" controls playsinline muted style="max-width:100%;border-radius:8px"></video>`; dl = 'moonray-video.mp4'; }
        area.innerHTML = `<div class="card" style="margin-top:12px"><h4 style="font-size:13px;margin-bottom:8px">📋 ${h.generator}</h4><p style="font-size:10px;color:var(--text-muted);margin-bottom:8px">${new Date(h.timestamp).toLocaleString()}</p>${media}<br><button class="btn btn-primary btn-sm" style="margin-top:6px" onclick="downloadFile('${h.result}','${dl}')">⬇️ Download</button></div>`;
    }
}

// ==================== DOWNLOAD ====================
async function downloadFile(url, filename) {
    if (!url) { toast('URL tidak tersedia', 'error'); return; }
    toast('📥 Membuka download...', 'info');
    try {
        // Buka URL langsung di browser external (Chrome/bawaan HP)
        // Browser bawaan handle download file apa saja tanpa batas ukuran
        if (_isCapacitorNative() && window.Capacitor) {
            // Capacitor: buka di browser external via Android Intent
            const a = document.createElement('a');
            a.href = url; a.target = '_system'; a.rel = 'noopener';
            document.body.appendChild(a); a.click();
            setTimeout(() => document.body.removeChild(a), 200);
        } else {
            window.open(url, '_blank');
        }
        toast('✅ Download dibuka di browser — cek folder Downloads HP', 'success');
    } catch (e) {
        console.warn('[Moonray] Download fallback:', e);
        window.open(url, '_blank');
        toast('📥 Download dibuka di browser', 'info');
    }
}

// ==================== TOAST ====================
function toast(message, type = 'info') { const container = document.getElementById('toasts'); const el = document.createElement('div'); el.className = `toast toast-${type}`; el.textContent = message; container.appendChild(el); setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 4000); }

// ==================== DISCLAIMER ====================
function openDisclaimer() { document.getElementById('disclaimerModal').classList.add('active'); }
function closeDisclaimer() { document.getElementById('disclaimerModal').classList.remove('active'); }
function acceptDisclaimer() { localStorage.setItem('fpk_disclaimer_accepted', 'true'); closeDisclaimer(); toast('Selamat menggunakan Moonray! 🎉', 'success'); }

// ==================== AUTH (Google Sheets) ====================
async function doLogin() {
    const email = document.getElementById('loginEmail').value.trim().toLowerCase();
    const errEl = document.getElementById('loginError');
    const btn = document.getElementById('loginBtn');
    errEl.textContent = '';

    if (!email) { errEl.textContent = 'Email wajib diisi'; return; }
    if (!AUTH_URL) { errEl.textContent = 'Auth belum dikonfigurasi (AUTH_URL kosong)'; return; }

    btn.disabled = true; btn.textContent = 'Memproses...';

    try {
        const deviceId = getDeviceId();
        const url = AUTH_URL + '?action=login&email=' + encodeURIComponent(email) + '&deviceId=' + encodeURIComponent(deviceId);
        const r = await fetch(url);
        const data = await r.json();

        if (data.status === 'SUKSES') {
            localStorage.setItem('mr_email', email);
            localStorage.setItem('mr_user', JSON.stringify({ email: data.email || email, name: data.nama || '' }));
            showApp();
        } else {
            errEl.textContent = data.message || 'Login gagal';
            reportError('login_rejected', data.message || 'Login gagal', { step: 'login' });
            btn.disabled = false; btn.textContent = 'Masuk';
        }
    } catch (e) {
        errEl.textContent = 'Tidak bisa terhubung. Cek koneksi internet.';
        reportError('login_network_error', e.message || 'fetch failed', { step: 'login_network', stack: e.stack });
        btn.disabled = false; btn.textContent = 'Masuk';
    }
}

async function doLogout() {
    const email = localStorage.getItem('mr_email');
    if (email && AUTH_URL) {
        try { await fetch(AUTH_URL + '?action=logout&email=' + encodeURIComponent(email)); } catch (e) { }
    }
    localStorage.removeItem('mr_email');
    localStorage.removeItem('mr_user');
    document.getElementById('loginScreen').classList.remove('hidden');
    document.querySelector('.app').style.display = 'none';
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginError').textContent = '';
}

function showApp() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.querySelector('.app').style.display = '';
    init();
    if (!localStorage.getItem('fpk_disclaimer_accepted') && state.apiKey) setTimeout(() => openDisclaimer(), 1500);
}

// Enter key on login
document.getElementById('loginEmail').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

// Close history on outside click
document.addEventListener('click', e => { if (!e.target.closest('.history-dropdown')) document.getElementById('historyDropdown').style.display = 'none'; });

// ==================== SESSION CHECK ====================
async function checkSession() {
    const email = localStorage.getItem('mr_email');
    if (!email) { document.querySelector('.app').style.display = 'none'; return; }
    if (!AUTH_URL) { showApp(); return; } // Allow if no auth configured

    try {
        const deviceId = getDeviceId();
        const url = AUTH_URL + '?action=cek&email=' + encodeURIComponent(email) + '&deviceId=' + encodeURIComponent(deviceId);
        const r = await fetch(url);
        const data = await r.json();

        if (data.status === 'VALID') { showApp(); }
        else {
            localStorage.removeItem('mr_email');
            localStorage.removeItem('mr_user');
            document.querySelector('.app').style.display = 'none';
            if (data.message) {
                setTimeout(() => { document.getElementById('loginError').textContent = data.message; }, 100);
            }
        }
    } catch {
        // Offline? Allow access anyway
        showApp();
    }
}

// ==================== START ====================
checkSession();
