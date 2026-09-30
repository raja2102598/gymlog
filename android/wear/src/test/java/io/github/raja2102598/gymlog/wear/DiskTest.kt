package io.github.raja2102598.gymlog.wear

import java.io.File
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** The watch's files (Disk): written whole, in order, off the caller's thread, and on the disk once `flush` returns,
 *  which StateListenerService waits for before Android may end the process. */
class DiskTest {
    @get:Rule
    val tmp = TemporaryFolder()

    @Test
    fun flushReturnsOnlyOnceTheFilesHoldWhatWasSaved() {
        val dir = tmp.root
        val errors = mutableListOf<String>()
        val executor = Executors.newSingleThreadExecutor()
        // A write before it, still going: the state saved now waits behind it.
        val going = CountDownLatch(1)
        executor.execute { going.await() }
        val disk = Disk({ what, _ -> errors += what }, executor)
        Disk.write(dir, "state.json", "old")
        disk.save(dir, "state.json", "new")
        assertEquals("old", Disk.read(dir, "state.json"))
        Thread {
            Thread.sleep(200)
            going.countDown()
        }.start()
        disk.flush()
        assertEquals("new", Disk.read(dir, "state.json"))
        // One that can't be written is said, and doesn't hold the rest up.
        disk.save(File(dir, "gone"), "pending.json", "[]")
        disk.flush()
        assertEquals(listOf("pending.json"), errors)
        executor.shutdown()
    }

    @Test
    fun aFileIsReplacedWholeOrNotAtAll() {
        val dir = tmp.root
        Disk.write(dir, "state.json", "old")
        // Killed once the new one was written out, before it took the old one's place: the old one is what's read.
        try {
            Disk.write(dir, "state.json", "new", beforeRename = { throw IOException("killed") })
        } catch (e: IOException) {
            // as the process would be
        }
        assertEquals("old", Disk.read(dir, "state.json"))
        // The next write goes through, over what that one left behind.
        Disk.write(dir, "state.json", "newer")
        assertEquals("newer", Disk.read(dir, "state.json"))
        assertEquals(listOf("state.json"), dir.list()!!.toList())
        assertNull(Disk.read(dir, "heart.json"))
    }
}
