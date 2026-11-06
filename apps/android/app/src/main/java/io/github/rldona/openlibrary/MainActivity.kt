package io.github.rldona.openlibrary

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.LibraryBooks
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.HorizontalDivider
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.fragment.app.FragmentActivity
import io.github.rldona.openlibrary.ui.lock.LockScreen
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import io.github.rldona.openlibrary.network.ApiJson
import io.github.rldona.openlibrary.network.MetadataCandidate
import io.github.rldona.openlibrary.sync.SyncStatus
import io.github.rldona.openlibrary.sync.SyncWorker
import io.github.rldona.openlibrary.ui.book.BookFormScreen
import io.github.rldona.openlibrary.ui.book.BookFormViewModel
import io.github.rldona.openlibrary.ui.capture.CaptureMode
import io.github.rldona.openlibrary.ui.capture.CaptureScreen
import io.github.rldona.openlibrary.ui.capture.BulkScanScreen
import io.github.rldona.openlibrary.ui.capture.BulkScanViewModel
import io.github.rldona.openlibrary.ui.capture.IdentifySearch
import io.github.rldona.openlibrary.ui.cover.CoverViewModel
import io.github.rldona.openlibrary.ui.cover.CoverViewerScreen
import io.github.rldona.openlibrary.ui.review.ReviewScreen
import io.github.rldona.openlibrary.ui.review.ReviewViewModel
import io.github.rldona.openlibrary.ui.detail.DetailScreen
import io.github.rldona.openlibrary.ui.stats.StatsScreen
import io.github.rldona.openlibrary.ui.stats.StatsViewModel
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
import java.io.IOException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.Serializable

@Serializable object SetupRoute
@Serializable data class LibraryRoute(val locationId: String? = null)
@Serializable data class DetailRoute(val workId: String, val editionId: String? = null)
@Serializable object LocationsRoute
@Serializable object SettingsRoute
@Serializable data class AddBookRoute(val wishId: String? = null)
@Serializable object WishlistRoute
@Serializable object StatsRoute
@Serializable data class EditBookRoute(val workId: String, val editionId: String)
/** Full-screen camera: `mode` is "isbn", "cover" or "identify"; `tabs` lets the user switch between them. */
@Serializable data class CaptureRoute(val mode: String, val tabs: Boolean)
@Serializable data class CoverRoute(val assetId: String, val title: String)
@Serializable object ReviewRoute
@Serializable object BulkScanRoute

/** A FragmentActivity because the system fingerprint/PIN prompt needs one. */
class MainActivity : FragmentActivity() {
    private val container get() = (application as OpenLibraryApp).container

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Reading the small session file decides the first screen without a flash of the setup screen.
        val connected = runBlocking { container.sessions.session.first() != null }
        if (connected) SyncWorker.schedule(this)
        setContent {
            OpenLibraryTheme {
                // The app stays composed under the lock so you come back to where you were (a half-filled form…).
                val locked by container.lock.locked.collectAsStateWithLifecycle()
                Box {
                    Box(if (locked) Modifier.clearAndSetSemantics {} else Modifier) { App(container, connected) }
                    if (locked) LockScreen { container.lock.unlocked() }
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        val enabled = runBlocking { container.lockSettings.current() }
        container.lock.onStart(enabled, System.currentTimeMillis())
        // The recent-apps thumbnail would show the library while the app is locked.
        if (android.os.Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(!enabled)
    }

    override fun onStop() {
        super.onStop()
        container.lock.onStop(System.currentTimeMillis())
    }
}

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
private fun App(c: AppContainer, connected: Boolean) {
    val nav = rememberNavController()
    val context = LocalContext.current
    val entry by nav.currentBackStackEntryAsState()
    val dest = entry?.destination
    val inTabs = dest?.route?.let { r -> listOf("LibraryRoute", "LocationsRoute", "WishlistRoute", "StatsRoute", "SettingsRoute").any { r.contains(it) } } == true
    // Camera and cover viewer use the whole screen, without app bars.
    val fullScreen = dest?.route?.let { r -> "CaptureRoute" in r || "CoverRoute" in r || "BulkScanRoute" in r } == true
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
        bottomBar = {
            // It belongs to the tab screens: slide it down as the detail comes in, and back up on return.
            AnimatedVisibility(
                visible = inTabs,
                enter = fadeIn(tween(180)) + slideInVertically(tween(220)) { it },
                exit = fadeOut(tween(120)) + slideOutVertically(tween(180)) { it },
            ) {
                Column {
                    // Like the web's sidebar: on the page background, separated by a `line` rule.
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Tabs(nav)
                }
            }
        },
    ) { padding ->
        // One shared-transition layout around the NavHost, so the cover can travel between the
        // library item and the detail header while each destination keeps its own AnimatedVisibilityScope.
        SharedTransitionLayout(modifier = if (fullScreen) Modifier else Modifier.padding(padding)) {
            val sharedTransitionScope = this
            NavHost(
                nav,
                startDestination = if (connected) LibraryRoute() else SetupRoute,
                modifier = Modifier.fillMaxSize(),
                // Material shared axis X: spatial motion forwards and backwards, with a short fade.
                enterTransition = { sharedAxisEnter() },
                exitTransition = { sharedAxisExit() },
                popEnterTransition = { sharedAxisPopEnter() },
                popExitTransition = { sharedAxisPopExit() },
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
                        sharedTransitionScope = sharedTransitionScope,
                        animatedVisibilityScope = this,
                        onOpen = { workId, editionId -> nav.navigate(DetailRoute(workId, editionId)) },
                        onAdd = { nav.navigate(AddBookRoute()) },
                        onBulk = { nav.navigate(BulkScanRoute) },
                        onReview = { nav.navigate(ReviewRoute) },
                    )
                }
                // The shared cover carries the transition while the detail itself slides in.
                composable<DetailRoute> { e ->
                    val route = e.toRoute<DetailRoute>()
                    val vm = viewModel<DetailViewModel>(factory = viewModelFactory { initializer { DetailViewModel(c, route.workId) } })
                    DetailScreen(
                        vm,
                        editionId = route.editionId,
                        sharedTransitionScope = sharedTransitionScope,
                        animatedVisibilityScope = this,
                        onBack = { nav.popBackStack() },
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
                composable<StatsRoute> {
                    val vm = viewModel<StatsViewModel>(factory = viewModelFactory { initializer { StatsViewModel(c) } })
                    StatsScreen(vm)
                }
                composable<WishlistRoute> { e ->
                    val vm = viewModel<WishlistViewModel>(factory = viewModelFactory { initializer { WishlistViewModel(c) } })
                    // The camera hands the ISBN back through this entry's SavedStateHandle.
                    val scanned by e.savedStateHandle.getStateFlow<String?>("isbn", null).collectAsStateWithLifecycle()
                    val photo by e.savedStateHandle.getStateFlow<String?>("photo", null).collectAsStateWithLifecycle()
                    LaunchedEffect(scanned) {
                        scanned?.let {
                            vm.scanned(it)
                            e.savedStateHandle["isbn"] = null
                        }
                    }
                    LaunchedEffect(photo) {
                        photo?.let {
                            vm.photo(it)
                            e.savedStateHandle["photo"] = null
                        }
                    }
                    WishlistScreen(
                        vm,
                        onScan = { nav.navigate(CaptureRoute("isbn", tabs = false)) },
                        onPhoto = { nav.navigate(CaptureRoute("cover", tabs = false)) },
                    ) { wishId -> nav.navigate(AddBookRoute(wishId)) }
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
                    // The identify tab needs the server search; routes from the wishlist (tabs=false) do not show it.
                    val identify: IdentifySearch? = remember(route.tabs) {
                        if (!route.tabs) null
                        else { title: String, author: String? ->
                            val s = c.sessions.session.first() ?: throw IOException("Not connected")
                            c.api(s.serverUrl, s.token).search(title, author)
                        }
                    }
                    val start = when (route.mode) {
                        "cover" -> CaptureMode.Cover
                        "identify" -> CaptureMode.Identify
                        else -> CaptureMode.Isbn
                    }
                    CaptureScreen(c.covers, start, route.tabs, identify = identify) { result ->
                        nav.previousBackStackEntry?.savedStateHandle?.let { h ->
                            result.isbn?.let { h["isbn"] = it }
                            result.photoId?.let { h["photo"] = it }
                            result.candidate?.let { h["candidate"] = ApiJson.encodeToString(MetadataCandidate.serializer(), it) }
                        }
                        nav.popBackStack()
                    }
                }
                composable<CoverRoute> { e ->
                    val route = e.toRoute<CoverRoute>()
                    val vm = viewModel<CoverViewModel>(factory = viewModelFactory { initializer { CoverViewModel(c, route.assetId) } })
                    CoverViewerScreen(vm, route.title) { nav.popBackStack() }
                }
                composable<BulkScanRoute> {
                    val vm = viewModel<BulkScanViewModel>(factory = viewModelFactory { initializer { BulkScanViewModel(c) } })
                    BulkScanScreen(vm, onOpen = { nav.navigate(DetailRoute(it)) }, onClose = { nav.popBackStack() })
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
}

// Material shared axis X: the incoming screen comes from the right, the outgoing one drifts a
// quarter of the way left (and the other way round on pop), both with a short cross-fade.
private fun AnimatedContentTransitionScope<NavBackStackEntry>.sharedAxisEnter(): EnterTransition =
    slideInHorizontally(tween(300, easing = FastOutSlowInEasing)) { it } + fadeIn(tween(120, delayMillis = 90))

private fun AnimatedContentTransitionScope<NavBackStackEntry>.sharedAxisExit(): ExitTransition =
    slideOutHorizontally(tween(300, easing = FastOutSlowInEasing)) { -it / 4 } + fadeOut(tween(90))

private fun AnimatedContentTransitionScope<NavBackStackEntry>.sharedAxisPopEnter(): EnterTransition =
    slideInHorizontally(tween(300, easing = FastOutSlowInEasing)) { -it / 4 } + fadeIn(tween(120, delayMillis = 90))

private fun AnimatedContentTransitionScope<NavBackStackEntry>.sharedAxisPopExit(): ExitTransition =
    slideOutHorizontally(tween(300, easing = FastOutSlowInEasing)) { it } + fadeOut(tween(90))

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
    val candidateJson by state.getStateFlow<String?>("candidate", null).collectAsStateWithLifecycle()
    val identified = remember(candidateJson) {
        candidateJson?.let { runCatching { ApiJson.decodeFromString<MetadataCandidate>(it) }.getOrNull() }
    }
    // Consume each camera result once: otherwise a rotation or a trip to another screen would apply
    // the same ISBN/photo/candidate again, overwriting what the user typed or fetching twice.
    LaunchedEffect(isbn) {
        isbn?.let {
            vm.scanned(it)
            state["isbn"] = null
        }
    }
    LaunchedEffect(photo) {
        photo?.let {
            vm.photoId = it
            state["photo"] = null
        }
    }
    LaunchedEffect(identified) {
        identified?.let {
            vm.applyCandidate(it)
            state["candidate"] = null
        }
    }
    BookFormScreen(
        vm,
        // Adding a book: ISBN then cover in one camera session. Editing: just the camera for each.
        onScan = { nav.navigate(CaptureRoute("isbn", tabs = !vm.editing)) },
        onPhoto = { nav.navigate(CaptureRoute("cover", tabs = false)) },
        onOpenWork = { workId -> nav.navigate(DetailRoute(workId)) },
        onSaved = onSaved,
        onWishAdded = onWishAdded,
        onIdentify = { nav.navigate(CaptureRoute("identify", tabs = !vm.editing)) },
    )
}

@Composable
private fun Tabs(nav: NavHostController) {
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route.orEmpty()
    NavigationBar(containerColor = MaterialTheme.colorScheme.background, tonalElevation = 0.dp) {
        listOf(
            Triple(LibraryRoute(), R.string.nav_library, Icons.AutoMirrored.Filled.LibraryBooks) to "LibraryRoute",
            Triple(LocationsRoute, R.string.nav_locations, Icons.Default.Place) to "LocationsRoute",
            Triple(WishlistRoute, R.string.nav_wishlist, Icons.Default.Favorite) to "WishlistRoute",
            Triple(StatsRoute, R.string.nav_stats, Icons.Default.BarChart) to "StatsRoute",
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
                // The web's selected menu item: accent text on the accent's soft tint.
                colors = NavigationBarItemDefaults.colors(
                    selectedIconColor = MaterialTheme.colorScheme.primary,
                    selectedTextColor = MaterialTheme.colorScheme.primary,
                    indicatorColor = MaterialTheme.colorScheme.primaryContainer,
                ),
            )
        }
    }
}
