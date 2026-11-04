package io.github.rldona.openlibrary.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import io.github.rldona.openlibrary.OpenLibraryApp
import java.util.concurrent.TimeUnit

/** Background sync: every 30 minutes while there is a network, and once when the network comes back. */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val sync = (applicationContext as OpenLibraryApp).container.sync
        return when (sync.sync()) {
            SyncStatus.Offline -> Result.retry()
            else -> Result.success()
        }
    }

    companion object {
        private const val PERIODIC = "sync-periodic"
        private const val ONCE = "sync-once"
        private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun schedule(context: Context) {
            val periodic =
                PeriodicWorkRequestBuilder<SyncWorker>(30, TimeUnit.MINUTES).setConstraints(online).build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, periodic)
        }

        /** Runs a sync as soon as there is a network (used when the app could not reach the server). */
        fun whenOnline(context: Context) {
            val once = OneTimeWorkRequestBuilder<SyncWorker>().setConstraints(online).build()
            WorkManager.getInstance(context).enqueueUniqueWork(ONCE, ExistingWorkPolicy.KEEP, once)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
            WorkManager.getInstance(context).cancelUniqueWork(ONCE)
        }
    }
}
