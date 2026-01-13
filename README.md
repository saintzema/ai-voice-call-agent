# Local AI Voice Calling Agent

A Node.js server that handles Twilio voice calls with optional local AI pipeline (Whisper STT + Ollama LLM + Piper TTS). Includes a simple demo using Twilio's built-in TTS.

## Demo vs Full AI Version

- **Demo Version**: Uses Twilio `Say` verb (cloud TTS). Works immediately for videos/demos.
- **Full AI Version**: Local Whisper + Ollama + Piper. Requires additional setup (see Advanced section).

## Quick Demo (Works Out of the Box)

1. **Install Node.js dependencies**
   ```bash
   npm install
   ```

2. **Configure environment**
   Copy `.env.example` to `.env` and fill in:
   ```env
   TWILIO_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH=your_auth_token
   NGROK_HOST=your-ngrok-id.ngrok.io
   VERIFIED_NUMBER=+1234567890
   ```

3. **Start server**
   ```bash
   node --env-file=.env setup.js
   ```

4. **Expose with ngrok**
   ```bash
   ngrok http 3000
   ```
   Copy the `https://....ngrok.io` URL to `NGROK_HOST` in `.env`.

5. **Configure Twilio**
   - Voice webhook: `https://your-ngrok-id.ngrok.io/voice`
   - Status callback: `https://your-ngrok-id.ngrok.io/status`
   - Accept HTTP method

6. **Call your Twilio number**
   You'll hear: "Hello, how can I help you today?" (10s pause) "Okay thanks for reaching out to us. What would you like to order today?"

## Customizing the Demo Script

Edit the `/voice` route in `setup.js`:
```javascript
app.post('/voice', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: 'Polly.Joanna' }, 'Your custom greeting here');
  twiml.pause({ length: 5 });
  twiml.say({ voice: 'Polly.Joanna' }, 'Your custom message here');
  res.type('text/xml');
  res.send(twiml.toString());
});
```

## Platform-Specific Setup

### macOS
1. **Install Homebrew** (if not installed)
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

2. **Install Node.js**
   ```bash
   brew install node
   ```

3. **Install ngrok**
   ```bash
   brew install ngrok
   ```

4. **Verify installation**
   ```bash
   node --version
   ngrok version
   ```

### Windows
1. **Install Node.js**
   - Download from https://nodejs.org
   - Use Windows Installer (.msi)

2. **Install ngrok**
   - Download from https://ngrok.com/download
   - Extract and add to PATH, or use `choco install ngrok`

3. **Verify installation**
   ```cmd
   node --version
   ngrok version
   ```

## Twilio Setup

1. **Create Account**
   - Sign up at https://www.twilio.com/try-twilio
   - Get a trial phone number

2. **Get Credentials**
   - Account SID: Console → Settings → General
   - Auth Token: Console → Settings → API Keys → Create API Key

3. **Configure Webhooks**
   - Active Number → Configure → Voice & Fax
   - A CALL COMES IN → Webhook → `https://your-ngrok-id.ngrok.io/voice`
   - Status callback → `https://your-ngrok-id.ngrok.io/status`
   - HTTP Method: POST

4. **Verify Phone Number**
   - Add your phone number in Console → Verified Caller IDs
   - Required for making test calls

## Full AI Version (Advanced)

For local AI processing (Whisper + Ollama + Piper):

### Prerequisites
- Python 3.9+
- 8GB+ RAM recommended
- 2GB+ disk space for models

### macOS Setup
```bash
# Install Whisper
pip install openai-whisper

# Install Ollama
brew install ollama
ollama serve
ollama pull llama3.2:latest

# Install Piper TTS
pip install piper-tts
# Download voice model
mkdir -p models
curl -L -o models/en_US-amy-low.onnx https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/low/en_US-amy-low.onnx
curl -L -o models/en_US-amy-low.onnx.json https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/low/en_US-amy-low.onnx.json
```

### Windows Setup
```cmd
# Install Whisper
pip install openai-whisper

# Install Ollama
winget install Ollama.Ollama
ollama serve
ollama pull llama3.2:latest

# Install Piper TTS
pip install piper-tts
# Download models manually from https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/amy/low
```

### Enable AI Pipeline
1. Set environment variables in `.env`:
   ```env
   WHISPER_BIN=whisper
   OLLAMA_BIN=ollama
   OLLAMA_MODEL=llama3.2:latest
   PIPER_BIN=piper
   PIPER_MODEL=/path/to/models/en_US-amy-low.onnx
   ```

2. **Switch to AI version** in `setup.js`:
   - Uncomment the WebSocket media stream section
   - Comment out the simple `Say` demo version

## Troubleshooting

### Common Issues
1. **ngrok URL not working**
   - Ensure ngrok is running on port 3000
   - Copy the HTTPS URL (not HTTP)

2. **Twilio webhook errors**
   - Check URL is correct and accessible
   - Verify HTTP method is POST
   - Check Twilio Debugger for errors

3. **No audio in demo**
   - Verify `.env` is loaded correctly
   - Check terminal logs for errors

4. **Whisper timeouts**
   - Reduce audio buffer size in code
   - Use faster-whisper instead
   - Switch to OpenAI Whisper API

### Debug Mode
Add logging to see TwiML responses:
```javascript
console.log('TwiML Response:', twiml.toString());
```

## File Structure
```
voice-agent/
├── setup.js              # Main server file
├── .env                  # Environment variables
├── .env.example          # Template for .env
├── models/               # Piper TTS models (AI version)
├── greeting8k.wav       # Demo audio files
├── followup8k.wav
└── README.md            # This file
```

## Support

- **Demo Version**: Works immediately for videos and basic demos
- **Full AI Version**: For production use with local AI processing
- **Email**: techzema@gmail.com for complete AI version setup assistance

## License

MIT License - feel free to use for commercial projects.
