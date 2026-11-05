package io.github.rldona.openlibrary

import android.app.Application
import io.github.rldona.openlibrary.data.AppDatabase
import io.github.rldona.openlibrary.data.DataStoreSessionStore
import io.github.rldona.openlibrary.data.LockPolicy
import io.github.rldona.openlibrary.data.LockSettings
import io.github.rldona.openlibrary.data.SessionStore
import io.github.rldona.openlibrary.network.ApiClient
import io.github.rldona.openlibrary.sync.CoverStore
import io.github.rldona.openlibrary.sync.LocalWrites
import io.github.rldona.openlibrary.sync.SyncRepository
import io.github.rldona.openlibrary.sync.SyncWorker
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/** Manual dependency wiring: small enough that a DI framework would only add build time. */
class AppContainer(app: Application) {
    /** Opened on first use (encrypted, so it needs the native SQLCipher library: not in JVM unit tests). */
    val db: AppDatabase by lazy { AppDatabase.open(app) }
    val sessions: SessionStore = DataStoreSessionStore(app)
    val covers = CoverStore(File(app.filesDir, "covers"))
    val api: (String, String?) -> ApiClient = { url, token -> ApiClient(url, token) }
    val sync by lazy {
        SyncRepository(db, sessions, covers, apiFor = { url, token -> api(url, token) })
    }
    /** Every local change schedules a sync a few seconds later (several quick edits share one push). */
    val writes by lazy { LocalWrites(db, onQueued = { SyncWorker.soon(app) }) }
    /** Work that must finish even if the screen that started it closes (e.g. books scanned in bulk). */
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val lockSettings = LockSettings(app)
    val lock = LockPolicy()
}

class OpenLibraryApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
