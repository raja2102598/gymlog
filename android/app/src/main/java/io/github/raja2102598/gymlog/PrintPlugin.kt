package io.github.raja2102598.gymlog

import android.content.Context
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.WebView
import android.webkit.WebViewClient
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Prints a page the app made (the plan, src/lib/planShare.ts) through Android's print service, whose dialog also saves
 * it as a PDF (src/lib/print.ts): the app's own WebView can't print. The page is laid out in a WebView of its own,
 * kept until the next print so the print job can still read it.
 */
@CapacitorPlugin(name = "GymPrint")
class PrintPlugin : Plugin() {
    private var page: WebView? = null

    /** { html, name } */
    @PluginMethod
    fun print(call: PluginCall) {
        val html = call.getString("html")
        val name = call.getString("name") ?: "Gym Log"
        if (html.isNullOrEmpty()) {
            call.reject("html is needed")
            return
        }
        activity.runOnUiThread {
            val view = WebView(activity)
            page = view
            view.webViewClient = object : WebViewClient() {
                override fun onPageFinished(v: WebView, url: String?) {
                    val printer = activity.getSystemService(Context.PRINT_SERVICE) as PrintManager
                    printer.print(name, v.createPrintDocumentAdapter(name), PrintAttributes.Builder().build())
                    call.resolve()
                }
            }
            view.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
        }
    }
}
