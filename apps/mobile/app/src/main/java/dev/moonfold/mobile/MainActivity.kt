package dev.moonfold.mobile

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.net.http.SslCertificate
import android.net.http.SslError
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.graphics.ColorUtils
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

private const val CHECK_WHILE_SHOWN_MS = 10_000L
private const val CHECK_WHILE_WAITING_MS = 3_000L
/** A single missed check can be the radio waking up, so one miss does not cover the host's UI. */
private const val MISSES_BEFORE_WAITING = 2
private const val THEME_SETTLE_MS = 400L
/** A canvas normalises any CSS color, oklch() included, to the #rrggbb that Android can parse. */
private const val READ_PAGE_BACKGROUND =
    "(() => { const context = document.createElement('canvas').getContext('2d');" +
        " context.fillStyle = getComputedStyle(document.body).backgroundColor;" +
        " return context.fillStyle; })()"

/**
 * The whole app (D-57): one full-screen view of the paired computer's own Moonfold, a status screen
 * for every moment it cannot be shown, and the scan that pairs it. Nothing here keeps agent data.
 */
class MainActivity : ComponentActivity() {
    private lateinit var store: PairingStore
    private lateinit var root: View
    private lateinit var webContainer: View
    private lateinit var webView: WebView
    private lateinit var status: View
    private lateinit var statusTitle: TextView
    private lateinit var statusBody: TextView
    private lateinit var statusProgress: ProgressBar
    private lateinit var statusAction: Button

    private val main = Handler(Looper.getMainLooper())
    private val background = Executors.newSingleThreadExecutor()
    private val checking = AtomicBoolean(false)
    private var shownOrigin: String? = null
    private var misses = 0
    private var resumed = false
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var proxy: RelayProxy? = null

    private val scheduledCheck = Runnable { checkHost() }

    private val scan =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val code = result.data?.getStringExtra(ScanActivity.EXTRA_CODE)?.let(::parsePairingCode)
            if (code != null) pair(code)
        }

    private val pickFiles =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            fileCallback?.onReceiveValue(
                WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data),
            )
            fileCallback = null
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContentView(R.layout.activity_main)
        store = PairingStore(this)
        root = findViewById(R.id.root)
        webContainer = findViewById(R.id.webContainer)
        status = findViewById(R.id.status)
        statusTitle = findViewById(R.id.statusTitle)
        statusBody = findViewById(R.id.statusBody)
        statusProgress = findViewById(R.id.statusProgress)
        statusAction = findViewById(R.id.statusAction)

        ViewCompat.setOnApplyWindowInsetsListener(webContainer) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout() or
                    WindowInsetsCompat.Type.ime(),
            )
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        webView = WebView(this)
        configureWebView()
        (webContainer as ViewGroup).addView(
            webView,
            ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (shownOrigin != null && webView.canGoBack()) webView.goBack() else moveTaskToBack(true)
            }
        })

        if (store.host == null) showWelcome() else showConnecting(store.host!!)
        handleLink(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleLink(intent)
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        webView.onResume()
        store.host?.let(::startRelay)
        checkHost()
    }

    override fun onPause() {
        super.onPause()
        resumed = false
        main.removeCallbacks(scheduledCheck)
        webView.onPause()
        CookieManager.getInstance().flush()
        // The system cuts idle sockets in the background anyway; reopen on return.
        stopRelay()
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        stopRelay()
        background.shutdown()
        webView.destroy()
        super.onDestroy()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (status.visibility != View.VISIBLE) main.postDelayed(::matchBarsToPage, THEME_SETTLE_MS)
    }

    /** Paints the area behind the system bars with the page's own background, whatever its theme. */
    private fun matchBarsToPage() {
        webView.evaluateJavascript(READ_PAGE_BACKGROUND) { result ->
            val hex = result.trim('"')
            val color = runCatching { Color.parseColor(hex) }.getOrNull() ?: return@evaluateJavascript
            if (status.visibility == View.VISIBLE) return@evaluateJavascript
            root.setBackgroundColor(color)
            val light = ColorUtils.calculateLuminance(color) > 0.5
            WindowCompat.getInsetsController(window, window.decorView).apply {
                isAppearanceLightStatusBars = light
                isAppearanceLightNavigationBars = light
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            allowFileAccess = false
            allowContentAccess = false
            setGeolocationEnabled(false)
            setSupportZoom(false)
            builtInZoomControls = false
            textZoom = 100
            userAgentString = "$userAgentString MoonfoldMobile/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        webView.webViewClient = object : WebViewClient() {
            // A self-signed certificate always lands here: this is what pins the page and its
            // WebSocket to the computer in the QR code.
            @SuppressLint("WebViewClientOnReceivedSslError")
            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                val pinned = store.host?.sha256
                val der = error.certificate?.let(::certificateDer)
                if (pinned != null && der != null && certificateSha256(der) == pinned) {
                    handler.proceed()
                } else {
                    handler.cancel()
                }
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (isHostUrl(url)) return false
                if (url.scheme == "http" || url.scheme == "https") openElsewhere(url)
                return true
            }

            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                if (!isHostUrl(Uri.parse(url))) view.stopLoading()
            }

            override fun onPageFinished(view: WebView, url: String) {
                matchBarsToPage()
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError,
            ) {
                if (request.isForMainFrame) {
                    misses = MISSES_BEFORE_WAITING
                    checkHost()
                }
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    pickFiles.launch(params.createIntent())
                    true
                } catch (_: ActivityNotFoundException) {
                    fileCallback = null
                    false
                }
            }
        }
    }

    private fun certificateDer(certificate: SslCertificate): ByteArray? =
        SslCertificate.saveState(certificate).getByteArray("x509-certificate")

    private fun isHostUrl(url: Uri): Boolean {
        val host = store.host ?: return false
        return url.scheme == "https" && url.port == host.port && url.host in host.reachableAddresses
    }

    /** Opens the loopback listener for a computer paired with a relay; nothing otherwise. */
    private fun startRelay(host: PairedHost) {
        val relay = host.relay
        val current = proxy
        if (relay == null) return stopRelay()
        if (current != null && current.running && current.matches(relay, host.port)) return
        stopRelay()
        proxy = RelayProxy(relay, host.port).takeIf { it.start() }
    }

    private fun stopRelay() {
        proxy?.stop()
        proxy = null
    }

    private fun openElsewhere(url: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, R.string.no_browser, Toast.LENGTH_SHORT).show()
        }
    }

    /** A link can come from any page, so unlike a scan it pairs only after the owner agrees. */
    private fun handleLink(intent: Intent?) {
        if (intent?.action != Intent.ACTION_VIEW) return
        val code = intent.dataString?.let(::parsePairingCode)
        intent.data = null
        if (code == null) return
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.confirm_title, code.host.name))
            .setMessage(
                getString(
                    R.string.confirm_body,
                    code.host.addresses.firstOrNull() ?: code.host.name,
                ),
            )
            .setPositiveButton(R.string.confirm_connect) { _, _ -> pair(code) }
            .setNegativeButton(R.string.confirm_cancel, null)
            .show()
    }

    private fun pair(code: PairingCode) {
        showConnecting(code.host)
        main.removeCallbacks(scheduledCheck)
        startRelay(code.host)
        background.execute {
            val cookies = CookieManager.getInstance()
            val outcome = HostClient(code.host).exchange(code.token) { cookies.getCookie(it) }
            main.post { finishPairing(code.host, outcome) }
        }
    }

    private fun finishPairing(host: PairedHost, outcome: Exchange) {
        when (outcome) {
            is Exchange.Session -> {
                if (store.host?.sha256 != host.sha256) forgetSession()
                store.host = host
                store.lastAddress = outcome.origin.substringAfter("://").substringBefore(':')
                // Cookies belong to one address, and a phone reaches a computer by whichever
                // address its current network offers, so every address gets the same session.
                val cookies = CookieManager.getInstance()
                val cookie = outcome.cookie
                val header = "${cookie.name}=${cookie.value}; Path=/; Secure; HttpOnly; " +
                    "SameSite=Lax; Max-Age=${cookie.maxAgeSeconds}"
                host.reachableAddresses.forEach { cookies.setCookie(host.origin(it), header) }
                cookies.flush()
                show(outcome.origin)
            }
            Exchange.CodeRejected ->
                showFailure(R.string.code_used_title, R.string.code_used_body)
            Exchange.Unreachable ->
                showFailure(R.string.unreachable_title, R.string.unreachable_body)
        }
    }

    private fun forgetSession() {
        CookieManager.getInstance().removeAllCookies(null)
        WebStorage.getInstance().deleteAllData()
        webView.clearCache(true)
        webView.clearHistory()
    }

    private fun checkHost() {
        main.removeCallbacks(scheduledCheck)
        val host = store.host ?: return
        if (!checking.compareAndSet(false, true)) return
        val last = store.lastAddress
        val addresses = host.reachableAddresses.sortedBy { if (it == last) 0 else 1 }
        val cookies = CookieManager.getInstance()
        background.execute {
            val state = runCatching {
                HostClient(host).check(addresses) { cookies.getCookie(it) }
            }.getOrDefault(HostState.Unreachable)
            main.post {
                checking.set(false)
                if (store.host?.sha256 == host.sha256) apply(host, state)
            }
        }
    }

    private fun apply(host: PairedHost, state: HostState) {
        when (state) {
            is HostState.Signed -> {
                misses = 0
                store.lastAddress = state.origin.substringAfter("://").substringBefore(':')
                if (shownOrigin != state.origin) show(state.origin) else matchBarsToPage()
            }
            HostState.Revoked -> {
                forgetSession()
                store.host = null
                shownOrigin = null
                webView.loadUrl("about:blank")
                showFailure(R.string.revoked_title, R.string.revoked_body)
            }
            HostState.Unreachable -> {
                misses += 1
                if (shownOrigin == null || misses >= MISSES_BEFORE_WAITING) showWaiting(host)
            }
        }
        if (resumed && store.host != null) {
            val delay = if (shownOrigin == null) CHECK_WHILE_WAITING_MS else CHECK_WHILE_SHOWN_MS
            main.postDelayed(scheduledCheck, delay)
        }
    }

    private fun show(origin: String) {
        shownOrigin = origin
        misses = 0
        webView.loadUrl("$origin/")
        status.visibility = View.GONE
        webContainer.visibility = View.VISIBLE
        if (resumed) checkHost()
    }

    private fun showStatus(title: String, body: String?, busy: Boolean, action: Int?) {
        status.visibility = View.VISIBLE
        webContainer.visibility = View.INVISIBLE
        statusTitle.text = title
        statusBody.text = body
        statusBody.visibility = if (body == null) View.GONE else View.VISIBLE
        statusProgress.visibility = if (busy) View.VISIBLE else View.GONE
        statusAction.visibility = if (action == null) View.GONE else View.VISIBLE
        if (action != null) {
            statusAction.setText(action)
            statusAction.setOnClickListener {
                scan.launch(Intent(this, ScanActivity::class.java))
            }
        }
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
    }

    private fun showWelcome() =
        showStatus(getString(R.string.welcome_title), getString(R.string.welcome_body), false, R.string.scan)

    private fun showConnecting(host: PairedHost) =
        showStatus(getString(R.string.connecting_title, host.name), null, true, null)

    private fun showWaiting(host: PairedHost) {
        shownOrigin = null
        showStatus(
            getString(R.string.waiting_title, host.name),
            getString(R.string.waiting_body),
            true,
            R.string.scan_new,
        )
    }

    private fun showFailure(title: Int, body: Int) {
        showStatus(getString(title), getString(body), false, R.string.scan)
        checkAfterFailure()
    }

    /** A failed scan leaves an earlier pairing intact, so go back to following that computer. */
    private fun checkAfterFailure() {
        val host = store.host ?: return
        main.postDelayed({ if (shownOrigin == null) showConnecting(host) }, CHECK_WHILE_WAITING_MS * 2)
        main.postDelayed(scheduledCheck, CHECK_WHILE_WAITING_MS * 2)
    }
}
