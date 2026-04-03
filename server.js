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
  sleep: 'NARA Sleep inhaler lavender cedarwood vetiver chamomile purple moon icon deep relaxation.',
  focus: 'NARA Focus inhaler peppermint rosemary lemon eucalyptus green crosshair icon concentration.',
  glow: 'NARA Glow inhaler bergamot orange ylang ylang geranium gold sun icon uplifting mood.'
};
const PLATFORMS = {
  tiktok:'TikTok 9x16 vertical viral Gen-Z',
  instagram:'Instagram Reels 9x16 aesthetic lifestyle',
  facebook:'Facebook Ads 4x5 Malaysian adults 25-45',
  all:'TikTok Instagram Facebook Ads'
};

app.get('/', (req, res) => res.json({ status: 'NARA API running' }));

// Generate prompts
app.post('/generate-prompts', async (req, res) => {
  try {
    const { image, variant='all', platform='tiktok', styleHint='', seed=1234 } = req.body;
    const content = [];
    if (image) content.push({ type:'image', source:{ type:'base64', media_type:'image/jpeg', data:image } });
    content.push({ type:'text', text:'Product: '+(VARIANTS[variant]||VARIANTS.all)+' Platform: '+(PLATFORMS[platform]||PLATFORMS.tiktok)+' Style direction: '+styleHint+' Seed: '+seed+' Generate exactly 10 distinct video prompts for AI video tools. Each 60-80 words simple English.' });
    const msg = await anthropic.messages.create({
      model:'claude-sonnet-4-20250514', max_tokens:2000,
      system:'Return ONLY a valid JSON array with exactly 10 objects. No markdown no code blocks. Each: {"type":"max 4 words","platform":"platform","prompt":"60-80 words simple English no special characters"}',
      messages:[{ role:'user', content }]
    });
    let raw = msg.content.map(b=>b.text||'').join('').trim();
    raw = raw.replace(/```json/gi,'').replace(/```/g,'').trim();
    const s=raw.indexOf('['),e=raw.lastIndexOf(']');
    if(s!==-1&&e!==-1) raw=raw.substring(s,e+1);
    raw = raw.replace(/[\x00-\x1F\x7F]/g,' ');
    res.json({ success:true, prompts:JSON.parse(raw) });
  } catch(err) {
    console.error('Prompts error:',err.message);
    res.status(500).json({ success:false, error:err.message });
  }
});

// Generate video
app.post('/generate-video', async (req, res) => {
  try {
    const { image, prompt } = req.body;
    console.log('Starting video generation...');
    const imageBuffer = Buffer.from(image, 'base64');
    const imageFile = new Blob([imageBuffer], { type:'image/jpeg' });
    console.log('Uploading image via fal.storage...');
    const imageUrl = await fal.storage.upload(imageFile);
    console.log('Uploaded:', imageUrl);
    console.log('Submitting to minimax-video...');
    const result = await fal.subscribe('fal-ai/minimax-video/image-to-video', {
      input: { image_url:imageUrl, prompt:prompt, duration:5 },
      logs: true,
      onQueueUpdate:(update) => { console.log('Queue:',update.status); }
    });
    const videoUrl = result.data?.video?.url || result.video?.url;
    if(!videoUrl) throw new Error('No video URL in result: '+JSON.stringify(result).substring(0,200));
    console.log('Video ready:', videoUrl);
    res.json({ success:true, videoUrl });
  } catch(err) {
    console.error('Video error:',err.message);
    res.status(500).json({ success:false, error:err.message });
  }
});

// Generate image (commercial use)
app.post('/generate-image', async (req, res) => {
  try {
    const { prompt, imageSize='square_hd', refImage } = req.body;
    console.log('Generating commercial image...');
    let result;
    if (refImage) {
      // Image-to-image with reference
      const imgBuffer = Buffer.from(refImage, 'base64');
      const imgBlob = new Blob([imgBuffer], { type:'image/jpeg' });
      const refUrl = await fal.storage.upload(imgBlob);
      result = await fal.subscribe('fal-ai/flux/dev/image-to-image', {
        input: { prompt:prompt+', commercial product photography, 8k, ultra realistic', image_url:refUrl, strength:0.7, image_size:imageSize, num_images:1, enable_safety_checker:false },
        logs: true
      });
    } else {
      // Text-to-image
      result = await fal.subscribe('fal-ai/flux/dev', {
        input: { prompt:prompt+', commercial product photography, 8k, ultra realistic, studio quality', image_size:imageSize, num_images:1, enable_safety_checker:false },
        logs: true
      });
    }
    const imageUrl = result.data?.images?.[0]?.url || result.images?.[0]?.url;
    if(!imageUrl) throw new Error('No image URL: '+JSON.stringify(result).substring(0,200));
    console.log('Image ready:', imageUrl);
    res.json({ success:true, imageUrl });
  } catch(err) {
    console.error('Image error:',err.message);
    res.status(500).json({ success:false, error:err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('NARA backend running on port '+PORT));
