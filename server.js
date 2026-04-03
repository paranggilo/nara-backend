const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const VARIANT_INFO = {
  all: 'NARA Inhaler set of 3 variants: Sleep (lavender, cedarwood, vetiver, chamomile - purple moon design), Focus (peppermint, rosemary, lemon, eucalyptus - green crosshair design), Glow (bergamot, orange, ylang ylang, geranium - gold sun design). Matte black cylindrical inhaler with keychain ring and gold engraving. Premium Malaysian aromatherapy brand.',
  sleep: 'NARA Sleep inhaler - lavender, cedarwood, vetiver, chamomile. Purple gradient with crescent moon icon. Deep relaxation and quality sleep.',
  focus: 'NARA Focus inhaler - peppermint, rosemary, lemon, eucalyptus. Forest green with crosshair icon. Concentration and mental clarity.',
  glow: 'NARA Glow inhaler - bergamot, orange, ylang ylang, geranium. Warm golden design with sun icon. Uplifting and mood-enhancing.'
};

const PLATFORM_INFO = {
  tiktok: 'TikTok (9:16 vertical, 5-15s, viral/trending, Gen-Z/millennial)',
  instagram: 'Instagram Reels (9:16, aesthetic, premium lifestyle)',
  facebook: 'Facebook Ads (4:5, direct response, Malaysian adults 25-45)',
  all: 'TikTok, Instagram Reels and Facebook Ads'
};

// ─── Step 1: Generate 10 prompts ───────────────────────────────
app.post('/generate-prompts', async (req, res) => {
  try {
    const { image, variant = 'all', platform = 'tiktok' } = req.body;

    const content = [];

    if (image) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: image }
      });
    }

    content.push({
      type: 'text',
      text: `Product: ${VARIANT_INFO[variant] || VARIANT_INFO.all}
Platform: ${PLATFORM_INFO[platform] || PLATFORM_INFO.tiktok}
Generate 10 distinct video prompts for Kling AI / fal.ai image-to-video. Vary scene, mood, angle, target emotion. Cover: cinematic hero, morning routine, office/focus, night sleep, botanical close-up, person inhaling, flat lay motion, emotional transformation, luxury unboxing, Malaysian lifestyle. Each prompt 80-100 words describing camera movement, lighting, scene, mood.`
    });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: 'You are a video marketing strategist for premium Malaysian wellness products. Generate exactly 10 distinct video prompts for AI video generation tools. Return ONLY a valid JSON array with exactly 10 objects. No markdown, no preamble. Each object: {"type":"short label","platform":"platform name","prompt":"detailed 80-100 word prompt"}',
      messages: [{ role: 'user', content }]
    });

    const raw = message.content.map(b => b.text || '').join('').replace(/```json|```/g, '').trim();
    const prompts = JSON.parse(raw);

    res.json({ success: true, prompts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Step 2: Generate video via fal.ai ─────────────────────────
app.post('/generate-video', async (req, res) => {
  try {
    const { image, prompt } = req.body;

    // Upload image to fal.ai storage first
    const uploadRes = await fetch('https://rest.alpha.fal.ai/storage/upload/base64', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${process.env.FAL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: image,
        content_type: 'image/jpeg',
        file_name: 'nara_product.jpg'
      })
    });

    const uploadData = await uploadRes.json();
    const imageUrl = uploadData.url;

    // Submit video generation job
    const submitRes = await fetch('https://queue.fal.run/fal-ai/minimax-video/image-to-video', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${process.env.FAL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        image_url: imageUrl,
        prompt: prompt,
        duration: 5
      })
    });

    const submitData = await submitRes.json();
    const requestId = submitData.request_id;

    // Poll for result (max 2 minutes)
    for (let i = 0; i < 24; i++) {
      await new Promise(r => setTimeout(r, 5000));

      const statusRes = await fetch(`https://queue.fal.run/fal-ai/minimax-video/image-to-video/requests/${requestId}`, {
        headers: { 'Authorization': `Key ${process.env.FAL_API_KEY}` }
      });

      const statusData = await statusRes.json();

      if (statusData.status === 'COMPLETED') {
        return res.json({
          success: true,
          videoUrl: statusData.output?.video?.url
        });
      }

      if (statusData.status === 'FAILED') {
        throw new Error('Video generation failed');
      }
    }

    res.status(408).json({ success: false, error: 'Timeout - cuba semula' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Health check ──────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'NARA API running ✓' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
