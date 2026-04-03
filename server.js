const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const VARIANT_INFO = {
  all: 'NARA Inhaler 3 variants Sleep purple moon lavender cedarwood vetiver chamomile Focus green crosshair peppermint rosemary lemon eucalyptus Glow gold sun bergamot orange ylang ylang geranium. Matte black cylindrical inhaler keychain gold engraving. Premium Malaysian aromatherapy brand.',
  sleep: 'NARA Sleep inhaler lavender cedarwood vetiver chamomile. Purple gradient moon icon. Deep relaxation and sleep.',
  focus: 'NARA Focus inhaler peppermint rosemary lemon eucalyptus. Forest green crosshair icon. Concentration and clarity.',
  glow: 'NARA Glow inhaler bergamot orange ylang ylang geranium. Warm golden sun icon. Uplifting and mood-enhancing.'
};

const PLATFORM_INFO = {
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
    content.push({ type: 'text', text: 'Product: ' + (VARIANT_INFO[variant] || VARIANT_INFO.all) + ' Platform: ' + (PLATFORM_INFO[platform] || PLATFORM_INFO.tiktok) + ' Generate exactly 10 distinct video prompts. Cover: cinematic hero shot morning routine office focus night sleep botanical closeup person inhaling flat lay emotional transformation luxury unboxing Malaysian lifestyle. Each 60 to 80 words simple English.' });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: 'Return ONLY a valid JSON array with exactly 10 objects. No markdown no code blocks. Each object: {"type":"label max 4 words","platform":"platform","prompt":"60 to 80 words simple English no special characters"}',
      messages: [{ role: 'user', content }]
    });

    let raw = message.content.map(b => b.text || '').join('').trim();
    raw = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    const s = raw.indexOf('['), e = raw.lastIndexOf(']');
    if (s !== -1 && e !== -1) raw = raw.substring(s, e + 1);
    raw = raw.replace(/[\x00-\x1F\x7F]/g, ' ');
    res.json({ success: true, prompts: JSON.parse(raw) });
  } catch (err) {
    console.error('Prompts error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/generate-video', async (req, res) => {
  try {
    const { image, prompt } = req.body;
    const FAL_KEY = process.env.FAL_API_KEY;

    // Hantar sebagai data URI terus - fal.ai support ini
    const imageDataUri = 'data:image/jpeg;base64,' + image;
    console.log('Submitting video job with data URI...');

    const submitRes = await fetch('https://queue.fal.run/fal-ai/minimax-video/image-to-video', {
      method: 'POST',
      headers: {
        'Authorization': 'Key ' + FAL_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        image_url: imageDataUri,
        prompt: prompt,
        duration: 5
      })
    });

    const submitText = await submitRes.text();
    console.log('Submit response status:', submitRes.status);
    console.log('Submit response:', submitText.substring(0, 300));

    if (!submitRes.ok) {
      throw new Error('Submit failed ' + submitRes.status + ': ' + submitText.substring(0, 200));
    }

    let submitData;
    try { submitData = JSON.parse(submitText); }
    catch(e) { throw new Error('Submit parse error: ' + submitText.substring(0, 200)); }

    if (!submitData.request_id) {
      throw new Error('No request_id: ' + JSON.stringify(submitData).substring(0, 200));
    }

    const requestId = submitData.request_id;
    console.log('Job submitted, request_id:', requestId);

    // Poll status
    for (let i = 0; i < 36; i++) {
      await new Promise(r => setTimeout(r, 5000));

      const statusRes = await fetch(
        'https://queue.fal.run/fal-ai/minimax-video/image-to-video/requests/' + requestId + '/status',
        { headers: { 'Authorization': 'Key ' + FAL_KEY } }
      );

      const statusText = await statusRes.text();
      if (!statusText || !statusText.trim()) { console.log('Empty status, retry...'); continue; }

      let statusData;
      try { statusData = JSON.parse(statusText); }
      catch(e) { console.log('Status parse err:', statusText.substring(0,100)); continue; }

      console.log('Poll', i, 'status:', statusData.status);

      if (statusData.status === 'COMPLETED') {
        // Get result
        const resultRes = await fetch(
          'https://queue.fal.run/fal-ai/minimax-video/image-to-video/requests/' + requestId,
          { headers: { 'Authorization': 'Key ' + FAL_KEY } }
        );
        const resultText = await resultRes.text();
        let resultData;
        try { resultData = JSON.parse(resultText); }
        catch(e) { throw new Error('Result parse error: ' + resultText.substring(0,150)); }

        const videoUrl = resultData.video?.url || resultData.output?.video?.url;
        if (!videoUrl) throw new Error('No video URL. Result: ' + JSON.stringify(resultData).substring(0, 300));

        console.log('Video ready:', videoUrl);
        return res.json({ success: true, videoUrl });
      }

      if (statusData.status === 'FAILED') {
        throw new Error('Video generation failed: ' + JSON.stringify(statusData).substring(0, 200));
      }
    }

    res.status(408).json({ success: false, error: 'Timeout selepas 3 minit' });
  } catch (err) {
    console.error('Video error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('NARA backend running on port ' + PORT));
