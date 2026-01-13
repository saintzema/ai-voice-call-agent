const express = require('express');
const { WebSocketServer } = require('ws');
const twilio = require('twilio');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const FormData = require('form-data');
const fetch = require('node-fetch');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const accountSid = process.env.TWILIO_SID;
const authToken  = process.env.TWILIO_AUTH;
const twilioClient = twilio(accountSid, authToken);

// 1) Voice webhook: return TwiML with Say for demo
app.post('/voice', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: 'Polly.Joanna' }, 'Hello, how can I help you today?');
  twiml.pause({ length: 5 });
  twiml.say({ voice: 'Polly.Joanna' }, 'Okay. thanks for reaching out to us. What would you like to order today?');
  twiml.pause({ length: 5 });
  twiml.say({ voice: 'Polly.Joanna' }, 'Got it. Is that for delivery or pickup?');
  twiml.pause({ length: 5 });
  twiml.say({ voice: 'Polly.Joanna' }, 'Great! What\'s your address?');
  twiml.pause({ length: 5});
  twiml.say({ voice: 'Polly.Joanna'}, 'Perfect. Your order will arrive in about 30 minutes. Anything else?')
  twiml.pause({ length: 3})
  twiml.say({ voice: 'Polly.Joanna'}, 'Thanks for your order! Have a great day!');
  res.type('text/xml');
  res.send(twiml.toString());
});

// 2) Status callback: detect missed/short calls, send follow-up
app.post('/status', async (req, res) => {
  const { CallStatus, To, CallDuration } = req.body;
  if (['no-answer', 'busy', 'failed'].includes(CallStatus) || (CallDuration && Number(CallDuration) < 10)) {
    try {
      await twilioClient.messages.create({
        from: To,                         // your Twilio trial number
        to: process.env.VERIFIED_NUMBER,  // your verified phone
        body: 'Sorry we missed you—reply with your name/order.'
      });
    } catch (e) {
      console.error('Follow-up SMS failed:', e.message);
    }
  }
  res.sendStatus(200);
});

// 3) WebSocket for media stream
const wss = new WebSocketServer({ noServer: true });

// Pre-load demo audio files (8kHz µ-law)
let greetingMulaw, followupMulaw;
try {
  greetingMulaw = fs.readFileSync(path.join(__dirname, 'greeting8k.wav'));
  followupMulaw = fs.readFileSync(path.join(__dirname, 'followup8k.wav'));
  console.log('Loaded demo audio files (8kHz µ-law)');
} catch (e) {
  console.warn('Demo audio files not found; will use silence');
  greetingMulaw = Buffer.alloc(3200);
  followupMulaw = Buffer.alloc(3200);
}

// Generate a simple 440Hz tone at 8kHz µ-law (1 second)
function generateTone() {
  const sampleRate = 8000;
  const duration = 1;
  const freq = 440;
  const samples = sampleRate * duration;
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const sample = Math.sin(2 * Math.PI * freq * i / sampleRate) * 0.3;
    const int16 = Math.round(sample * 32767);
    pcm.writeInt16LE(int16, i * 2);
  }
  return encodePCM16ToMulaw(pcm);
}

wss.on('connection', (ws, req) => {
  console.log('WebSocket connected from', req?.headers?.['x-forwarded-for'] || 'unknown');
  const state = { transcript: [], extracted: {}, lastReply: 0, step: 'greeting' };

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log('WS event:', msg.event);

      if (msg.event === 'start') {
        state.callSid = msg.start.callSid;
        console.log('Media stream start', state.callSid);
        // Send a test tone
        setTimeout(() => {
          console.log('Sending test tone');
          sendMulawFrame(ws, generateTone());
        }, 500);
        state.step = 'awaiting_speech';
        return;
      }

      if (msg.event === 'media') {
        // Simple demo: ignore audio, just reply after a delay
        const now = Date.now();
        if (!state.lastReply || now - state.lastReply > 5000) {
          state.lastReply = now;
          if (state.step === 'awaiting_speech') {
            console.log('Sending followup');
            sendMulawFrame(ws, followupMulaw);
            state.step = 'done';
          }
        }
      }

      if (msg.event === 'stop') {
        console.log('Media stream stop', state.callSid);
        // Persist transcript/state to file for demo
        const logPath = path.join(os.tmpdir(), `call-${state.callSid || 'unknown'}.json`);
        fs.writeFileSync(logPath, JSON.stringify({
          callSid: state.callSid,
          transcript: state.transcript,
          extracted: state.extracted,
          timestamp: new Date().toISOString()
        }, null, 2));
      }
    } catch (e) {
      console.error('WS message error:', e);
    }
  });

  ws.on('close', () => {
    console.log('WS closed for', state.callSid || 'unknown');
  });
});

// Upgrade HTTP -> WS for /media
const server = app.listen(3000, () => console.log('Server on 3000'));
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/media') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

// --------- Helpers ---------

function decodeMulawToPCM16(mulawBuf) {
  // Simple µ-law decode lookup
  const MULAW_MAX = 0x1FFF;
  const MULAW_BIAS = 33;
  const pcm = Buffer.alloc(mulawBuf.length * 2);
  for (let i = 0; i < mulawBuf.length; i++) {
    let uval = ~mulawBuf[i];
    let t = ((uval & 0x0F) << 3) + MULAW_BIAS;
    t <<= ((uval & 0x70) >> 4);
    const sign = (uval & 0x80) ? -1 : 1;
    const sample = sign * t;
    pcm.writeInt16LE(sample, i * 2);
  }
  return pcm;
}

function encodePCM16ToMulaw(pcm16) {
  const MULAW_BIAS = 0x84;
  const clip = 32635;
  const out = Buffer.alloc(pcm16.length / 2);
  for (let i = 0, j = 0; i < pcm16.length; i += 2, j++) {
    let sample = pcm16.readInt16LE(i);
    let sign = (sample >> 8) & 0x80;
    if (sign) sample = -sample;
    if (sample > clip) sample = clip;
    sample = sample + MULAW_BIAS;
    let exponent = Math.floor(Math.log(sample) / Math.log(2));
    let mantissa = (sample >> (exponent - 3)) & 0x0F;
    let mu = ~(sign | ((exponent - 5) << 4) | mantissa);
    out[j] = mu;
  }
  return out;
}

async function transcribePcm16(pcm16) {
  const tmpWav = path.join(os.tmpdir(), `stt-${crypto.randomUUID()}.wav`);
  try {
    const wav = pcmToWav(pcm16, 8000);
    fs.writeFileSync(tmpWav, wav);
    const formData = new FormData();
    formData.append('file', fs.createReadStream(tmpWav), 'audio.wav');
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');
    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: formData
    });
    const data = await resp.json();
    console.log('OpenAI Whisper output:', data.text);
    return data.text || '';
  } catch (e) {
    console.error('OpenAI Whisper error:', e);
    return '';
  } finally {
    safeUnlink(tmpWav);
  }
}

async function generateReply(state) {
  const prompt = buildPrompt(state);
  // Try Ollama
  try {
    const bin = process.env.OLLAMA_BIN || 'ollama';
    const model = process.env.OLLAMA_MODEL || 'llama3:8b';
    const out = await execPromise(bin, ['run', model], 8000, prompt);
    const text = out.trim();
    if (text) return text;
  } catch (e) {}
  // Fallback
  return 'I’ve noted your request. Anything else?';
}

async function synthesizeMulaw(text) {
  // Piper TTS -> WAV -> mulaw
  const tmpWav = path.join(os.tmpdir(), `tts-${crypto.randomUUID()}.wav`);
  try {
    const bin = process.env.PIPER_BIN || 'piper';
    const modelPath = process.env.PIPER_MODEL || ''; // e.g., /path/to/en_US-amy-low.onnx
    if (!modelPath) {
      console.warn('PIPER_MODEL not set; skipping TTS');
      return Buffer.alloc(0);
    }
    console.log('Running Piper:', bin, '--model', modelPath, '--output_file', tmpWav, 'text:', text);
    await execPromise(bin, ['--model', modelPath, '--output_file', tmpWav], 30_000, text);
    const wav = fs.readFileSync(tmpWav);
    const pcm16 = wavToPcm(wav);
    return encodePCM16ToMulaw(pcm16);
  } catch (e) {
    console.error('TTS error:', e);
    return Buffer.alloc(0);
  } finally {
    safeUnlink(tmpWav);
  }
}

function sendMulawFrame(ws, mulawBuffer) {
  // Twilio expects ~160ms (1280 bytes) chunks at 8kHz µ-law
  const chunkSize = 1280;
  console.log('sendMulawFrame: total bytes', mulawBuffer.length);
  for (let i = 0; i < mulawBuffer.length; i += chunkSize) {
    const chunk = mulawBuffer.subarray(i, i + chunkSize);
    const payload = chunk.toString('base64');
    const msg = { event: 'media', media: { payload } };
    console.log('Sending chunk', i, 'size', chunk.length);
    ws.send(JSON.stringify(msg));
  }
}

function buildPrompt(state) {
  const lastUser = [...state.transcript].reverse().find(t => t.from === 'user')?.text || '';
  const summary = `Collected: name=${state.extracted.name||'?'}, intent=${state.extracted.intent||'?'}, items=${(state.extracted.items||[]).join(';')||'?'}, contact=${state.extracted.contact||'?'}`;
  return `You are a concise phone agent. Keep replies under 2 sentences.\n${summary}\nUser said: ${lastUser}\nReply:`;
}

function updateExtracted(state, text) {
  if (!text) return;
  const lower = text.toLowerCase();
  const nameMatch = text.match(/\b(?:i am|i'm|name is)\s+([A-Z][a-z]+)\b/i);
  if (nameMatch) state.extracted.name = nameMatch[1];
  const phoneMatch = text.match(/(\+?\d[\d\-\s]{7,}\d)/);
  if (phoneMatch) state.extracted.contact = phoneMatch[1];
  if (lower.includes('order') || lower.includes('buy')) state.extracted.intent = 'order';
  if (lower.includes('inquiry') || lower.includes('question')) state.extracted.intent = 'inquiry';
  const itemMatch = text.match(/\b(\d+)\s*x\s*([A-Za-z0-9\s]+)/);
  if (itemMatch) {
    const qty = itemMatch[1];
    const item = itemMatch[2].trim();
    state.extracted.items = state.extracted.items || [];
    state.extracted.items.push(`${qty}x ${item}`);
  }
}

function pcmToWav(pcmBuf, sampleRate) {
  const byteRate = sampleRate * 2;
  const blockAlign = 2;
  const dataSize = pcmBuf.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20);  // PCM format
  header.writeUInt16LE(1, 22);  // channels
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmBuf]);
}

function wavToPcm(wavBuf) {
  // naive: skip 44-byte header
  if (wavBuf.length <= 44) return Buffer.alloc(0);
  return wavBuf.subarray(44);
}

function safeUnlink(p) {
  try { fs.unlinkSync(p); } catch {}
}

function execPromise(cmd, args, timeoutMs = 10000, stdin = '') {
  return new Promise((resolve, reject) => {
    const ps = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    if (stdin) ps.stdin.write(stdin);
    ps.stdin.end();
    ps.stdout.on('data', d => out += d.toString());
    ps.stderr.on('data', d => err += d.toString());
    const t = setTimeout(() => {
      ps.kill('SIGKILL');
      reject(new Error(`Timeout running ${cmd}: ${err}`));
    }, timeoutMs);
    ps.on('close', code => {
      clearTimeout(t);
      if (code === 0) resolve(out);
      else reject(new Error(`Command ${cmd} exited ${code}: ${err}`));
    });
  });
}