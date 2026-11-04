package io.github.rldona.openlibrary

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.LibraryBooks
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import io.github.rldona.openlibrary.sync.SyncStatus
import io.github.rldona.openlibrary.sync.SyncWorker
import io.github.rldona.openlibrary.ui.book.BookFormScreen
import io.github.rldona.openlibrary.ui.book.BookFormViewModel
import io.github.rldona.openlibrary.ui.capture.CaptureMode
import io.github.rldona.openlibrary.ui.capture.CaptureScreen
import io.github.rldona.openlibrary.ui.cover.CoverViewModel
import io.github.rldona.openlibrary.ui.cover.CoverViewerScreen
import io.github.rldona.openlibrary.ui.review.ReviewScreen
import io.github.rldona.openlibrary.ui.review.ReviewViewModel
import io.github.rldona.openlibrary.ui.detail.DetailScreen
import io.github.rldona.openlibrary.ui.wishlist.WishlistScreen
import io.github.rldona.openlibrary.ui.wishlist.WishlistViewModel
import io.github.rldona.openlibrary.ui.detail.DetailViewModel
import io.github.rldona.openlibrary.ui.library.LibraryScreen
import io.github.rldona.openlibrary.ui.library.LibraryViewModel
import io.github.rldona.openlibrary.ui.locations.LocationsScreen
import io.github.rldona.openlibrary.ui.locations.LocationsViewModel
import io.github.rldona.openlibrary.ui.settings.SettingsScreen
import io.github.rldona.openlibrary.ui.settings.SettingsViewModel
import io.github.rldona.openlibrary.ui.setup.SetupScreen
import io.github.rldona.openlibrary.ui.setup.SetupViewModel
import io.github.rldona.openlibrary.ui.theme.OpenLibraryTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.Serializable

@Serializable object SetupRoute
@Serializable data class LibraryRoute(val locationId: String? = null)
@Serializable data class DetailRoute(val workId: String)
@Serializable object LocationsRoute
@Serializable object SettingsRoute
@Serializable data class AddBookRoute(val wishId: String? = null)
@Serializable object WishlistRoute
@Serializable data class EditBookRoute(val workId: String, val editionId: String)
/** Full-screen camera: `mode` is "isbn" or "cover"; `tabs` lets the user switch between them. */
@Serializable data class CaptureRoute(val mode: String, val tabs: Boolean)
@Serializable data class CoverRoute(val assetId: String, val title: String)
@Serializable object ReviewRoute

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val container = (application as OpenLibraryApp).container
        // Reading the small session file decides the first screen without a flash of the setup screen.
        val connected = runBlocking { container.sessions.session.first() != null }
        if (connected) SyncWorker.schedule(this)
        setContent { OpenLibraryTheme { App(container, connected) } }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun App(c: AppContainer, connected: Boolean) {
    val nav = rememberNavController()
    val context = LocalContext.current
    val entry by nav.currentBackStackEntryAsState()
    val dest = entry?.destination
    val inTabs = dest?.route?.let { r -> listOf("LibraryRoute", "LocationsRoute", "WishlistRoute", "SettingsRoute").any { r.contains(it) } } == true
    // Camera and cover viewer use the whole screen, without app bars.
    val fullScreen = dest?.route?.let { r -> "CaptureRoute" in r || "CoverRoute" in r } == true
    val inDetail = !inTabs && !fullScreen && dest?.route?.contains("SetupRoute") == false
    val status by c.sync.status.collectAsStateWithLifecycle()

    // Relative times ("2 min ago") refresh every half minute.
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        if (connected) {
            val result = c.sync.sync()
            if (result == SyncStatus.Offline) SyncWorker.whenOnline(context)
        }
        while (true) {
            delay(30_000)
            now = System.currentTimeMillis()
        }
    }
    LaunchedEffect(status) {
        if (status == SyncStatus.Revoked) {
            SyncWorker.cancel(context)
            c.sessions.clear()
            c.sync.clearLocal()
            nav.navigate(SetupRoute) { popUpTo(0) }
        }
    }

    Scaffold(
        topBar = {
            if (inDetail) {
                TopAppBar(
                    title = {},
                    navigationIcon = {
                        IconButton(onClick = { nav.popBackStack() }) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.detail_back))
                        }
                    },
                )
            }
        },
        bottomBar = { if (inTabs) Tabs(nav) },
    ) { padding ->
        NavHost(
            nav,
            startDestination = if (connected) LibraryRoute() else SetupRoute,
            modifier = if (fullScreen) Modifier else Modifier.padding(padding),
        ) {
            composable<SetupRoute> {
                val vm = viewModel<SetupViewModel>(
                    factory = viewModelFactory {
                        initializer {
                            SetupViewModel(c) {
                                SyncWorker.schedule(context)
                                nav.navigate(LibraryRoute()) { popUpTo(0) }
                            }
                        }
                    },
                )
                SetupScreen(vm)
            }
            composable<LibraryRoute> { e ->
                val route = e.toRoute<LibraryRoute>()
                val vm = viewModel<LibraryViewModel>(factory = viewModelFactory { initializer { LibraryViewModel(c, route.locationId) } })
                LibraryScreen(
                    vm,
                    now,
                    onOpen = { workId -> nav.navigate(DetailRoute(workId)) },
                    onAdd = { nav.navigate(AddBookRoute()) },
                    onReview = { nav.navigate(ReviewRoute) },
                )
            }
            composable<DetailRoute> { e ->
                val route = e.toRoute<DetailRoute>()
                val vm = viewModel<DetailViewModel>(factory = viewModelFactory { initializer { DetailViewModel(c, route.workId) } })
                DetailScreen(
                    vm,
                    onEdit = { workId, editionId -> nav.navigate(EditBookRoute(workId, editionId)) },
                    onCover = { id, title -> nav.navigate(CoverRoute(id, title)) },
                )
            }
            composable<AddBookRoute> { e ->
                val route = e.toRoute<AddBookRoute>()
                val vm = viewModel<BookFormViewModel>(
                    factory = viewModelFactory { initializer { BookFormViewModel(c, null, null, route.wishId) } },
                )
                BookForm(vm, e.savedStateHandle, nav, onWishAdded = { nav.popBackStack() }) { workId ->
                    nav.navigate(DetailRoute(workId)) { popUpTo<AddBookRoute> { inclusive = true } }
                }
            }
            composable<WishlistRoute> {
                val vm = viewModel<WishlistViewModel>(factory = viewModelFactory { initializer { WishlistViewModel(c) } })
                WishlistScreen(vm) { wishId -> nav.navigate(AddBookRoute(wishId)) }
            }
            composable<EditBookRoute> { e ->
                val route = e.toRoute<EditBookRoute>()
                val vm = viewModel<BookFormViewModel>(
                    factory = viewModelFactory { initializer { BookFormViewModel(c, route.workId, route.editionId) } },
                )
                BookForm(vm, e.savedStateHandle, nav) { nav.popBackStack() }
            }
            composable<CaptureRoute> { e ->
                val route = e.toRoute<CaptureRoute>()
                CaptureScreen(c.covers, if (route.mode == "cover") CaptureMode.Cover else CaptureMode.Isbn, route.tabs) { result ->
                    nav.previousBackStackEntry?.savedStateHandle?.let { h ->
                        result.isbn?.let { h["isbn"] = it }
                        result.photoId?.let { h["photo"] = it }
                    }
                    nav.popBackStack()
                }
            }
            composable<CoverRoute> { e ->
                val route = e.toRoute<CoverRoute>()
                val vm = viewModel<CoverViewModel>(factory = viewModelFactory { initializer { CoverViewModel(c, route.assetId) } })
                CoverViewerScreen(vm, route.title) { nav.popBackStack() }
            }
            composable<ReviewRoute> {
                val vm = viewModel<ReviewViewModel>(factory = viewModelFactory { initializer { ReviewViewModel(c) } })
                ReviewScreen(vm)
            }
            composable<LocationsRoute> {
                val vm = viewModel<LocationsViewModel>(factory = viewModelFactory { initializer { LocationsViewModel(c) } })
                LocationsScreen(vm) { id -> nav.navigate(LibraryRoute(id)) }
            }
            composable<SettingsRoute> {
                val vm = viewModel<SettingsViewModel>(
                    factory = viewModelFactory { initializer { SettingsViewModel(c) { nav.navigate(SetupRoute) { popUpTo(0) } } } },
                )
                SettingsScreen(vm, now, context) { nav.navigate(ReviewRoute) }
            }
        }
    }
}

/** The scanner and the camera hand their result back through the form's SavedStateHandle. */
@Composable
private fun BookForm(
    vm: BookFormViewModel,
    state: androidx.lifecycle.SavedStateHandle,
    nav: NavHostController,
    onWishAdded: () -> Unit = {},
    onSaved: (String) -> Unit,
) {
    val isbn by state.getStateFlow<String?>("isbn", null).collectAsStateWithLifecycle()
    val photo by state.getStateFlow<String?>("photo", null).collectAsStateWithLifecycle()
    BookFormScreen(
        vm,
        scannedIsbn = isbn,
        photoId = photo,
        // Adding a book: ISBN then cover in one camera session. Editing: just the camera for each.
        onScan = { nav.navigate(CaptureRoute("isbn", tabs = !vm.editing)) },
        onPhoto = { nav.navigate(CaptureRoute("cover", tabs = false)) },
        onOpenWork = { workId -> nav.navigate(DetailRoute(workId)) },
        onSaved = onSaved,
        onWishAdded = onWishAdded,
    )
}

@Composable
private fun Tabs(nav: NavHostController) {
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route.orEmpty()
    NavigationBar {
        listOf(
            Triple(LibraryRoute(), R.string.nav_library, Icons.AutoMirrored.Filled.LibraryBooks) to "LibraryRoute",
            Triple(LocationsRoute, R.string.nav_locations, Icons.Default.Place) to "LocationsRoute",
            Triple(WishlistRoute, R.string.nav_wishlist, Icons.Default.Favorite) to "WishlistRoute",
            Triple(SettingsRoute, R.string.nav_settings, Icons.Default.Settings) to "SettingsRoute",
        ).forEach { (item, name) ->
            val (target, label, icon) = item
            NavigationBarItem(
                selected = route.contains(name),
                onClick = {
                    nav.navigate(target) {
                        popUpTo(nav.graph.startDestinationId) { saveState = true }
                        launchSingleTop = true
                        restoreState = true
                    }
                },
                icon = { Icon(icon, contentDescription = null) },
                label = { Text(stringResource(label)) },
            )
        }
    }
}
