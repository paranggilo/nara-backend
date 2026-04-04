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
  all: 'NARA Inhaler 3 variants: Sleep (purple moon icon, lavender cedarwood vetiver chamomile), Focus (green crosshair icon, peppermint rosemary lemon eucalyptus), Glow (gold sun icon, bergamot orange ylang ylang geranium). Matte black cylindrical inhaler with keychain, gold engraving. Premium Malaysian aromatherapy brand.',
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
Style focus: ${styleHint||'varied creative angles'}
Variation seed: ${seed}
Generate exactly ${n} distinct creative video prompts for AI image-to-video.
Each 60-80 words: describe camera movement, lighting, scene setting, mood, and subject action.
Make them varied - no repeated angles.` });

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 2500,
      system: `Return ONLY a JSON array with exactly ${n} objects. No markdown, no code blocks.
Each: {"type":"label max 4 words","platform":"${platform}","prompt":"60-80 words simple English no quotes no apostrophes no special characters"}`,
      messages: [{ role:'user', content }]
    });
    let raw = msg.content.map(b=>b.text||'').join('').trim();
    raw = raw.replace(/```json/gi,'').replace(/```/g,'').trim();
    const s=raw.indexOf('['),e=raw.lastIndexOf(']');
    if(s!==-1&&e!==-1) raw=raw.substring(s,e+1);
    raw = raw.replace(/[\x00-\x1F\x7F]/g,' ');
    res.json({ success:true, prompts:JSON.parse(raw) });
  } catch(err) {
    console.error('Prompts error:', err.message);
    res.status(500).json({ success:false, error:err.message });
  }
});

// Generate video
app.post('/generate-video', async (req, res) => {
  try {
    const { image, prompt } = req.body;
    console.log('Video: uploading image...');
    const buf = Buffer.from(image, 'base64');
    const blob = new Blob([buf], { type:'image/jpeg' });
    const imageUrl = await fal.storage.upload(blob);
    console.log('Video: image uploaded -', imageUrl);
    const result = await fal.subscribe('fal-ai/minimax-video/image-to-video', {
      input: { image_url: imageUrl, prompt: prompt, duration: 5 },
      logs: true,
      onQueueUpdate: (u) => console.log('Queue:', u.status)
    });
    const videoUrl = result.data?.video?.url || result.video?.url;
    if (!videoUrl) throw new Error('No video URL: ' + JSON.stringify(result).substring(0,200));
    res.json({ success:true, videoUrl });
  } catch(err) {
    console.error('Video error:', err.message);
    res.status(500).json({ success:false, error:err.message });
  }
});

// Generate image - dengan proper image reference support
app.post('/generate-image', async (req, res) => {
  try {
    const { prompt, imageSize='square_hd', refImage } = req.body;
    console.log('Image: prompt =', prompt.substring(0,100));
    console.log('Image: has reference =', !!refImage);

    let result;

    if (refImage) {
      // Ada gambar reference - guna flux-kontext yang dibina khas untuk image editing
      console.log('Image: uploading reference...');
      const refBuf = Buffer.from(refImage, 'base64');
      const refBlob = new Blob([refBuf], { type:'image/jpeg' });
      const refUrl = await fal.storage.upload(refBlob);
      console.log('Image: reference uploaded -', refUrl);

      // flux-kontext - model terbaik untuk image-to-image, maintain product appearance
      result = await fal.subscribe('fal-ai/flux-pro/kontext', {
        input: {
          prompt: prompt,
          image_url: refUrl,
          image_size: imageSize,
          num_images: 1,
          guidance_scale: 3.5,
          output_format: 'jpeg'
        },
        logs: true,
        onQueueUpdate: (u) => console.log('Kontext queue:', u.status)
      });
      console.log('Kontext result keys:', Object.keys(result.data || result));
    } else {
      // Text-to-image - guna flux-pro
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
    if (!imageUrl) throw new Error('No image URL. Result: ' + JSON.stringify(result).substring(0,300));
    console.log('Image ready:', imageUrl);
    res.json({ success:true, imageUrl });

  } catch(err) {
    console.error('Image error:', err.message);
    // Fallback: cuba flux/dev/image-to-image
    if (req.body.refImage) {
      try {
        console.log('Trying fallback: flux/dev/image-to-image...');
        const refBuf = Buffer.from(req.body.refImage, 'base64');
        const refBlob = new Blob([refBuf], { type:'image/jpeg' });
        const refUrl = await fal.storage.upload(refBlob);
        const fallback = await fal.subscribe('fal-ai/flux/dev/image-to-image', {
          input: {
            prompt: req.body.prompt,
            image_url: refUrl,
            strength: 0.8,
            image_size: req.body.imageSize || 'square_hd',
            num_images: 1,
            num_inference_steps: 28
          },
          logs: true
        });
        const fbUrl = fallback.data?.images?.[0]?.url || fallback.images?.[0]?.url;
        if (fbUrl) {
          console.log('Fallback success:', fbUrl);
          return res.json({ success:true, imageUrl: fbUrl, note:'Used fallback model' });
        }
      } catch(fbErr) {
        console.error('Fallback also failed:', fbErr.message);
      }
    }
    res.status(500).json({ success:false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('NARA backend on port ' + PORT));
