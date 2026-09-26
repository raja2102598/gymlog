package io.github.raja2102598.gymlog

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** What EmbeddedVideoPlugin keeps in the app: a lift's video player (src/lib/videos.ts's embedUrl), and nothing else. */
class EmbeddedVideoTest {
    @Test
    fun thePlayerStaysInTheApp() {
        assertTrue(EmbeddedVideo.isPlayer("https://www.youtube-nocookie.com/embed/aBc_12-XyZ?autoplay=1&playsinline=1&rel=0"))
    }

    @Test
    fun youTubeItselfAndLookalikesGoToAnotherApp() {
        assertFalse(EmbeddedVideo.isPlayer("https://www.youtube.com/watch?v=aBc_12-XyZ"))
        assertFalse(EmbeddedVideo.isPlayer("https://www.youtube.com/embed/aBc_12-XyZ"))
        assertFalse(EmbeddedVideo.isPlayer("https://www.youtube-nocookie.com/watch?v=aBc_12-XyZ"))
        assertFalse(EmbeddedVideo.isPlayer("http://www.youtube-nocookie.com/embed/aBc_12-XyZ"))
        assertFalse(EmbeddedVideo.isPlayer("https://www.youtube-nocookie.com.example.com/embed/aBc_12-XyZ"))
        assertFalse(EmbeddedVideo.isPlayer("https://example.com/https://www.youtube-nocookie.com/embed/aBc_12-XyZ"))
        assertFalse(EmbeddedVideo.isPlayer("not an address"))
    }
}
