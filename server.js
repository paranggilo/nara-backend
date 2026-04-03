const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const VARIANT_INFO = {
  all: 'NARA Inhaler set of 3: Sleep (lavender,cedarwood,vetiver,chamomile - purple moon), Focus (peppermint,rosemary,lemon,eucalyptus - green crosshair), Glow (bergamot,orange,ylang ylang,geranium - gold sun). Matte black cylindrical inhaler with keychain, gold engraving. Premium Malaysian aromatherapy.',
  sleep: 'NARA Sleep inhaler - lavender, cedarwood, vetiver, chamomile. Purple gradient with moon icon. Deep relaxation and sleep.',
  focus: 'NARA Focus inhaler - peppermint, rosemary, lemon, eucalyptus. Forest green with crosshair icon. Concentration and clarity.',
  glow: 'NARA Glow inhaler - bergamot, orange, ylang ylang, geranium. Warm golden with sun icon. Uplifting and mood-enhancing.'
};

const PLATFORM_INFO = {
  tiktok: 'TikTok 9:16 vertical 5-15s viral Gen-Z',
  instagram: 'Instagram Reels 9:16 aesthetic premium lifestyle',
  facebook: 'Facebook Ads 4:5 direct response Malaysian adults 25-45',
  all: 'TikTok Instagram Reels and Facebook Ads'
};

app.get('/', (req, res) => {
  res.json({ status: 'NARA API running' });
});

app.post('/generate-prompts', async (req, res) => {
  try {
    const { image, variant = 'all', platform = 'tiktok' } = req.body;

    const content = [];
    if (image) {
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } });
    }
    content.push({
      type: 'text',
      text: 'Product: ' + (VARIANT_INFO[variant] || VARIANT_INFO.all) + ' Platform: ' + (PLATFORM_INFO[platform] || PLATFORM_INFO.tiktok) + ' Generate 10 distinct video prompts for Kling AI image-to-video. Cover: cinematic hero, morning routine, office focus, night sleep, botanical closeup, person inhaling, flat lay, emotional transformation, luxury unboxing, Malaysian lifestyle. Each 80-100 words describing camera, lighting, scene, mood.'
    });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: 'You are a video marketing expert for Malaysian wellness products. Return ONLY a valid JSON array with exactly 10 objects. No markdown, no code blocks, no preamble. Each object must have exactly these keys: type (short label max 5 words), platform (platform name), prompt (60-80 words, no special characters, no quotes inside the text, use simple English only).',
      messages: [{ role: 'user', content }]
    });

    let raw = message.content.map(b => b.text || '').join('');
    
    // Clean the response aggressively
    raw = raw.trim();
    // Remove markdown code blocks if present
    raw = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    // Find JSON array
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start !== -1 && end !== -1) {
      raw = raw.substring(start, end + 1);
    }
    // Remove control characters that break JSON
    raw = raw.replace(/[\x00-\x1F\x7F]/g, ' ');
    
    const prompts = JSON.parse(raw);
    res.json({ success: true, prompts });

  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/generate-video', async (req, res) => {
  try {
    const { image, prompt } = req.body;
    const fetch = require('node-fetch');

    const uploadRes = await fetch('https://rest.alpha.fal.ai/storage/upload/base64', {
      method: 'POST',
      headers: { 'Authorization': 'Key ' + process.env.FAL_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: image, content_type: 'image/jpeg', file_name: 'nara.jpg' })
    });
    const uploadData = await uploadRes.json();
    const imageUrl = uploadData.url;

    const submitRes = await fetch('https://queue.fal.run/fal-ai/minimax-video/image-to-video', {
      method: 'POST',
      headers: { 'Authorization': 'Key ' + process.env.FAL_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: imageUrl, prompt: prompt, duration: 5 })
    });
    const submitData = await submitRes.json();
    const requestId = submitData.request_id;

    for (let i = 0; i < 24; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const statusRes = await fetch('https://queue.fal.run/fal-ai/minimax-video/image-to-video/requests/' + requestId, {
        headers: { 'Authorization': 'Key ' + process.env.FAL_API_KEY }
      });
      const statusData = await statusRes.json();
      if (statusData.status === 'COMPLETED') {
        return res.json({ success: true, videoUrl: statusData.output?.video?.url });
      }
      if (statusData.status === 'FAILED') throw new Error('Video generation failed');
    }
    res.status(408).json({ success: false, error: 'Timeout' });
  } catch (err) {
    console.error('Video error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
