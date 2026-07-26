/**
 * ============================================================================
 * Cloudflare Worker - M3U8 Master Control Engine v13.0 ULTIMATE PRO
 * Professional Enterprise Grade - Mobile Optimized
 * ============================================================================
 */

const CONFIG = {
  VERSION: "13.0.0",
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
      console.error('Error getting channels:', error);
      return {};
    }
  }

  async saveChannels(channels) {
    try {
      await this.kv.put('channels_data', JSON.stringify(channels));
      return true;
    } catch (error) {
      console.error('Error saving channels:', error);
      return false;
    }
  }

  async getBackup() {
    try {
      return await this.kv.get('backup_channels', 'json');
    } catch (error) {
      console.error('Error getting backup:', error);
      return null;
    }
  }

  async setBackup(channels) {
    try {
      await this.kv.put('backup_channels', JSON.stringify(channels));
      return true;
    } catch (error) {
      console.error('Error setting backup:', error);
      return false;
    }
  }

  async clearBackup() {
    try {
      await this.kv.delete('backup_channels');
      return true;
    } catch (error) {
      console.error('Error clearing backup:', error);
      return false;
    }
  }

  async purgeAll() {
    try {
      await this.kv.delete('channels_data');
      await this.kv.delete('backup_channels');
      return true;
    } catch (error) {
      console.error('Error purging all:', error);
      return false;
    }
  }
}

class ServerM3UParser {
  static async parseMultipartFile(request) {
    try {
      let formData;
      try {
        formData = await request.formData();
      } catch (e) {
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
        return { channels: {}, count: 0, error: "لم يتم العثور على قنوات صحيحة في الملف" };
      }

      return { channels, count, error: null };
    } catch (e) {
      console.error('Parse error:', e);
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
      return new Response("تم حذف جميع البيانات", { 
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

    return new Response("404", { status: 404 });
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
      return new Response("خطأ", { status: 500 });
    }
  },

  async handlePlaylistStream(path, kvManager) {
    try {
      const segments = path.split("/");
      const channelName = decodeURIComponent(segments[segments.length - 2]);
      const channels = await kvManager.getChannels();
      const realTargetUrl = channels[channelName];
      
      if (!realTargetUrl) {
        return new Response("القناة غير موجودة", { status: 404 });
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
      return new Response("خطأ", { status: 500 });
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
        return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&error=لا+توجد+نسخة+احتياطية`, 302);
      }
      
      await kvManager.saveChannels(backupData);
      await kvManager.clearBackup();
      return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&success=تم+استعادة+القنوات`, 302);
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>تسجيل الدخول</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .login-container { background: white; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); padding: 40px; max-width: 400px; width: 100%; }
    .login-header { text-align: center; margin-bottom: 30px; }
    .login-header h1 { font-size: 24px; color: #333; font-weight: 600; }
    .form-group { margin-bottom: 20px; }
    .form-group input { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 16px; }
    .form-group input:focus { outline: none; border-color: #007AFF; box-shadow: 0 0 0 3px rgba(0,122,255,0.1); }
    .btn-login { width: 100%; padding: 12px; background: #007AFF; color: white; border: none; border-radius: 6px; font-size: 16px; font-weight: 600; cursor: pointer; }
    .btn-login:hover { background: #0051D5; }
  </style>
</head>
<body>
  <div class="login-container">
    <div class="login-header">
      <h1>لوحة التحكم</h1>
    </div>
    <form method="GET" action="/admin">
      <div class="form-group">
        <input type="password" name="password" placeholder="كلمة المرور" required autofocus>
      </div>
      <button type="submit" class="btn-login">دخول</button>
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
            return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&success=تم+حفظ+القناة`, 302);
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
          return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&success=تم+حذف+القناة`, 302);
        }
      }

      let channelsHtml = '';
      const channelNames = Object.keys(channels);
      if (channelNames.length === 0) {
        channelsHtml = `<tr><td colspan="3" style="text-align: center; padding: 30px; color: #999;">لا توجد قنوات</td></tr>`;
      } else {
        for (const [name, urlLink] of Object.entries(channels)) {
          const shortUrl = urlLink.length > 45 ? urlLink.substring(0, 45) + '...' : urlLink;
          channelsHtml += `
          <tr>
            <td><span class="channel-name">${name}</span></td>
            <td><span class="channel-url" title="${urlLink}">${shortUrl}</span></td>
            <td class="action-cell">
              <button class="btn-action" onclick="editChannel('${name.replace(/'/g, "\\'")}', '${urlLink.replace(/'/g, "\\'")}')" ${isTempMode?'disabled':''}>تعديل</button>
              <a href="/admin?action=delete&channel_name=${encodeURIComponent(name)}&password=${CONFIG.ADMIN_PASSWORD}" class="btn-action btn-delete" onclick="return confirm('تأكيد الحذف؟')" ${isTempMode?'style=opacity:0.5;pointer-events:none':''}">حذف</a>
            </td>
          </tr>`;
        }
      }

      return new Response(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>لوحة التحكم</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    .header { background: white; padding: 16px 20px; border-radius: 8px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .header h1 { font-size: 22px; font-weight: 600; }
    .btn-logout { background: #f5f5f5; border: 1px solid #ddd; padding: 10px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; }
    .btn-logout:hover { background: #e8e8e8; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin-bottom: 20px; }
    .stat-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .stat-number { font-size: 28px; font-weight: 700; color: #007AFF; }
    .stat-label { font-size: 12px; color: #999; margin-top: 8px; }
    .alert { padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
    .alert-success { background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; }
    .alert-error { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
    .section { background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .section h2 { font-size: 16px; font-weight: 600; margin-bottom: 16px; color: #333; }
    .toolbar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
    .btn { padding: 10px 16px; border-radius: 6px; border: none; cursor: pointer; font-size: 14px; font-weight: 500; }
    .btn-primary { background: #007AFF; color: white; }
    .btn-primary:hover { background: #0051D5; }
    .btn-primary:disabled { background: #ccc; cursor: not-allowed; }
    .btn-warning { background: #f59e0b; color: white; }
    .btn-warning:hover { background: #d97706; }
    .btn-warning:disabled { background: #ccc; cursor: not-allowed; opacity: 0.5; }
    .btn-info { background: #3b82f6; color: white; }
    .btn-info:hover { background: #2563eb; }
    .btn-info:disabled { background: #ccc; cursor: not-allowed; opacity: 0.5; }
    .upload-area { border: 2px dashed #ddd; border-radius: 8px; padding: 30px; text-align: center; cursor: pointer; transition: all 0.3s; }
    .upload-area:hover { border-color: #007AFF; background: #f9f9f9; }
    .upload-area input[type="file"] { display: none; }
    .upload-text { color: #666; font-size: 14px; }
    #uploadStatus { margin-top: 12px; padding: 12px; border-radius: 6px; font-size: 14px; display: none; }
    #uploadStatus.success { background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; display: block; }
    #uploadStatus.error { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; display: block; }
    .form-inline { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }
    .form-inline input { flex: 1; min-width: 200px; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; }
    .form-inline input:focus { outline: none; border-color: #007AFF; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 12px; text-align: right; border-bottom: 1px solid #eee; }
    th { background: #f9f9f9; font-weight: 600; color: #666; font-size: 13px; }
    .channel-name { color: #007AFF; font-weight: 500; }
    .channel-url { font-size: 13px; color: #999; font-family: monospace; }
    .action-cell { width: 200px; }
    .btn-action { padding: 6px 12px; border-radius: 4px; border: none; cursor: pointer; font-size: 12px; margin: 0 4px; }
    .btn-action { background: #e3f2fd; color: #1976d2; }
    .btn-action:hover { background: #bbdefb; }
    .btn-delete { background: #ffebee; color: #c62828; }
    .btn-delete:hover { background: #ffcdd2; }
    .btn-action:disabled { opacity: 0.5; cursor: not-allowed; }
    .mode-badge { display: inline-block; padding: 6px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; }
    .mode-normal { background: #d1fae5; color: #065f46; }
    .mode-rights { background: #fee2e2; color: #991b1b; }
    .instructions { background: #f0f9ff; border-left: 4px solid #0284c7; padding: 12px; border-radius: 4px; font-size: 13px; color: #0c4a6e; margin-bottom: 12px; }
    @media (max-width: 768px) {
      .header { flex-direction: column; align-items: flex-start; gap: 12px; }
      .stats { grid-template-columns: 1fr; }
      .table-wrapper { overflow-x: auto; }
      table { font-size: 13px; }
      .form-inline { flex-direction: column; }
      .form-inline input { width: 100%; }
      .btn { padding: 8px 12px; font-size: 13px; }
    }
  </style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>لوحة التحكم</h1>
    <form method="GET" action="/admin" style="margin: 0;">
      <input type="hidden" name="logout" value="true">
      <input type="hidden" name="password" value="${CONFIG.ADMIN_PASSWORD}">
      <button type="submit" class="btn-logout">تسجيل الخروج</button>
    </form>
  </div>

  ${url.searchParams.get('success') ? `<div class="alert alert-success">${decodeURIComponent(url.searchParams.get('success'))}</div>` : ''}
  ${url.searchParams.get('error') ? `<div class="alert alert-error">${decodeURIComponent(url.searchParams.get('error'))}</div>` : ''}

  <div class="stats">
    <div class="stat-card">
      <div class="stat-number">${channelNames.length}</div>
      <div class="stat-label">القنوات المسجلة</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">${CONFIG.VERSION}</div>
      <div class="stat-label">إصدار النظام</div>
    </div>
    <div class="stat-card">
      <span class="mode-badge ${isTempMode ? 'mode-rights' : 'mode-normal'}">${isTempMode ? 'وضع الحقوق مفعل' : 'الوضع العادي'}</span>
    </div>
  </div>

  <div class="section">
    <h2>إدارة وضع الحقوق</h2>
    <div class="toolbar">
      <a href="/enable-rights?password=${CONFIG.ADMIN_PASSWORD}" class="btn btn-warning" onclick="return confirm('تفعيل وضع الحقوق؟ سيتم حفظ القنوات الحالية')" ${isTempMode?'style=opacity:0.5;pointer-events:none;':''}>تفعيل وضع الحقوق</a>
      <a href="/restore-channels?password=${CONFIG.ADMIN_PASSWORD}" class="btn btn-info" onclick="return confirm('استعادة القنوات الأصلية؟')" ${!isTempMode?'style=opacity:0.5;pointer-events:none;':''}>استعادة القنوات</a>
    </div>
  </div>

  <div class="section">
    <h2>استيراد ملف M3U</h2>
    <div class="instructions">يمكنك رفع ملف M3U أو M3U8 يحتوي على قنوات البث. سيتم دمج القنوات مع الموجودة.</div>
    <div class="upload-area" id="uploadArea">
      <input type="file" id="fileInput" accept=".m3u,.m3u8,.txt">
      <p class="upload-text">اضغط هنا أو اسحب ملف M3U</p>
    </div>
    <div id="uploadStatus"></div>
  </div>

  <div class="section">
    <h2>إضافة قناة يدويًا</h2>
    <form method="GET" action="/admin" class="form-inline">
      <input type="hidden" name="action" value="save">
      <input type="hidden" name="password" value="${CONFIG.ADMIN_PASSWORD}">
      <input type="hidden" name="old_name" id="old_name">
      <input type="text" name="channel_name" id="channel_name" placeholder="اسم القناة" required ${isTempMode?'disabled':''}>
      <input type="url" name="channel_url" id="channel_url" placeholder="رابط البث (https://...)" required ${isTempMode?'disabled':''}>
      <button type="submit" class="btn btn-primary" ${isTempMode?'disabled':''}>إضافة</button>
      <button type="button" class="btn" style="background: #e5e7eb; color: #333;" onclick="resetForm()" id="cancelBtn" style="display: none;">إلغاء</button>
    </form>
  </div>

  <div class="section">
    <h2>القنوات المسجلة</h2>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>اسم القناة</th>
            <th>رابط البث</th>
            <th>إجراء</th>
          </tr>
        </thead>
        <tbody>
          ${channelsHtml}
        </tbody>
      </table>
    </div>
  </div>

  <div class="section">
    <h2>خيارات إضافية</h2>
    <div class="toolbar">
      <a href="/export-m3u?password=${CONFIG.ADMIN_PASSWORD}" class="btn btn-primary">تحميل ملف M3U المعدل</a>
      <a href="/health" target="_blank" class="btn" style="background: #e5e7eb; color: #333;">فحص النظام</a>
    </div>
  </div>
</div>

<script>
const fileInput = document.getElementById('fileInput');
const uploadArea = document.getElementById('uploadArea');
const uploadStatus = document.getElementById('uploadStatus');

uploadArea.addEventListener('click', () => fileInput.click());
uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadArea.style.borderColor = '#007AFF';
  uploadArea.style.background = '#f0f9ff';
});
uploadArea.addEventListener('dragleave', () => {
  uploadArea.style.borderColor = '#ddd';
  uploadArea.style.background = 'white';
});
uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.style.borderColor = '#ddd';
  uploadArea.style.background = 'white';
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

  uploadStatus.textContent = 'جاري الرفع...';
  uploadStatus.className = '';
  uploadStatus.style.display = 'block';

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
      showStatus('تم استيراد ' + data.count + ' قناة بنجاح', 'success');
      fileInput.value = '';
      setTimeout(() => location.reload(), 1500);
    } else {
      showStatus(data.error || 'خطأ', 'error');
    }
  } catch (e) {
    showStatus('خطأ في الاتصال: ' + e.message, 'error');
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
      return new Response("خطأ", { status: 500 });
    }
  }
};
