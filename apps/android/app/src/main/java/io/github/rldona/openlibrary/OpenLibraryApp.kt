package io.github.rldona.openlibrary

import android.app.Application
import io.github.rldona.openlibrary.data.AppDatabase
import io.github.rldona.openlibrary.data.DataStoreSessionStore
import io.github.rldona.openlibrary.data.SessionStore
import io.github.rldona.openlibrary.network.ApiClient
import io.github.rldona.openlibrary.sync.CoverStore
import io.github.rldona.openlibrary.sync.SyncRepository
import java.io.File

/** Manual dependency wiring: small enough that a DI framework would only add build time. */
class AppContainer(app: Application) {
    val db: AppDatabase = AppDatabase.open(app)
    val sessions: SessionStore = DataStoreSessionStore(app)
    val covers = CoverStore(File(app.filesDir, "covers"))
    val api: (String, String?) -> ApiClient = { url, token -> ApiClient(url, token) }
    val sync = SyncRepository(db, sessions, covers, apiFor = { url, token -> api(url, token) })
}

class OpenLibraryApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
