/**
 * ============================================================================
 * Cloudflare Worker - M3U8 Master Control & Forced Stream Engine v12.1
 * Architecture: Enterprise Clean Code, Direct Server-Side Stream Parser & High Reliability
 * ============================================================================
 */

const CONFIG = {
  VERSION: "12.1.0",
  ENGINE_NAME: "M3U8 Absolute Forced Control Engine",
  ADMIN_PASSWORD: "kidn5420",
  TEMP_CHANNEL_NAME: "rights",
  GITHUB_BASE_URL: "https://raw.githubusercontent.com/alysjc7-dot/site/refs/heads/main/log/",
  get TEMP_CHANNEL_URL() { 
    return this.GITHUB_BASE_URL + "bMjeyq.m3u8"; 
  }
};

/**
 * مدير التخزين المتقدم لـ Cloudflare KV
 */
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

/**
 * محلل ملفات الـ M3U الخارق (يعمل مباشرة على مستوى السيرفر)
 */
class ServerM3UParser {
  static async parseMultipartFile(request) {
    try {
      const contentType = request.headers.get('content-type') || '';
      
      if (!contentType.includes('multipart/form-data')) {
        return { 
          channels: {}, 
          originalUrls: {}, 
          count: 0, 
          error: "نوع المحتوى غير صحيح. يجب أن يكون multipart/form-data" 
        };
      }

      const formData = await request.formData();
      const file = formData.get('m3u_file');
      
      if (!file) {
        return { 
          channels: {}, 
          originalUrls: {}, 
          count: 0, 
          error: "لم يتم اختيار ملف" 
        };
      }

      if (typeof file.text !== 'function') {
        return { 
          channels: {}, 
          originalUrls: {}, 
          count: 0, 
          error: "الملف المرفوع غير صحيح أو تالف" 
        };
      }

      const fileText = await file.text();
      
      if (!fileText || fileText.trim().length === 0) {
        return { 
          channels: {}, 
          originalUrls: {}, 
          count: 0, 
          error: "الملف فارغ" 
        };
      }

      const lines = fileText.split(/\r?\n/);
      const channels = {};
      const originalUrls = {}; // حفظ الروابط الأصلية
      let currentName = "";
      let currentUrl = "";
      let count = 0;

      for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const line = rawLine.trim();
        
        if (!line) continue;

        // معالجة سطر معلومات القناة
        if (line.startsWith("#EXTINF:")) {
          // استخراج اسم القناة من السطر
          const parts = line.split(',');
          if (parts.length > 1) {
            currentName = parts.slice(1).join(',').trim();
            // تنظيف اسم القناة من الأحرف غير المرغوبة
            currentName = currentName.replace(/[\n\r]/g, '').trim();
          }
        } 
        // تخطي أسطر التعليقات الأخرى
        else if (line.startsWith("#")) {
          continue;
        } 
        // معالجة رابط القناة (يجب أن يكون URL صحيح)
        else if (currentName && (line.startsWith('http://') || line.startsWith('https://') || line.startsWith('rtmp') || line.startsWith('/'))) {
          currentUrl = line;
          
          // التحقق من صحة الرابط
          if (currentUrl && currentUrl.length > 0) {
            channels[currentName] = currentUrl; // الرابط الموجه للمستخدم
            originalUrls[currentName] = currentUrl; // حفظ الرابط الأصلي
            count++;
            currentName = "";
            currentUrl = "";
          }
        }
      }

      if (count === 0) {
        return { 
          channels: {}, 
          originalUrls: {}, 
          count: 0, 
          error: "لم يتم العثور على أي قنوات صحيحة في الملف" 
        };
      }

      return { channels, originalUrls, count, error: null };
    } catch (e) {
      console.error('Parse error:', e);
      return { 
        channels: {}, 
        originalUrls: {}, 
        count: 0, 
        error: `خطأ في معالجة الملف: ${e.message}` 
      };
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const kvManager = new KVStorageManager(env);
    
    const password = url.searchParams.get('password') || await this.extractPassword(request);

    // 1. مسارات الصحة والنظام
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

    // 2. حماية المسارات الإدارية
    const adminRoutes = ["/admin", "/clear-all", "/enable-rights", "/restore-channels", "/forced-import-m3u"];
    if (adminRoutes.some(route => path.startsWith(route))) {
      if (password !== CONFIG.ADMIN_PASSWORD) {
        return this.renderLoginView();
      }
    }

    // 3. مسارات التحكم والإدارة
    if (path === "/clear-all") {
      await kvManager.purgeAll();
      return new Response("تم حذف جميع البيانات بنجاح", { 
        status: 200,
        headers: { 
          "Content-Type": "text/plain; charset=utf-8",
          "Access-Control-Allow-Origin": "*" 
        }
      });
    }

    if (path === "/enable-rights") {
      return await this.handleEnableRights(kvManager, url);
    }

    if (path === "/restore-channels") {
      return await this.handleRestoreChannels(kvManager, url);
    }

    if (path === "/forced-import-m3u" && request.method === "POST") {
      return await this.handleForcedImport(request, kvManager, url);
    }

    if (path === "/admin") {
      return await this.handleAdminDashboard(request, env, url, kvManager);
    }

    return new Response("Not Found", { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
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
      } catch (e) {
        console.error('Error extracting password:', e);
      }
    }
    return "";
  },

  responseJson(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
    });
  },

  async handleExportM3U(kvManager, url) {
    try {
      const channels = await kvManager.getChannels();
      
      // إذا كانت القنوات فارغة
      if (Object.keys(channels).length === 0) {
        return new Response('#EXTM3U\n# لا توجد قنوات مسجلة\n', {
          headers: {
            "Content-Type": "application/x-mpegURL; charset=utf-8",
            "Content-Disposition": "attachment; filename=\"master_channels.m3u8\"",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }

      let m3uContent = '#EXTM3U\n';
      for (const [name, url_value] of Object.entries(channels)) {
        // الروابط تمر عبر النظام - كل رابط يمر عبر /[اسم_القناة]/playlist.m3u8
        m3uContent += `#EXTINF:-1,${name}\n`;
        m3uContent += `https://${url.host}/${encodeURIComponent(name)}/playlist.m3u8\n`;
        m3uContent += '\n';
      }
      
      return new Response(m3uContent, {
        headers: {
          "Content-Type": "application/x-mpegURL; charset=utf-8",
          "Content-Disposition": "attachment; filename=\"master_channels.m3u8\"",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache"
        }
      });
    } catch (error) {
      console.error('Export error:', error);
      return new Response("خطأ في تصدير الملف", { 
        status: 500, 
        headers: { "Access-Control-Allow-Origin": "*" } 
      });
    }
  },

  async handlePlaylistStream(path, kvManager) {
    try {
      const segments = path.split("/");
      const channelName = decodeURIComponent(segments[segments.length - 2]);
      const channels = await kvManager.getChannels();
      const realTargetUrl = channels[channelName];
      
      if (!realTargetUrl) {
        return new Response("❌ القناة غير موجودة", { 
          status: 404, 
          headers: { 
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "text/plain; charset=utf-8"
          } 
        });
      }

      // إنشاء ملف M3U يوجه إلى الرابط الأصلي
      const staticM3uContent = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
${realTargetUrl}
`;

      return new Response(staticM3uContent, {
        status: 200,
        headers: {
          "Content-Type": "application/x-mpegURL; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=3600",
          "X-Content-Type-Options": "nosniff"
        }
      });
    } catch (error) {
      console.error('Playlist stream error:', error);
      return new Response("خطأ في معالجة البث", { 
        status: 500, 
        headers: { "Access-Control-Allow-Origin": "*" } 
      });
    }
  },

  async handleEnableRights(kvManager, url) {
    try {
      const currentChannels = await kvManager.getChannels();
      
      // حفظ النسخة الأصلية
      const backupSaved = await kvManager.setBackup(currentChannels);
      if (!backupSaved) {
        return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&error=فشل+حفظ+النسخة+الاحتياطية`, 302);
      }
      
      // تبديل الروابط بالرابط المؤقت
      const tempChannels = {};
      for (const [name] of Object.entries(currentChannels)) {
        tempChannels[name] = CONFIG.TEMP_CHANNEL_URL;
      }
      tempChannels[CONFIG.TEMP_CHANNEL_NAME] = CONFIG.TEMP_CHANNEL_URL;
      
      const saved = await kvManager.saveChannels(tempChannels);
      if (!saved) {
        return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&error=فشل+تحديث+القنوات`, 302);
      }
      
      return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&success=تم+تفعيل+وضع+الحقوق`, 302);
    } catch (e) {
      console.error('Enable rights error:', e);
      return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&error=خطأ+في+تفعيل+وضع+الحقوق`, 302);
    }
  },

  async handleRestoreChannels(kvManager, url) {
    try {
      const backupData = await kvManager.getBackup();
      if (!backupData || Object.keys(backupData).length === 0) {
        return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&error=لا+توجد+نسخة+احتياطية`, 302);
      }
      
      const saved = await kvManager.saveChannels(backupData);
      if (!saved) {
        return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&error=فشل+استعادة+القنوات`, 302);
      }
      
      await kvManager.clearBackup();
      return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&success=تم+استعادة+القنوات+الأصلية`, 302);
    } catch (e) {
      console.error('Restore channels error:', e);
      return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&error=خطأ+في+الاستعادة`, 302);
    }
  },

  async handleForcedImport(request, kvManager, url) {
    try {
      const { channels, originalUrls, count, error } = await ServerM3UParser.parseMultipartFile(request);
      
      if (error) {
        const errMsg = encodeURIComponent(error);
        return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&error=${errMsg}`, 302);
      }

      if (count === 0) {
        return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&error=لم+يتم+استيراد+أي+قنوات`, 302);
      }

      // دمج القنوات الجديدة مع الموجودة
      const currentChannels = await kvManager.getChannels();
      const merged = { ...currentChannels, ...channels };
      
      const saved = await kvManager.saveChannels(merged);
      if (!saved) {
        return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&error=فشل+حفظ+البيانات`, 302);
      }
      
      return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&success=تم+استيراد+${count}+قناة+بنجاح`, 302);
    } catch (e) {
      console.error('Import error:', e);
      return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&error=خطأ+في+الاستيراد:+${encodeURIComponent(e.message)}`, 302);
    }
  },

  renderLoginView() {
    return new Response(`<!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <title>تسجيل الدخول - لوحة التحكم</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;direction:rtl;min-height:100vh;display:flex;justify-content:center;align-items:center;background:#060911;color:#e6edf3;padding:20px}
        .container{background:#0d121d;padding:40px;border-radius:16px;max-width:420px;width:100%;border:1px solid #1a2336;box-shadow:0 25px 50px rgba(0,0,0,0.8)}
        h2{text-align:center;margin-bottom:24px;font-weight:600;font-size:22px;color:#f0f6fc}
        input{width:100%;padding:14px 16px;margin-bottom:20px;border-radius:10px;border:1px solid #1f2a40;background:#060911;color:#fff;font-size:15px}
        input:focus{outline:none;border-color:#388bfd}
        button{width:100%;padding:14px;background:#238636;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer}
        button:hover{background:#2ea043}
      </style>
    </head>
    <body>
      <div class="container">
        <h2>🔐 تسجيل الدخول للإدارة</h2>
        <form method="GET" action="/admin">
          <input type="password" name="password" placeholder="أدخل كلمة المرور" required autofocus>
          <button type="submit">🔓 دخول آمن</button>
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
            
            const saved = await kvManager.saveChannels(channels);
            if (!saved) {
              return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&error=فشل+حفظ+البيانات`, 302);
            }
            
            return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&success=تم+حفظ+القناة+بنجاح`, 302);
          } catch {
            return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&error=الرابط+غير+صحيح`, 302);
          }
        }
      }

      if (action === "delete" && !isTempMode) {
        const name = url.searchParams.get('channel_name');
        if (name && channels[name]) {
          delete channels[name];
          
          const saved = await kvManager.saveChannels(channels);
          if (!saved) {
            return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&error=فشل+حذف+القناة`, 302);
          }
          
          return Response.redirect(`${url.origin}/admin?password=${CONFIG.ADMIN_PASSWORD}&success=تم+حذف+القناة+بنجاح`, 302);
        }
      }

      let channelsHtml = '';
      const channelNames = Object.keys(channels);
      if (channelNames.length === 0) {
        channelsHtml = `<tr><td colspan="3" style="text-align:center;color:#6e7681;padding:40px;">📭 لا توجد قنوات مسجلة حالياً</td></tr>`;
      } else {
        for (const [name, urlLink] of Object.entries(channels)) {
          const shortUrl = urlLink.length > 55 ? urlLink.substring(0, 55) + '...' : urlLink;
          channelsHtml += `
          <tr>
            <td><strong style="color:#f0f6fc;">📺 ${name}</strong></td>
            <td style="font-size:12px;direction:ltr;text-align:left;color:#8b949e;word-break:break-all;">${shortUrl}</td>
            <td style="text-align:center;white-space:nowrap;">
              <button onclick="editChannel('${name.replace(/'/g, "\\'")}', '${urlLink.replace(/'/g, "\\'")}')" class="btn-edit" style="${isTempMode ? 'pointer-events:none;opacity:0.4;' : ''}">✏️ تعديل</button>
              <a href="/admin?action=delete&channel_name=${encodeURIComponent(name)}&password=${CONFIG.ADMIN_PASSWORD}" onclick="return confirm('حذف ${name}؟')" class="btn-delete" style="${isTempMode ? 'pointer-events:none;opacity:0.4;' : ''}">🗑️ حذف</a>
            </td>
          </tr>`;
        }
      }

      return new Response(`<!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <title>لوحة التحكم الاحترافية - قنوات البث</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          *{box-sizing:border-box;margin:0;padding:0}
          body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;direction:rtl;background:#060911;color:#e6edf3;padding:24px 16px}
          .container{max-width:1150px;margin:0 auto;background:#0d121d;border-radius:16px;padding:28px;border:1px solid #1a2336;box-shadow:0 15px 35px rgba(0,0,0,0.6)}
          .header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:24px;padding-bottom:18px;border-bottom:1px solid #1a2336}
          .header h2{font-size:20px;font-weight:600;color:#f0f6fc}
          .btn{display:inline-flex;align-items:center;justify-content:center;padding:9px 18px;border-radius:8px;border:1px solid transparent;font-size:13px;font-weight:500;cursor:pointer;text-decoration:none;color:#fff;transition:all 0.2s}
          .btn:hover{opacity:0.9}
          .btn-logout{background:#1f2937;border-color:#374151;color:#f0f6fc}
          .btn-primary{background:#238636;color:#fff}
          .btn-warning{background:#9e6a03;color:#fff}
          .btn-info{background:#1f6feb;color:#fff}
          .btn-sm{padding:7px 14px;font-size:12px}
          .btn-edit{background:#1f6feb;border:none;color:#fff;padding:5px 12px;font-size:12px;border-radius:6px;cursor:pointer;margin-left:5px}
          .btn-delete{background:#1f2937;border:1px solid #374151;color:#f85149;padding:5px 12px;font-size:12px;border-radius:6px;text-decoration:none;display:inline-block}
          .toolbar{background:#111827;border-radius:10px;padding:14px 18px;margin:20px 0;display:flex;flex-wrap:wrap;gap:14px;align-items:center;border:1px solid #1a2336}
          .form-box{background:#111827;border-radius:10px;padding:18px;margin:20px 0;border:1px solid #1a2336}
          .form-box h3{font-size:14px;font-weight:600;color:#f0f6fc;margin-bottom:12px}
          .form-inline{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
          .form-inline input[type="text"], .form-inline input[type="url"]{flex:1 1 220px;padding:11px 16px;border-radius:8px;border:1px solid #1f2a40;background:#060911;color:#fff;font-size:13px}
          .form-inline input[type="url"]{flex:2 1 320px}
          .file-upload-box{display:flex;gap:12px;align-items:center;flex:2;background:#060911;padding:8px 12px;border:1px solid #1f2a40;border-radius:8px;}
          .file-upload-box input[type="file"]{color:#8b949e;font-size:13px;width:100%;cursor:pointer;}
          .table-wrapper{overflow-x:auto;margin:20px 0;border-radius:10px;border:1px solid #1a2336}
          table{width:100%;border-collapse:collapse;font-size:13px;min-width:550px}
          th,td{padding:14px 16px;text-align:right;border-bottom:1px solid #1a2336}
          th{background:#111827;color:#8b949e;font-weight:500}
          .success{background:rgba(46,160,67,0.15);color:#3fb950;border:1px solid rgba(46,160,67,0.4);padding:12px 16px;border-radius:8px;margin:16px 0;font-size:13px;display:flex;align-items:center;gap:10px}
          .error{background:rgba(248,81,73,0.15);color:#f85149;border:1px solid rgba(248,81,73,0.4);padding:12px 16px;border-radius:8px;margin:16px 0;font-size:13px;display:flex;align-items:center;gap:10px}
          .badge{display:inline-block;padding:4px 12px;border-radius:12px;font-size:11px;background:rgba(187,128,9,0.2);color:#d29922;border:1px solid rgba(187,128,9,0.4)}
          .footer-links{display:flex;flex-wrap:wrap;gap:22px;margin-top:24px;padding-top:18px;border-top:1px solid #1a2336;font-size:12px;color:#8b949e}
          .footer-links a{color:#58a6ff;text-decoration:none}
          .stats-box{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:20px 0}
          .stat-item{background:#111827;padding:12px;border-radius:8px;border:1px solid #1a2336;text-align:center}
          .stat-number{font-size:24px;font-weight:600;color:#3fb950}
          .stat-label{font-size:11px;color:#8b949e;margin-top:4px}
          code{background:#060911;padding:2px 6px;border-radius:4px;color:#79c0ff;font-size:11px}
        </style>
      </head>
      <body>
      <div class="container">
        <div class="header">
          <h2>⚙️ لوحة التحكم المركزية (${CONFIG.VERSION})</h2>
          <a href="/admin?logout=true&password=${CONFIG.ADMIN_PASSWORD}" class="btn btn-logout">🚪 تسجيل الخروج</a>
        </div>
        
        ${url.searchParams.get('success') ? `<div class="success">✅ ${url.searchParams.get('success')}</div>` : ''}
        ${url.searchParams.get('error') ? `<div class="error">❌ ${url.searchParams.get('error')}</div>` : ''}
        
        <div class="stats-box">
          <div class="stat-item">
            <div class="stat-number">${channelNames.length}</div>
            <div class="stat-label">قناة مسجلة</div>
          </div>
          <div class="stat-item">
            <div class="stat-number">${isTempMode ? '🔴' : '🟢'}</div>
            <div class="stat-label">${isTempMode ? 'وضع الحقوق' : 'وضع عادي'}</div>
          </div>
          <div class="stat-item">
            <div class="stat-number">${CONFIG.VERSION}</div>
            <div class="stat-label">إصدار المحرك</div>
          </div>
        </div>
        
        <div class="toolbar">
          <span style="font-weight:500;font-size:13px;color:#8b949e;">🚨 وضع الطوارئ:</span>
          <a href="/enable-rights?password=${CONFIG.ADMIN_PASSWORD}" onclick="return confirm('تفعيل رابط الحقوق؟ سيتم حفظ القنوات الحالية')" class="btn btn-warning btn-sm" style="${isTempMode ? 'opacity:0.4;pointer-events:none;' : ''}">⚠️ تفعيل رابط الحقوق</a>
          <a href="/restore-channels?password=${CONFIG.ADMIN_PASSWORD}" onclick="return confirm('استعادة القنوات الأصلية؟')" class="btn btn-info btn-sm" style="${!isTempMode ? 'opacity:0.4;pointer-events:none;' : ''}">♻️ استعادة القنوات</a>
          ${isTempMode ? `<span class="badge">🔒 وضع الحقوق مفعل</span>` : ''}
        </div>

        <div class="form-box" style="background:#161b22;">
          <h3>📁 استيراد ملف M3U إجباري (مباشر عبر السيرفر)</h3>
          <form method="POST" action="/forced-import-m3u" enctype="multipart/form-data" class="form-inline">
            <input type="hidden" name="password" value="${CONFIG.ADMIN_PASSWORD}">
            <div class="file-upload-box">
              <input type="file" name="m3u_file" accept=".m3u,.m3u8" required ${isTempMode ? 'disabled' : ''}>
            </div>
            <button type="submit" class="btn btn-info" ${isTempMode ? 'disabled' : ''}>📤 رفع واستيراد</button>
          </form>
          <p style="font-size:11px;color:#8b949e;margin-top:8px;">💡 الملف يجب أن يحتوي على روابط صحيحة بصيغة M3U8 أو M3U</p>
        </div>

        <div class="form-box">
          <h3 id="formTitle">➕ إضافة قناة فردية يدوياً</h3>
          <form method="GET" action="/admin" class="form-inline" id="channelForm">
            <input type="hidden" name="action" value="save">
            <input type="hidden" name="password" value="${CONFIG.ADMIN_PASSWORD}">
            <input type="hidden" name="old_name" id="old_name">
            <input type="text" name="channel_name" id="channel_name" placeholder="اسم القناة (مثال: AL JAZEERA)" required ${isTempMode ? 'disabled' : ''}>
            <input type="url" name="channel_url" id="channel_url" placeholder="رابط M3U8 الأصلي الكامل (https://...)" required ${isTempMode ? 'disabled' : ''}>
            <button type="submit" id="submitBtn" class="btn btn-primary" ${isTempMode ? 'disabled' : ''}>➕ إضافة</button>
            <button type="button" onclick="resetForm()" id="cancelBtn" class="btn btn-logout" style="display:none;">❌ إلغاء</button>
          </form>
        </div>

        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th style="text-align:right;">📺 اسم القناة</th>
                <th style="text-align:right;">🔗 رابط البث الأصلي</th>
                <th style="width:140px;text-align:center;">⚙️ الإجراء</th>
              </tr>
            </thead>
            <tbody>
              ${channelsHtml}
            </tbody>
          </table>
        </div>

        <div class="footer-links">
          <div>🔗 <strong>رابط التشغيل الثابت:</strong> <code>https://${url.host}/[اسم_القناة]/playlist.m3u8</code></div>
          <div>📥 <a href="/export-m3u?password=${CONFIG.ADMIN_PASSWORD}">⬇️ تحميل ملف M3U المعدل</a></div>
          <div>💚 <a href="/health" target="_blank">🏥 فحص صحة النظام</a></div>
        </div>
      </div>

      <script>
        function editChannel(name, urlLink) {
          document.getElementById('old_name').value = name;
          document.getElementById('channel_name').value = name;
          document.getElementById('channel_url').value = urlLink;
          document.getElementById('formTitle').innerText = '✏️ تعديل بيانات القناة';
          document.getElementById('submitBtn').innerText = '💾 حفظ التعديل';
          document.getElementById('cancelBtn').style.display = 'inline-flex';
          window.scrollTo({top: 350, behavior: 'smooth'});
        }
        
        function resetForm() {
          document.getElementById('old_name').value = '';
          document.getElementById('channel_name').value = '';
          document.getElementById('channel_url').value = '';
          document.getElementById('formTitle').innerText = '➕ إضافة قناة فردية يدوياً';
          document.getElementById('submitBtn').innerText = '➕ إضافة';
          document.getElementById('cancelBtn').style.display = 'none';
        }

        // التحقق من صحة الرابط أثناء الكتابة
        document.getElementById('channel_url').addEventListener('change', function() {
          try {
            new URL(this.value);
            this.style.borderColor = '#238636';
          } catch(e) {
            this.style.borderColor = '#f85149';
          }
        });
      </script>
      </body>
      </html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (error) {
      console.error('Dashboard error:', error);
      return new Response("خطأ في تحميل لوحة التحكم", { 
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  }
};
