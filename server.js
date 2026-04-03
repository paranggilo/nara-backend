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
  all: 'NARA Inhaler 3 variants: Sleep (purple moon, lavender cedarwood vetiver chamomile), Focus (green crosshair, peppermint rosemary lemon eucalyptus), Glow (gold sun, bergamot orange ylang ylang geranium). Matte black cylindrical inhaler with keychain, gold engraving. Premium Malaysian aromatherapy.',
  sleep: 'NARA Sleep inhaler. Purple gradient with moon icon. Scent: lavender, cedarwood, vetiver, chamomile. For deep relaxation and better sleep.',
  focus: 'NARA Focus inhaler. Forest green with crosshair icon. Scent: peppermint, rosemary, lemon, eucalyptus. For concentration and mental clarity.',
  glow: 'NARA Glow inhaler. Warm gold with sun icon. Scent: bergamot, orange, ylang ylang, geranium. For uplifting mood and positive energy.'
};

app.get('/', (req, res) => res.json({ status: 'NARA API running' }));

// Generate prompts
app.post('/generate-prompts', async (req, res) => {
  try {
    const { image, variant='all', platform='tiktok', count=5, styleHint='', seed=1234 } = req.body;
    const n = Math.min(Math.max(parseInt(count)||5, 1), 10);
    const content = [];
    if (image) content.push({ type:'image', source:{ type:'base64', media_type:'image/jpeg', data:image }});
    content.push({ type:'text', text: `Product: ${VARIANTS[variant]||VARIANTS.all}
Platform: ${platform}
Style direction: ${styleHint||'varied creative angles'}
Seed for variation: ${seed}
Generate exactly ${n} distinct, creative video prompts for AI image-to-video tools.
Each prompt should be 60-80 words describing specific camera movement, lighting, scene, mood, and action.
Make them varied and different from each other.
No repeated angles.` });

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2500,
      system: `Return ONLY a valid JSON array with exactly ${n} objects. No markdown, no code blocks, no explanation.
Each object must have: {"type":"short label max 4 words","platform":"${platform}","prompt":"60-80 words, simple English, no quotes, no special characters, no apostrophes"}`,
      messages: [{ role:'user', content }]
    });

    let raw = msg.content.map(b => b.text||'').join('').trim();
    raw = raw.replace(/```json/gi,'').replace(/```/g,'').trim();
    const s = raw.indexOf('['), e = raw.lastIndexOf(']');
    if (s !== -1 && e !== -1) raw = raw.substring(s, e+1);
    raw = raw.replace(/[\x00-\x1F\x7F]/g,' ');
    res.json({ success:true, prompts: JSON.parse(raw) });
  } catch(err) {
    console.error('Prompts error:', err.message);
    res.status(500).json({ success:false, error: err.message });
  }
});

// Generate video using fal-ai/client
app.post('/generate-video', async (req, res) => {
  try {
    const { image, prompt } = req.body;
    console.log('Video: uploading image...');
    const buf = Buffer.from(image, 'base64');
    const blob = new Blob([buf], { type:'image/jpeg' });
    const imageUrl = await fal.storage.upload(blob);
    console.log('Video: image uploaded -', imageUrl);

    console.log('Video: submitting job...');
    const result = await fal.subscribe('fal-ai/minimax-video/image-to-video', {
      input: { image_url: imageUrl, prompt: prompt, duration: 5 },
      logs: true,
      onQueueUpdate: (u) => console.log('Queue:', u.status)
    });

    const videoUrl = result.data?.video?.url || result.video?.url;
    if (!videoUrl) throw new Error('No video URL: ' + JSON.stringify(result).substring(0,300));
    console.log('Video ready:', videoUrl);
    res.json({ success:true, videoUrl });
  } catch(err) {
    console.error('Video error:', err.message);
    res.status(500).json({ success:false, error: err.message });
  }
});

// Generate image using flux-pro (better prompt following)
app.post('/generate-image', async (req, res) => {
  try {
    const { prompt, imageSize='square_hd', refImage } = req.body;
    console.log('Image: generating with flux-pro...');
    console.log('Prompt:', prompt.substring(0,100));

    let result;
    if (refImage) {
      const buf = Buffer.from(refImage, 'base64');
      const blob = new Blob([buf], { type:'image/jpeg' });
      const refUrl = await fal.storage.upload(blob);
      // Use flux-pro with image reference
      result = await fal.subscribe('fal-ai/flux-pro/v1.1', {
        input: {
          prompt: prompt,
          image_size: imageSize,
          num_images: 1,
          safety_tolerance: '5',
          output_format: 'jpeg'
        },
        logs: true
      });
    } else {
      result = await fal.subscribe('fal-ai/flux-pro/v1.1', {
        input: {
          prompt: prompt,
          image_size: imageSize,
          num_images: 1,
          safety_tolerance: '5',
          output_format: 'jpeg'
        },
        logs: true
      });
    }

    const imageUrl = result.data?.images?.[0]?.url || result.images?.[0]?.url;
    if (!imageUrl) throw new Error('No image: ' + JSON.stringify(result).substring(0,300));
    console.log('Image ready:', imageUrl);
    res.json({ success:true, imageUrl });
  } catch(err) {
    console.error('Image error:', err.message);
    res.status(500).json({ success:false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('NARA backend on port ' + PORT));
