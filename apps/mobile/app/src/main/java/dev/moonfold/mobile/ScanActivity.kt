package dev.moonfold.mobile

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.View
import android.widget.Button
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.google.zxing.BarcodeFormat
import com.journeyapps.barcodescanner.BarcodeCallback
import com.journeyapps.barcodescanner.BarcodeResult
import com.journeyapps.barcodescanner.DecoratedBarcodeView
import com.journeyapps.barcodescanner.DefaultDecoderFactory

/** Reads one Moonfold pairing code and hands it back to [MainActivity]. */
class ScanActivity : ComponentActivity() {
    private lateinit var scanner: DecoratedBarcodeView
    private lateinit var cameraNeeded: View

    private val askForCamera =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            cameraNeeded.visibility = if (granted) View.GONE else View.VISIBLE
            if (granted) startScanning()
        }

    private val onResult = object : BarcodeCallback {
        override fun barcodeResult(result: BarcodeResult) {
            val text = result.text.orEmpty()
            if (parsePairingCode(text) == null) {
                scanner.setStatusText(getString(R.string.scan_wrong_code))
                scanner.decodeSingle(this)
                return
            }
            setResult(RESULT_OK, Intent().putExtra(EXTRA_CODE, text))
            finish()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContentView(R.layout.activity_scan)
        scanner = findViewById(R.id.scanner)
        cameraNeeded = findViewById(R.id.cameraNeeded)
        scanner.barcodeView.decoderFactory = DefaultDecoderFactory(listOf(BarcodeFormat.QR_CODE))
        scanner.setStatusText(getString(R.string.scan_hint))
        findViewById<Button>(R.id.allowCamera).setOnClickListener {
            askForCamera.launch(Manifest.permission.CAMERA)
        }
        if (hasCamera()) scanner.decodeSingle(onResult) else askForCamera.launch(Manifest.permission.CAMERA)
    }

    override fun onResume() {
        super.onResume()
        if (hasCamera()) scanner.resume()
    }

    override fun onPause() {
        super.onPause()
        scanner.pause()
    }

    private fun startScanning() {
        scanner.decodeSingle(onResult)
        scanner.resume()
    }

    private fun hasCamera() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED

    companion object {
        const val EXTRA_CODE = "code"
    }
}
