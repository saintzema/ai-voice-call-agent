import sys, asyncio
from faster_whisper import WhisperModel
async def main():
    model = WhisperModel("base.en", compute_type="int8")
    segments, _ = await model.transcribe(sys.argv[1], language="en")
    text = " ".join(s.text for s in segments)
    print(text)
asyncio.run(main())