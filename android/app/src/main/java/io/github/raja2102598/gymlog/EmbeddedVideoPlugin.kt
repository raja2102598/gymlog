package io.github.raja2102598.gymlog

import android.net.Uri
import com.getcapacitor.Plugin
import com.getcapacitor.annotation.CapacitorPlugin
import java.net.URI

/** Which addresses are a lift's video player (src/lib/videos.ts): YouTube's embedded player on youtube-nocookie.com,
 *  over https. Pure, for EmbeddedVideoTest. */
object EmbeddedVideo {
    fun isPlayer(url: String): Boolean {
        val u = try {
            URI(url)
        } catch (e: Exception) {
            return false
        }
        return u.scheme == "https" && u.host.equals("www.youtube-nocookie.com", ignoreCase = true) && (u.path ?: "").startsWith("/embed/")
    }
}

/**
 * Lets a lift's video play inside the app. Capacitor hands every page the app doesn't serve to another app, an
 * iframe's too, which would open the video in YouTube instead of in the how-to. This keeps only the player in the
 * app; youtube.com itself (the player's own YouTube button, More on YouTube) still opens YouTube. Listing the host in
 * capacitor.config's allowNavigation would do it too, but would also let that page call the app's plugins.
 */
@CapacitorPlugin(name = "EmbeddedVideo")
class EmbeddedVideoPlugin : Plugin() {
    override fun shouldOverrideLoad(url: Uri): Boolean? = if (EmbeddedVideo.isPlayer(url.toString())) false else null
}
