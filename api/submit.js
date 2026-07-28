export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const {
      company, staff, owner, surveyDate,
      workItems, wageTotal, wageOk, wageComment,
      prospect, workHours, estimateFormat, notes,
      photos
    } = body;

    const slack_webhook = process.env.slack_webhook_url;
    const CLOUD_NAME  = process.env.cloudinary_cloud_name;
    const API_KEY     = process.env.cloudinary_api_key;
    const API_SECRET  = process.env.cloudinary_api_secret;

    // ① Cloudinaryに写真をアップロード
    const uploadedUrls = [];
    if (photos && photos.length > 0) {
      for (const photoBase64 of photos) {
        if (!photoBase64) continue;
        try {
          const timestamp = Math.round(Date.now() / 1000);
          const folder    = 'rinoko_fieldreport';
          const sigStr    = `folder=${folder}&timestamp=${timestamp}${API_SECRET}`;
          const encoder   = new TextEncoder();
          const hashBuffer = await crypto.subtle.digest('SHA-1', encoder.encode(sigStr));
          const signature  = Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0')).join('');

          const formData = new URLSearchParams();
          formData.append('file',      photoBase64);
          formData.append('timestamp', timestamp);
          formData.append('api_key',   API_KEY);
          formData.append('signature', signature);
          formData.append('folder',    folder);

          const uploadRes  = await fetch(
            `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
            { method: 'POST', body: formData }
          );
          const uploadData = await uploadRes.json();
          if (uploadData.secure_url) uploadedUrls.push(uploadData.secure_url);
        } catch (e) {
          console.warn('Cloudinaryアップロードエラー:', e);
        }
      }
    }

    // ② Slack通知テキストを組み立て
    const wageStr = wageTotal ? `¥${Number(wageTotal).toLocaleString('ja-JP')}` : '—';
    const lines = [
      '━━━━━━━━━━━━━━━━━━━━━━',
      '📋 *【リノコ現地調査報告】*',
      '━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '*■ 基本情報*',
      `会社名：${company || '—'}`,
      `担当者：${staff   || '—'}`,
      `お施主様：${owner  || '—'}`,
      `調査日：${surveyDate || '—'}`,
      '',
      '*■ 商談情報*',
      `見込み角度：${prospect   || '—'}`,
      `想定施工時間：${workHours || '—'}`,
      estimateFormat ? `見積書の作成方法：${estimateFormat}` : null,
      '',
      '*■ 工事内容*',
      workItems || '—',
      '',
      '*■ 工賃合計（税抜・目安）*',
      `*${wageStr}*`,
      '',
      '*■ 工賃確認*',
      `工賃OK：${wageOk === 'yes' ? '✅ はい' : '❌ いいえ'}`,
      wageComment ? `異議内容：${wageComment}` : null,
      '',
      notes ? `*■ 特記事項・備考*\n${notes}` : null,
      `写真：${uploadedUrls.length > 0 ? `${uploadedUrls.length}枚` : 'なし'}`,
      '━━━━━━━━━━━━━━━━━━━━━━',
    ].filter(l => l !== null).join('\n');

    // attachmentsで写真をインライン表示
    const attachments = uploadedUrls.map((url, i) => ({
      fallback:  `写真 ${i + 1}`,
      image_url: url,
      title:     `写真 ${i + 1}`,
    }));

    await fetch(slack_webhook, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        text:        lines,
        attachments: attachments.length > 0 ? attachments : undefined,
      }),
    }).catch(e => console.warn('Slack通知エラー:', e));

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('submit error:', error);
    return res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
}
