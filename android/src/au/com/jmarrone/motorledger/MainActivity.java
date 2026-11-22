package au.com.jmarrone.motorledger;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;

import java.io.File;

/**
 * MotorLedger: the web app in a native shell, so it installs and opens like an app.
 * Camera capture is wired through to the page's file inputs.
 */
public class MainActivity extends Activity {

  private static final String BASE = "https://motorledger-nine.vercel.app";
  private static final String AUTHORITY = "au.com.jmarrone.motorledger.images";
  private static final int REQ_CHOOSER = 1001;
  private static final int REQ_CAMERA = 1002;

  private WebView web;
  private ProgressBar bar;
  private ValueCallback<Uri[]> pending;
  private Uri cameraUri;
  private boolean offline = false;

  @Override
  protected void onCreate(Bundle saved) {
    super.onCreate(saved);

    Window w = getWindow();
    w.setStatusBarColor(Color.parseColor("#f5f1e8"));
    w.setNavigationBarColor(Color.parseColor("#f5f1e8"));
    if (Build.VERSION.SDK_INT >= 23) {
      w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
    }

    FrameLayout root = new FrameLayout(this);
    root.setBackgroundColor(Color.parseColor("#f5f1e8"));

    web = new WebView(this);
    web.setBackgroundColor(Color.parseColor("#f5f1e8"));
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setUseWideViewPort(true);
    s.setLoadWithOverviewMode(true);
    s.setAllowFileAccess(false);

    bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
    bar.setMax(100);
    bar.setVisibility(View.GONE);
    FrameLayout.LayoutParams bp = new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, dp(3));
    bp.gravity = Gravity.TOP;

    root.addView(web, new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    root.addView(bar, bp);
    setContentView(root);

    web.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
        return handle(r.getUrl());
      }

      @Override
      public boolean shouldOverrideUrlLoading(WebView v, String url) {
        return handle(Uri.parse(url));
      }

      @Override
      public void onPageStarted(WebView v, String url, android.graphics.Bitmap fav) {
        if (url != null && url.startsWith(BASE)) offline = false;
      }

      @Override
      public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
        if (r == null || r.isForMainFrame()) showOffline();
      }

      @Override
      public void onReceivedError(WebView v, int code, String desc, String failingUrl) {
        showOffline();
      }
    });

    web.setWebChromeClient(new WebChromeClient() {
      @Override
      public void onProgressChanged(WebView v, int p) {
        bar.setVisibility(p < 100 ? View.VISIBLE : View.GONE);
        bar.setProgress(p);
      }

      @Override
      public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb,
                                       FileChooserParams params) {
        if (pending != null) {
          pending.onReceiveValue(null);
          pending = null;
        }
        pending = cb;
        cameraUri = null;

        Intent camera = null;
        try {
          File dir = new File(getCacheDir(), "captures");
          if (!dir.exists()) dir.mkdirs();
          File f = new File(dir, "cap_" + System.currentTimeMillis() + ".jpg");
          cameraUri = Uri.parse("content://" + AUTHORITY + "/" + f.getName());
          camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
          camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
          camera.setClipData(ClipData.newRawUri("", cameraUri));
          camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION
              | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {
          camera = null;
          cameraUri = null;
        }

        Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
        pick.addCategory(Intent.CATEGORY_OPENABLE);
        boolean wantsPdf = false;
        String[] accepts = params != null ? params.getAcceptTypes() : null;
        if (accepts != null) {
          for (String t : accepts) {
            if (t != null && t.toLowerCase().contains("pdf")) { wantsPdf = true; break; }
          }
        }
        if (wantsPdf) {
          pick.setType("*/*");
          pick.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/*", "application/pdf"});
        } else {
          pick.setType("image/*");
        }

        boolean wantCamera = params != null && params.isCaptureEnabled() && camera != null;
        try {
          if (wantCamera) {
            startActivityForResult(camera, REQ_CAMERA);
            return true;
          }
          Intent chooser = Intent.createChooser(pick, wantsPdf ? "Add a photo or PDF" : "Add a photo");
          if (camera != null) {
            chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
          }
          startActivityForResult(chooser, REQ_CHOOSER);
        } catch (ActivityNotFoundException e) {
          try {
            startActivityForResult(pick, REQ_CHOOSER);
          } catch (ActivityNotFoundException e2) {
            if (pending != null) {
              pending.onReceiveValue(null);
              pending = null;
            }
          }
        }
        return true;
      }
    });

    if (saved != null) {
      web.restoreState(saved);
    } else {
      web.loadUrl(BASE);
    }
  }

  private boolean handle(Uri u) {
    if (u == null) return false;
    String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase();
    String host = u.getHost() == null ? "" : u.getHost().toLowerCase();
    boolean web = "http".equals(scheme) || "https".equals(scheme);
    if (web && (host.equals("motorledger-nine.vercel.app") || host.endsWith(".vercel.app"))) {
      return false;
    }
    try {
      startActivity(new Intent(Intent.ACTION_VIEW, u));
    } catch (Exception ignored) {
      return true;
    }
    return true;
  }

  private void showOffline() {
    if (offline) return;
    offline = true;
    String html = "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
        + "<body style='margin:0;font-family:system-ui,-apple-system,sans-serif;background:#f5f1e8;"
        + "color:#3a3226;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center'>"
        + "<div style='padding:32px'>"
        + "<h2 style='margin:0 0 8px;font-size:22px'>Can't reach MotorLedger</h2>"
        + "<p style='color:#7a6f5d;margin:0 0 20px;font-size:15px'>Check your connection, then try again.</p>"
        + "<a href='" + BASE + "' style='display:inline-block;background:#6b7c4f;color:#fff;"
        + "text-decoration:none;padding:12px 20px;border-radius:10px;font-size:16px'>Try again</a>"
        + "</div></body></html>";
    web.loadDataWithBaseURL(BASE, html, "text/html", "utf-8", null);
  }

  @Override
  protected void onActivityResult(int req, int res, Intent data) {
    if (req == REQ_CHOOSER) {
      Uri[] out = null;
      if (res == RESULT_OK) {
        if (data != null && data.getData() != null) {
          out = new Uri[]{data.getData()};
        } else if (data != null && data.getClipData() != null) {
          int n = data.getClipData().getItemCount();
          out = new Uri[n];
          for (int i = 0; i < n; i++) out[i] = data.getClipData().getItemAt(i).getUri();
        } else if (cameraUri != null) {
          out = new Uri[]{cameraUri};
        }
      }
      finishChooser(out);
    } else if (req == REQ_CAMERA) {
      finishChooser(res == RESULT_OK && cameraUri != null ? new Uri[]{cameraUri} : null);
    } else {
      super.onActivityResult(req, res, data);
    }
  }

  private void finishChooser(Uri[] out) {
    if (pending != null) {
      pending.onReceiveValue(out);
      pending = null;
    }
    cameraUri = null;
  }

  @Override
  protected void onSaveInstanceState(Bundle out) {
    super.onSaveInstanceState(out);
    if (web != null) web.saveState(out);
  }

  @Override
  public void onBackPressed() {
    if (web != null && web.canGoBack()) {
      web.goBack();
    } else {
      super.onBackPressed();
    }
  }

  private int dp(int v) {
    return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
  }
}
