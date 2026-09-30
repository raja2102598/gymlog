package io.github.raja2102598.gymlog.wear

import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * The watch's files (docs/watch.md): the phone's last state, the commands waiting on it, and the heart rate's days.
 * Each is written whole to a temporary file, to the disk, and then renamed over the one before, so a read after
 * Android killed the process mid-write finds the last whole one, never part of the next. Writes go in the order asked,
 * off the caller's thread (`save`); `flush` waits for all those asked so far, for a component Android may end the
 * process after returning from (StateListenerService). Pure JVM, for DiskTest; WatchRepo keeps one for the app.
 */
class Disk(
    private val onError: (what: String, e: Exception) -> Unit,
    private val executor: ExecutorService = Executors.newSingleThreadExecutor(),
) {
    /** Writes file `name` in `dir` as `text`, after those asked for before it. */
    fun save(dir: File, name: String, text: String) {
        executor.execute {
            try {
                write(dir, name, text)
            } catch (e: Exception) {
                onError(name, e)
            }
        }
    }

    /** Returns once every file asked for before it is on the disk (or has failed to be), or after `timeoutMs`. */
    fun flush(timeoutMs: Long = FLUSH_MS) {
        try {
            executor.submit {}.get(timeoutMs, TimeUnit.MILLISECONDS)
        } catch (e: Exception) {
            onError("the files", e)
        }
    }

    companion object {
        /** Long enough for the few small files there are, short of the time Android gives a listener service. */
        const val FLUSH_MS = 5_000L

        /** Writes file `name` in `dir` whole: to `name.tmp`, to the disk, then renamed over `name` in one step.
         *  `beforeRename` is for DiskTest, to stop there as if the process had been killed. */
        fun write(dir: File, name: String, text: String, beforeRename: () -> Unit = {}) {
            val tmp = File(dir, "$name.tmp")
            FileOutputStream(tmp).use { out ->
                out.write(text.toByteArray(Charsets.UTF_8))
                out.fd.sync()
            }
            beforeRename()
            Files.move(tmp.toPath(), File(dir, name).toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        }

        /** File `name` in `dir`, or null for none. A temporary one a killed write left is never read. */
        fun read(dir: File, name: String): String? =
            try {
                File(dir, name).readText(Charsets.UTF_8)
            } catch (e: Exception) {
                null
            }
    }
}
