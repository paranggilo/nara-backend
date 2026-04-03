const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const { fal } = require('@fal-ai/client');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

fal.config({ credentials: process.env.FAL_API_KEY });

const VARIANTS = {
  all: 'NARA Inhaler 3 variants Sleep purple moon lavender cedarwood vetiver chamomile Focus green crosshair peppermint rosemary lemon eucalyptus Glow gold sun bergamot orange ylang ylang geranium. Matte black cylindrical inhaler keychain gold engraving. Premium Malaysian aromatherapy.',
  sleep: 'NARA Sleep inhaler lavender cedarwood vetiver chamomile. Purple gradient moon icon. Deep relaxation and sleep.',
  focus: 'NARA Focus inhaler peppermint rosemary lemon eucalyptus. Forest green crosshair icon. Concentration and clarity.',
  glow: 'NARA Glow inhaler bergamot orange ylang ylang geranium. Warm golden sun icon. Uplifting and mood-enhancing.'
};

const PLATFORMS = {
  tiktok: 'TikTok 9x16 vertical viral Gen-Z',
  instagram: 'Instagram Reels 9x16 aesthetic lifestyle',
  facebook: 'Facebook Ads 4x5 Malaysian adults 25 to 45',
  all: 'TikTok Instagram Reels Facebook Ads'
};

app.get('/', (req, res) => res.json({ status: 'NARA API running' }));

app.post('/generate-prompts', async (req, res) => {
  try {
    const { image, variant = 'all', platform = 'tiktok' } = req.body;
    const content = [];
    if (image) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } });
    content.push({ type: 'text', text: 'Product: ' + (VARIANTS[variant]||VARIANTS.all) + ' Platform: ' + (PLATFORMS[platform]||PLATFORMS.tiktok) + ' Generate exactly 10 distinct video prompts for AI video tools. Cover: cinematic hero morning routine office focus night sleep botanical closeup person inhaling flat lay emotional transformation luxury unboxing Malaysian lifestyle. Each 60-80 words simple English.' });

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: 'Return ONLY a valid JSON array with exactly 10 objects. No markdown no code blocks. Each: {"type":"max 4 words","platform":"platform","prompt":"60-80 words simple English no special characters"}',
      messages: [{ role: 'user', content }]
    });

    let raw = msg.content.map(b => b.text||'').join('').trim();
    raw = raw.replace(/```json/gi,'').replace(/```/g,'').trim();
    const s = raw.indexOf('['), e = raw.lastIndexOf(']');
    if(s!==-1&&e!==-1) raw = raw.substring(s,e+1);
    raw = raw.replace(/[\x00-\x1F\x7F]/g,' ');
    res.json({ success: true, prompts: JSON.parse(raw) });
  } catch(err) {
    console.error('Prompts error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/generate-video', async (req, res) => {
  try {
    const { image, prompt } = req.body;

    // Step 1: Upload guna fal-ai/client — cara betul
    console.log('Uploading image via @fal-ai/client...');
    const imageBuffer = Buffer.from(image, 'base64');
    const imageFile = new Blob([imageBuffer], { type: 'image/jpeg' });
    const imageUrl = await fal.storage.upload(imageFile);
    console.log('Uploaded:', imageUrl);

    // Step 2: Submit video job
    const result = await fal.subscribe('fal-ai/minimax-video/image-to-video', {
      input: { image_url: imageUrl, prompt: prompt, duration: 5 },
      logs: true,
      onQueueUpdate: (update) => {
        console.log('Queue status:', update.status);
      }
    });

    const videoUrl = result.data?.video?.url || result.video?.url;
    if (!videoUrl) throw new Error('No video URL: ' + JSON.stringify(result).substring(0,200));

    console.log('Video ready:', videoUrl);
    res.json({ success: true, videoUrl });
  } catch(err) {
    console.error('Video error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('NARA backend running on port ' + PORT));
