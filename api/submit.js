export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      company, staff, owner, surveyDate,
      workItems, wageTotal, wageOk, wageComment,
      prospect, workHours, estimateFormat, clientBudget, notes,
      photos
    } = req.body;

    const slack_webhook = process.env.slack_webhook_url;
    const CLOUD_NAME   = process.env.cloudinary_cloud_name;
    const API_KEY      = process.env.cloudinary_api_key;
    const API_SECRET   = process.env.cloudinary_api_secret;

    // ① Cloudinaryに写真をアップロード
    const uploadedUrls = [];
    if (photos && photos.length > 0 && CLOUD_NAME && API_KEY && API_SECRET) {
      for (const photoBase64 of photos) {
        if (!photoBase64) continue;
        try {
          const timestamp = Math.round(Date.now() / 1000);
          const folder    = 'rinoko_fieldreport';

          // Node.js環境での署名生成（crypto モジュールを使用）
          const crypto = await import('crypto');
          const sigStr = `folder=${folder}&timestamp=${timestamp}${API_SECRET}`;
          const signature = crypto.createHash('sha1').update(sigStr).digest('hex');

          const formData = new URLSearchParams();
          formData.append('file',      photoBase64);
          formData.append('timestamp', String(timestamp));
          formData.append('api_key',   API_KEY);
          formData.append('signature', signature);
          formData.append('folder',    folder);

          const uploadRes  = await fetch(
            `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
            { method: 'POST', body: formData }
          );
          const uploadData = await uploadRes.json();
          if (uploadData.secure_url) {
            uploadedUrls.push(uploadData.secure_url);
          } else {
            console.warn('Cloudinaryエラー:', JSON.stringify(uploadData));
          }
        } catch (e) {
          console.warn('Cloudinaryアップロードエラー:', e.message);
        }
      }
    }

    // ② 写真URLのテキストを作成
    let photoText = '';
    if (uploadedUrls.length > 0) {
      photoText = `\n*📸 写真（${uploadedUrls.length}枚）*\n`;
      uploadedUrls.forEach((url, i) => {
        photoText += `写真${i + 1}：${url}\n`;
      });
    } else if (photos && photos.length > 0) {
      photoText = `\n写真：${photos.length}枚（アップロード処理中にエラーが発生しました）`;
    } else {
      photoText = '\n写真：なし';
    }

    // ③ Slack通知テキストを組み立て
    const wageStr = wageTotal ? `¥${Number(wageTotal).toLocaleString('ja-JP')}` : '—';
    const lines = [
      '<@U051ELU7ETV>',
      '━━━━━━━━━━━━━━━━━━━━━━',
      '📋 *【リノコ現地調査報告】*',
      '━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '*■ 基本情報*',
      `会社名：${company || '—'}`,
      `担当者：${staff || '—'}`,
      `お施主様：${owner || '—'}`,
      `調査日：${surveyDate || '—'}`,
      '',
      '*■ 商談情報*',
      `見込み角度：${prospect || '—'}`,
      `想定施工時間：${workHours || '—'}`,
      estimateFormat ? `見積書の作成方法：${estimateFormat}` : null,
      clientBudget ? `施主様の希望予算：${clientBudget}` : null,
      '',
      '*■ 工事内容*',
      workItems || '—',
      '',
      `*■ 工賃合計（税抜・目安）：${wageStr}*`,
      '',
      `*■ 工賃確認：${wageOk === 'yes' ? '✅ はい' : '❌ いいえ'}*`,
      wageComment ? `異議内容：${wageComment}` : null,
      notes ? `\n*■ 特記事項・備考*\n${notes}` : null,
      photoText,
      '━━━━━━━━━━━━━━━━━━━━━━',
    ].filter(l => l !== null).join('\n');

    // ④ Slackに送信
    const slackRes = await fetch(slack_webhook, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: lines }),
    });

    console.log('Slack response:', slackRes.status);

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('submit error:', error.message, error.stack);
    return res.status(500).json({ error: 'サーバーエラーが発生しました', detail: error.message });
  }
}
