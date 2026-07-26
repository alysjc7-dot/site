/**
 * ============================================================================
 * Cloudflare Worker - M3U8 Master Control Engine v12.5 ULTIMATE
 * Supreme File Upload Handler - Enterprise Grade
 * ============================================================================
 */

const CONFIG = {
  VERSION: "12.5.0",
  ENGINE_NAME: "M3U8 Absolute Forced Control Engine",
  ADMIN_PASSWORD: "kidn5420",
  TEMP_CHANNEL_NAME: "rights",
  GITHUB_BASE_URL: "https://raw.githubusercontent.com/alysjc7-dot/site/refs/heads/main/log/",
  get TEMP_CHANNEL_URL() { 
    return this.GITHUB_BASE_URL + "bMjeyq.m3u8"; 
  }
};

class KVStorageManager {
  constructor(env) {
    this.kv = env.CHANNELS_KV;
  }

  async getChannels() {
    try {
      const data = await this.kv.get('channels_data', 'json');
      return data && typeof data === 'object' ? data : {};
    } catch (error) {
      console.error('❌ Error getting channels:', error);
      return {};
    }
  }

  async saveChannels(channels) {
    try {
      await this.kv.put('channels_data', JSON.stringify(channels));
      return true;
    } catch (error) {
      console.error('❌ Error saving channels:', error);
      return false;
    }
  }

  async getBackup() {
    try {
      return await this.kv.get('backup_channels', 'json');
    } catch (error) {
      console.error('❌ Error getting backup:', error);
      return null;
    }
  }

  async setBackup(channels) {
    try {
      await this.kv.put('backup_channels', JSON.stringify(channels));
      return true;
    } catch (error) {
      console.error('❌ Error setting backup:', error);
      return false;
    }
  }

  async clearBackup() {
    try {
      await this.kv.delete('backup_channels');
      return true;
    } catch (error) {
      console.error('❌ Error clearing backup:', error);
      return false;
    }
  }

  async purgeAll() {
    try {
      await this.kv.delete('channels_data');
      await this.kv.delete('backup_channels');
      return true;
    } catch (error) {
      console.error('❌ Error purging all:', error);
      return false;
    }
  }
}

class ServerM3UParser {
  static async parseMultipartFile(request) {
    try {
      console.log('🔄 Starting parse...');
      
      let formData;
      try {
        formData = await request.formData();
      } catch (e) {
        console.error('❌ formData error:', e);
        return { channels: {}, count: 0, error: `فشل قراءة الملف: ${e.message}` };
      }

      const file = formData.get('m3u_file') || formData.get('file') || formData.get('upload');
      
      if (!file) {
        return { channels: {}, count: 0, error: "لم يتم اختيار ملف" };
      }

      let fileText = '';
      try {
        fileText = await file.text();
      } catch (e) {
        return { channels: {}, count: 0, error: `خطأ في قراءة الملف: ${e.message}` };
      }

      if (!fileText || fileText.trim().length === 0) {
        return { channels: {}, count: 0, error: "الملف فارغ" };
      }

      const lines = fileText.split(/\r?\n/);
      const channels = {};
      let currentName = "";
      let count = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        if (!line) continue;

        if (line.startsWith("#EXTINF:") || line.startsWith("#extinf:")) {
          const parts = line.split(',');
          if (parts.length > 1) {
            currentName = parts.slice(1).join(',').trim().replace(/[\n\r\t]/g, '').trim();
          }
        } 
        else if (line.startsWith("#")) {
          continue;
        } 
        else if (currentName && currentName.length > 2) {
          const trimmedUrl = line.trim();
          
          if (trimmedUrl && (
            trimmedUrl.startsWith('http://') || 
            trimmedUrl.startsWith('https://') || 
            trimmedUrl.startsWith('rtmp') ||
            trimmedUrl.startsWith('udp://') ||
            trimmedUrl.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//)
          )) {
            channels[currentName] = trimmedUrl;
            count++;
            currentName = "";
          }
        }
      }

      if (count === 0) {
        return { channels: {}, count: 0, error: "لم يتم العثور على قنوات صحيحة" };
      }

      return { channels, count, error: null };
    } catch (e) {
      console.error('❌ Parse error:', e);
      return { channels: {}, count: 0, error: `خطأ: ${e.message}` };
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const kvManager = new KVStorageManager(env);
    
    const password = url.searchParams.get('password') || await this.extractPassword(request);

    if (path === "/health") {
      return this.responseJson({
        status: "ONLINE",
        engine: CONFIG.ENGINE_NAME,
        version: CONFIG.VERSION,
        timestamp: new Date().toISOString()
      });
    }

    if (path === "/export-m3u") {
      return await this.handleExportM3U(kvManager, url);
    }

    if (path.endsWith("/playlist.m3u8")) {
      return await this.handlePlaylistStream(path, kvManager);
    }

    const adminRoutes = ["/admin", "/clear-all", "/enable-rights", "/restore-channels", "/forced-import-m3u", "/upload-api"];
    if (adminRoutes.some(route => path.startsWith(route))) {
      if (password !== CONFIG.ADMIN_PASSWORD) {
        return this.renderLoginView();
      }
    }

    if (path === "/clear-all") {
      await kvManager.purgeAll();
      return new Response("✅ تم حذف جميع البيانات", { 
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" }
      });
    }

    if (path === "/enable-rights") {
      return await this.handleEnableRights(kvManager, url);
    }

    if (path === "/restore-channels") {
      return await this.handleRestoreChannels(kvManager, url);
    }

    if (path === "/upload-api" && request.method === "POST") {
      return await this.handleUploadAPI(request, kvManager, url);
    }

    if (path === "/forced-import-m3u" && request.method === "POST") {
      return await this.handleForcedImport(request, kvManager, url);
    }

    if (path === "/admin") {
      return await this.handleAdminDashboard(request, env, url, kvManager);
    }

    return new Response("404 Not Found", { status: 404 });
  },

  async extractPassword(request) {
    if (request.method === "POST") {
      try {
        const cloned = request.clone();
        const contentType = request.headers.get("content-type") || "";
        if (contentType.includes("multipart/form-data")) {
          const formData = await cloned.formData();
          return formData.get("password") || "";
        }
      } catch (e) {}
    }
    return "";
  },

  responseJson(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
    });
  },

  async handleUploadAPI(request, kvManager, url) {
    try {
      const { channels, count, error } = await ServerM3UParser.parseMultipartFile(request);
      
      if (error) {
        return this.responseJson({ success: false, error, count: 0 }, 400);
      }

      if (count === 0) {
        return this.responseJson({ success: false, error: "لم يتم العثور على قنوات", count: 0 }, 400);
      }

      const currentChannels = await kvManager.getChannels();
      const merged = { ...currentChannels, ...channels };
      
      const saved = await kvManager.saveChannels(merged);
      if (!saved) {
        return this.responseJson({ success: false, error: "فشل الحفظ", count: 0 }, 500);
      }

      return this.responseJson({ success: true, message: `تم استيراد ${count} قناة بنجاح`, count });
    } catch (e) {
      console.error('Upload API error:', e);
      return this.responseJson({ success: false, error: e.message, count: 0 }, 500);
    }
  },

  async handleExportM3U(kvManager, url) {
    try {
      const channels = await kvManager.getChannels();
      
      if (Object.keys(channels).length === 0) {
        return new Response('#EXTM3U\n', {
          headers: {
            "Content-Type": "application/x-mpegURL; charset=utf-8",
            "Content-Disposition": "attachment; filename=\"master.m3u8\""
          }
        });
      }

      let m3uContent = '#EXTM3U\n';
      for (const [name] of Object.entries(channels)) {
        m3uContent += `#EXTINF:-1,${name}\n`;
        m3uContent += `https://${url.host}/${encodeURIComponent(name)}/playlist.m3u8\n\n`;
      }
      
      return new Response(m3uContent, {
        headers: {
          "Content-Type": "application/x-mpegURL; charset=utf-8",
          "Content-Disposition": "attachment; filename=\"master.m3u8\"",
          "Cache-Control": "no-cache"
        }
      });
    } catch (error) {
      return new Response("❌ خطأ", { status: 500 });
    }
  },

  async handlePlaylistStream(path, kvManager) {
    try {
      const segments = path.split("/");
      const channelName = decodeURIComponent(segments[segments.length - 2]);
      const channels = await kvManager.getChannels();
      const realTargetUrl = channels[channelName];
      
      if (!realTargetUrl) {
        return new Response("❌ القناة غير موجودة", { status: 404 });
      }

      const m3uContent = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=2500000\n${realTargetUrl}\n`;

      return new Response(m3uContent, {
        status: 200,
        headers: {
          "Content-Type": "application/x-mpegURL; charset=utf-8",
          "Cache-Control": "max-age=3600"
        }
      });
    } catch (error) {
      return new Response("❌ خطأ", { status: 500 });
    }
  },

  async handleEnableRights(kvManager, url) {
    try {
      const currentChannels = await kvManager.getChannels();
      await kvManager.setBackup(currentChannels);
      
      const tempChannels = {};
      for (const [name] of Object.entries(currentChannels)) {
        tempChannels[name] = CONFIG.TEMP_CHANNEL_URL;
      }
      tempChannels[CONFIG.TEMP_CHANNEL_NAME] = CONFIG.TEMP_CHANNEL_URL;
      
      await kvManager.saveChannels(tempChannels);
      return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&success=تم+تفعيل+وضع+الحقوق`, 302);
    } catch (e) {
      return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&error=خطأ`, 302);
    }
  },

  async handleRestoreChannels(kvManager, url) {
    try {
      const backupData = await kvManager.getBackup();
      if (!backupData || Object.keys(backupData).length === 0) {
        return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&error=لا+توجد+نسخة`, 302);
      }
      
      await kvManager.saveChannels(backupData);
      await kvManager.clearBackup();
      return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&success=تم+الاستعادة`, 302);
    } catch (e) {
      return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&error=خطأ`, 302);
    }
  },

  async handleForcedImport(request, kvManager, url) {
    try {
      const { channels, count, error } = await ServerM3UParser.parseMultipartFile(request);
      
      if (error) {
        const errMsg = encodeURIComponent(error);
        return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&error=${errMsg}`, 302);
      }

      if (count === 0) {
        return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&error=لم+يتم+استيراد+قنوات`, 302);
      }

      const currentChannels = await kvManager.getChannels();
      const merged = { ...currentChannels, ...channels };
      
      const saved = await kvManager.saveChannels(merged);
      if (!saved) {
        return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&error=فشل+الحفظ`, 302);
      }
      
      return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&success=تم+استيراد+${count}+قناة`, 302);
    } catch (e) {
      return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&error=خطأ`, 302);
    }
  },

  renderLoginView() {
    return new Response(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تسجيل الدخول</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:system-ui;background:#060911;color:#e6edf3;min-height:100vh;display:flex;align-items:center;justify-content:center}
    .container{background:#0d121d;padding:40px;border-radius:16px;border:1px solid #1a2336;box-shadow:0 20px 50px rgba(0,0,0,0.9);max-width:420px;width:100%}
    h1{text-align:center;margin-bottom:30px;font-size:24px}
    input{width:100%;padding:12px;margin:12px 0;border:1px solid #1f2a40;background:#060911;color:#fff;border-radius:8px;font-size:16px}
    input:focus{outline:none;border-color:#388bfd}
    button{width:100%;padding:12px;margin-top:20px;background:#238636;color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer}
    button:hover{background:#2ea043}
  </style>
</head>
<body>
  <div class="container">
    <h1>🔐 تسجيل دخول</h1>
    <form method="GET" action="/admin">
      <input type="password" name="password" placeholder="كلمة المرور" required autofocus>
      <button type="submit">دخول</button>
    </form>
  </div>
</body>
</html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  },

  async handleAdminDashboard(request, env, url, kvManager) {
    try {
      const channels = await kvManager.getChannels();
      const backupData = await kvManager.getBackup();
      const isTempMode = backupData !== null;
      const action = url.searchParams.get('action');

      if (action === "save" && !isTempMode) {
        const oldName = url.searchParams.get('old_name');
        const name = url.searchParams.get('channel_name');
        const channelUrl = url.searchParams.get('channel_url');
        
        if (name && channelUrl) {
          try {
            new URL(channelUrl);
            if (oldName && oldName !== name) delete channels[oldName];
            channels[name] = channelUrl;
            await kvManager.saveChannels(channels);
            return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&success=تم+الحفظ`, 302);
          } catch {
            return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&error=رابط+غير+صحيح`, 302);
          }
        }
      }

      if (action === "delete" && !isTempMode) {
        const name = url.searchParams.get('channel_name');
        if (name && channels[name]) {
          delete channels[name];
          await kvManager.saveChannels(channels);
          return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&success=تم+الحذف`, 302);
        }
      }

      let channelsHtml = '';
      const channelNames = Object.keys(channels);
      if (channelNames.length === 0) {
        channelsHtml = `<tr><td colspan="3" style="text-align:center;padding:40px;color:#666">لا توجد قنوات</td></tr>`;
      } else {
        for (const [name, urlLink] of Object.entries(channels)) {
          const shortUrl = urlLink.length > 50 ? urlLink.substring(0, 50) + '...' : urlLink;
          channelsHtml += `<tr>
            <td><strong>${name}</strong></td>
            <td style="font-size:12px;color:#888;word-break:break-all">${shortUrl}</td>
            <td style="text-align:center">
              <button class="btn-small" onclick="editChannel('${name.replace(/'/g, "\\'")}', '${urlLink.replace(/'/g, "\\'")}')" ${isTempMode?'disabled':''}>تعديل</button>
              <a href="/admin?action=delete&channel_name=${encodeURIComponent(name)}&password=${CONFIG.ADMIN_PASSWORD}" class="btn-small" onclick="return confirm('حذف؟')" ${isTempMode?'style=opacity:0.5;pointer-events:none':''}">حذف</a>
            </td>
          </tr>`;
        }
      }

      return new Response(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>لوحة التحكم</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:system-ui;background:#060911;color:#e6edf3;padding:20px}
    .container{max-width:1200px;margin:0 auto;background:#0d121d;border-radius:12px;padding:20px;border:1px solid #1a2336}
    .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;padding-bottom:15px;border-bottom:1px solid #1a2336}
    h1{font-size:22px}
    .btn-logout{background:#1f2937;padding:8px 16px;border-radius:6px;text-decoration:none;color:#fff;border:none;cursor:pointer}
    .btn-logout:hover{background:#374151}
    .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin:20px 0}
    .stat{background:#111827;padding:12px;border-radius:8px;text-align:center;border:1px solid #1a2336}
    .stat-num{font-size:28px;font-weight:bold;color:#3fb950}
    .stat-label{font-size:12px;color:#888;margin-top:8px}
    .success{background:rgba(46,160,67,0.15);color:#3fb950;border:1px solid rgba(46,160,67,0.4);padding:12px;border-radius:8px;margin:12px 0}
    .error{background:rgba(248,81,73,0.15);color:#f85149;border:1px solid rgba(248,81,73,0.4);padding:12px;border-radius:8px;margin:12px 0}
    .form-box{background:#111827;padding:16px;border-radius:8px;margin:20px 0;border:1px solid #1a2336}
    .form-box h3{margin-bottom:12px;font-size:14px}
    .form-group{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
    input[type="text"],input[type="url"],input[type="file"]{flex:1;min-width:200px;padding:10px;border:1px solid #1f2a40;background:#060911;color:#fff;border-radius:6px;font-size:13px}
    input[type="file"]{cursor:pointer}
    .btn{padding:10px 20px;background:#238636;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600}
    .btn:hover{background:#2ea043}
    .btn:disabled{background:#444;cursor:not-allowed;opacity:0.5}
    .btn-small{padding:5px 10px;background:#1f6feb;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;margin:0 2px}
    .btn-small:hover{background:#388bfd}
    .btn-small:disabled{opacity:0.5;cursor:not-allowed}
    table{width:100%;border-collapse:collapse;margin:20px 0}
    th,td{padding:12px;text-align:right;border-bottom:1px solid #1a2336}
    th{background:#111827;color:#888;font-weight:600}
    .upload-area{border:2px dashed #1f2a40;padding:20px;border-radius:8px;text-align:center;background:#060911}
    .upload-area:hover{border-color:#388bfd;background:#0d121d}
    .upload-area p{color:#888;margin:10px 0}
    #uploadStatus{margin-top:10px;padding:10px;border-radius:6px;display:none}
    #uploadStatus.success{background:rgba(46,160,67,0.2);color:#3fb950;border:1px solid rgba(46,160,67,0.4);display:block}
    #uploadStatus.error{background:rgba(248,81,73,0.2);color:#f85149;border:1px solid rgba(248,81,73,0.4);display:block}
    .instructions{background:#111827;padding:12px;border-left:4px solid #1f6feb;border-radius:6px;font-size:12px;color:#888;margin-bottom:12px}
  </style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>⚙️ لوحة التحكم v${CONFIG.VERSION}</h1>
    <form method="GET" action="/admin" style="display:inline">
      <input type="hidden" name="logout" value="true">
      <input type="hidden" name="password" value="${CONFIG.ADMIN_PASSWORD}">
      <button class="btn-logout">🚪 خروج</button>
    </form>
  </div>

  ${url.searchParams.get('success') ? `<div class="success">✅ ${decodeURIComponent(url.searchParams.get('success'))}</div>` : ''}
  ${url.searchParams.get('error') ? `<div class="error">❌ ${decodeURIComponent(url.searchParams.get('error'))}</div>` : ''}

  <div class="stats">
    <div class="stat">
      <div class="stat-num">${channelNames.length}</div>
      <div class="stat-label">قناة</div>
    </div>
    <div class="stat">
      <div class="stat-num">${isTempMode ? '🔴' : '🟢'}</div>
      <div class="stat-label">${isTempMode ? 'وضع الحقوق' : 'وضع عادي'}</div>
    </div>
  </div>

  <div class="form-box">
    <h3>📤 رفع ملف M3U / M3U8</h3>
    <div class="instructions">
      💡 اختر ملف M3U أو M3U8 من جهازك ثم اضغط رفع
    </div>
    <div class="upload-area" id="uploadArea">
      <input type="file" id="fileInput" accept=".m3u,.m3u8,.txt" style="display:none">
      <p>👆 اضغط هنا لاختيار ملف أو اسحب الملف هنا</p>
      <p style="font-size:12px;color:#666">الملف يجب أن يكون M3U أو M3U8</p>
    </div>
    <div id="uploadStatus"></div>
    <div style="margin-top:12px">
      <button class="btn" id="uploadBtn" onclick="uploadFile()" ${isTempMode?'disabled':''}>📤 رفع الملف</button>
    </div>
  </div>

  <div class="form-box">
    <h3>➕ إضافة قناة يدوياً</h3>
    <form method="GET" action="/admin">
      <input type="hidden" name="action" value="save">
      <input type="hidden" name="password" value="${CONFIG.ADMIN_PASSWORD}">
      <input type="hidden" name="old_name" id="old_name">
      <div class="form-group">
        <input type="text" name="channel_name" id="channel_name" placeholder="اسم القناة" required ${isTempMode?'disabled':''}>
        <input type="url" name="channel_url" id="channel_url" placeholder="https://..." required ${isTempMode?'disabled':''}>
        <button type="submit" class="btn" ${isTempMode?'disabled':''}>إضافة</button>
        <button type="button" class="btn" style="background:#666" onclick="resetForm()" id="cancelBtn" style="display:none">إلغاء</button>
      </div>
    </form>
  </div>

  <table>
    <thead>
      <tr>
        <th>📺 القناة</th>
        <th>🔗 الرابط</th>
        <th style="width:120px">إجراء</th>
      </tr>
    </thead>
    <tbody>
      ${channelsHtml}
    </tbody>
  </table>

  <div style="margin-top:20px;padding-top:20px;border-top:1px solid #1a2336;color:#888;font-size:12px">
    <p>📥 <a href="/export-m3u?password=${CONFIG.ADMIN_PASSWORD}" style="color:#58a6ff">تحميل ملف M3U المعدل</a></p>
  </div>
</div>

<script>
const fileInput = document.getElementById('fileInput');
const uploadArea = document.getElementById('uploadArea');
const uploadBtn = document.getElementById('uploadBtn');
const uploadStatus = document.getElementById('uploadStatus');

uploadArea.addEventListener('click', () => fileInput.click());
uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadArea.style.borderColor = '#388bfd';
});
uploadArea.addEventListener('dragleave', () => {
  uploadArea.style.borderColor = '#1f2a40';
});
uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.style.borderColor = '#1f2a40';
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    fileInput.files = files;
    uploadFile();
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) {
    uploadFile();
  }
});

async function uploadFile() {
  const file = fileInput.files[0];
  if (!file) {
    showStatus('اختر ملف أولاً', 'error');
    return;
  }

  uploadStatus.textContent = '⏳ جاري الرفع...';
  uploadStatus.className = '';
  uploadStatus.style.display = 'block';
  uploadBtn.disabled = true;

  const formData = new FormData();
  formData.append('m3u_file', file);
  formData.append('password', '${CONFIG.ADMIN_PASSWORD}');

  try {
    const response = await fetch('/upload-api?password=${CONFIG.ADMIN_PASSWORD}', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (data.success) {
      showStatus('✅ تم استيراد ' + data.count + ' قناة بنجاح!', 'success');
      fileInput.value = '';
      setTimeout(() => location.reload(), 1500);
    } else {
      showStatus('❌ ' + (data.error || 'خطأ'), 'error');
    }
  } catch (e) {
    showStatus('❌ خطأ في الاتصال: ' + e.message, 'error');
  } finally {
    uploadBtn.disabled = false;
  }
}

function showStatus(msg, type) {
  uploadStatus.textContent = msg;
  uploadStatus.className = type;
  uploadStatus.style.display = 'block';
}

function editChannel(name, url) {
  document.getElementById('old_name').value = name;
  document.getElementById('channel_name').value = name;
  document.getElementById('channel_url').value = url;
  document.getElementById('cancelBtn').style.display = 'inline-block';
  window.scrollTo({top: 0, behavior: 'smooth'});
}

function resetForm() {
  document.getElementById('old_name').value = '';
  document.getElementById('channel_name').value = '';
  document.getElementById('channel_url').value = '';
  document.getElementById('cancelBtn').style.display = 'none';
}
</script>
</body>
</html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (error) {
      return new Response("❌ خطأ", { status: 500 });
    }
  }
};
