package io.github.rldona.openlibrary

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.layout.asPaddingValues
import android.os.Bundle
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.union
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.NavigationRailItemDefaults
import androidx.compose.material3.VerticalDivider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import io.github.rldona.openlibrary.ui.components.NavLayout
import io.github.rldona.openlibrary.ui.components.navLayoutFor
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContentScope
import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.LibraryBooks
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.BookmarkBorder
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.HorizontalDivider
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.fragment.app.FragmentActivity
import io.github.rldona.openlibrary.ui.lock.LockScreen
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraphBuilder
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
import io.github.rldona.openlibrary.ui.components.AppSnackbar
import io.github.rldona.openlibrary.ui.components.LocalSnackbar
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
/** [closeForm]: opened straight from the library, so leaving with nothing also drops the empty add-book form below. */
/** `gallery` opens the picture picker at once; the camera stays behind it as the fallback. */
@Serializable data class CaptureRoute(val mode: String, val tabs: Boolean, val closeForm: Boolean = false, val gallery: Boolean = false)
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

    // One snackbar host for the whole app: it sits above the navigation bar on the tabs and above the
    // system bars on full-screen pages, and its messages survive the screen that showed them.
    val snackbarHost = remember { SnackbarHostState() }
    val rootScope = rememberCoroutineScope()
    val undoLabel = stringResource(R.string.common_undo)
    val snackbar = remember(undoLabel) { AppSnackbar(snackbarHost, rootScope, undoLabel) }

    // Bottom bar when the window is narrow, a rail at the side when it is wide (landscape, tablet).
    val density = LocalDensity.current
    val windowWidth = with(density) { LocalWindowInfo.current.containerSize.width.toDp() }
    val layout = navLayoutFor(windowWidth.value)
    val motion = MaterialTheme.motionScheme
    val showRail = inTabs && layout == NavLayout.Rail
    // The rail pads itself for the side system bar and cutout: the content next to it must not do it again.
    val railInsets = WindowInsets.systemBars.union(WindowInsets.displayCutout).only(WindowInsetsSides.Start)
    val railInset = railInsets.asPaddingValues().calculateStartPadding(LocalLayoutDirection.current)
    // Handed over gradually while the rail grows or shrinks, so the page next to it does not jump by the inset.
    val consumedStart by animateDpAsState(if (showRail) railInset else 0.dp, motion.defaultSpatialSpec(), label = "railInset")

    Row(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        // Like the bottom bar, it belongs to the tab screens. It shrinks away (rather than just sliding) so the
        // page next to it widens smoothly while the detail slides in.
        AnimatedVisibility(
            visible = showRail,
            enter = fadeIn(motion.defaultEffectsSpec()) + expandHorizontally(motion.defaultSpatialSpec()),
            exit = fadeOut(motion.fastEffectsSpec()) + shrinkHorizontally(motion.defaultSpatialSpec()),
        ) {
            Row {
                Tabs(nav, rail = true)
                VerticalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
        Scaffold(
            Modifier.weight(1f).consumeWindowInsets(PaddingValues(start = consumedStart)),
            // The side cutout too: in landscape it sits where the rail or the content starts.
            contentWindowInsets = WindowInsets.systemBars.union(WindowInsets.displayCutout),
            snackbarHost = { snackbar.RootHost() },
            bottomBar = {
                // It belongs to the tab screens: slide it down as the detail comes in, and back up on return.
                AnimatedVisibility(
                    visible = inTabs && layout == NavLayout.Bar,
                    enter = fadeIn(motion.defaultEffectsSpec()) + slideInVertically(motion.defaultSpatialSpec()) { it },
                    exit = fadeOut(motion.fastEffectsSpec()) + slideOutVertically(motion.defaultSpatialSpec()) { it },
                ) {
                    Column {
                        // Like the web's sidebar: on the page background, separated by a `line` rule.
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        Tabs(nav, rail = false)
                    }
                }
            },
        ) { padding ->
            // One shared-transition layout around the NavHost, so the cover can travel between the
            // library item and the detail header while each destination keeps its own AnimatedVisibilityScope.
            // Each destination applies the app bars' padding itself (see [screen]): switching it for the
            // whole layout would make the screen that is leaving jump while it animates out.
            CompositionLocalProvider(LocalBarsPadding provides padding, LocalSnackbar provides snackbar) {
                SharedTransitionLayout {
                    val sharedTransitionScope = this
                    NavHost(
                        nav,
                        startDestination = if (connected) LibraryRoute() else SetupRoute,
                        modifier = Modifier.fillMaxSize(),
                        // Material shared axis X: spatial motion forwards and backwards, with a short fade.
                        enterTransition = { sharedAxisEnter(PageMotion) },
                        exitTransition = { sharedAxisExit(PageMotion) },
                        popEnterTransition = { sharedAxisPopEnter(PageMotion) },
                        popExitTransition = { sharedAxisPopExit(PageMotion) },
                        // The back gesture plays the same motion, driven by the finger. Navigation's default
                        // (scale the leaving screen down) leaves the shared cover floating in the overlay.
                        predictivePopEnterTransition = { sharedAxisPopEnter(PageMotion) },
                        predictivePopExitTransition = { sharedAxisPopExit(PageMotion) },
                    ) {
                        screen<SetupRoute> {
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
                        screen<LibraryRoute>(topBar = true) { e ->
                            val route = e.toRoute<LibraryRoute>()
                            val vm = viewModel<LibraryViewModel>(factory = viewModelFactory { initializer { LibraryViewModel(c, route.locationId) } })
                            // A search handed over by another screen (a subject tapped in the detail), applied once.
                            val search by e.savedStateHandle.getStateFlow<String?>(SEARCH_KEY, null).collectAsStateWithLifecycle()
                            LaunchedEffect(search) {
                                search?.let {
                                    vm.requestSearch(it)
                                    e.savedStateHandle[SEARCH_KEY] = null
                                }
                            }
                            LibraryScreen(
                                vm,
                                now,
                                sharedTransitionScope = sharedTransitionScope,
                                animatedVisibilityScope = this,
                                onOpen = { workId, editionId -> nav.navigate(DetailRoute(workId, editionId)) },
                                onAdd = { nav.navigate(AddBookRoute()) },
                                onBulk = { nav.navigate(BulkScanRoute) },
                                // Straight to the identify camera, with the add-book form below it to receive
                                // the candidate. Both in one go: the empty form is never shown on the way in.
                                onIdentify = {
                                    nav.navigate(AddBookRoute())
                                    nav.navigate(CaptureRoute("identify", tabs = true, closeForm = true))
                                },
                                onReview = { nav.navigate(ReviewRoute) },
                            )
                        }
                        // The shared cover carries the transition while the detail itself slides in.
                        screen<DetailRoute>(topBar = true) { e ->
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
                                onSubject = { subject -> nav.libraryRoot(search = subject) },
                            )
                        }
                        screen<AddBookRoute>(topBar = true) { e ->
                            val route = e.toRoute<AddBookRoute>()
                            val vm = viewModel<BookFormViewModel>(
                                factory = viewModelFactory { initializer { BookFormViewModel(c, null, null, route.wishId) } },
                            )
                            BookForm(vm, e.savedStateHandle, nav, onWishAdded = { nav.popBackStack() }) { workId ->
                                nav.navigate(DetailRoute(workId)) { popUpTo<AddBookRoute> { inclusive = true } }
                            }
                        }
                        screen<StatsRoute>(topBar = true) {
                            val vm = viewModel<StatsViewModel>(factory = viewModelFactory { initializer { StatsViewModel(c) } })
                            StatsScreen(vm)
                        }
                        screen<WishlistRoute>(topBar = true) { e ->
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
                        screen<EditBookRoute>(topBar = true) { e ->
                            val route = e.toRoute<EditBookRoute>()
                            val vm = viewModel<BookFormViewModel>(
                                factory = viewModelFactory { initializer { BookFormViewModel(c, route.workId, route.editionId) } },
                            )
                            BookForm(vm, e.savedStateHandle, nav) { nav.popBackStack() }
                        }
                        screen<CaptureRoute>(fullScreen = true) { e ->
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
                            val cancel = { nav.popBackStack<AddBookRoute>(inclusive = true) }
                            // The editor inside the camera registers its own back handler later, so it still wins.
                            BackHandler(enabled = route.closeForm) { cancel() }
                            CaptureScreen(c.covers, start, route.tabs, identify = identify, startWithGallery = route.gallery) { result ->
                                if (route.closeForm && result.isbn == null && result.photoId == null && result.candidate == null) {
                                    cancel()
                                    return@CaptureScreen
                                }
                                nav.previousBackStackEntry?.savedStateHandle?.let { h ->
                                    result.isbn?.let { h["isbn"] = it }
                                    result.photoId?.let { h["photo"] = it }
                                    result.candidate?.let { h["candidate"] = ApiJson.encodeToString(MetadataCandidate.serializer(), it) }
                                }
                                nav.popBackStack()
                            }
                        }
                        screen<CoverRoute>(fullScreen = true) { e ->
                            val route = e.toRoute<CoverRoute>()
                            val vm = viewModel<CoverViewModel>(factory = viewModelFactory { initializer { CoverViewModel(c, route.assetId) } })
                            CoverViewerScreen(vm, route.title) { nav.popBackStack() }
                        }
                        screen<BulkScanRoute>(fullScreen = true) {
                            val vm = viewModel<BulkScanViewModel>(factory = viewModelFactory { initializer { BulkScanViewModel(c) } })
                            BulkScanScreen(vm, onOpen = { nav.navigate(DetailRoute(it)) }, onClose = { nav.popBackStack() })
                        }
                        screen<ReviewRoute>(topBar = true) {
                            val vm = viewModel<ReviewViewModel>(factory = viewModelFactory { initializer { ReviewViewModel(c) } })
                            ReviewScreen(vm, onBack = { nav.popBackStack() })
                        }
                        screen<LocationsRoute>(topBar = true) {
                            val vm = viewModel<LocationsViewModel>(factory = viewModelFactory { initializer { LocationsViewModel(c) } })
                            LocationsScreen(vm) { id -> nav.navigate(LibraryRoute(id)) }
                        }
                        screen<SettingsRoute>(topBar = true) {
                            val vm = viewModel<SettingsViewModel>(
                                factory = viewModelFactory { initializer { SettingsViewModel(c) { nav.navigate(SetupRoute) { popUpTo(0) } } } },
                            )
                            SettingsScreen(vm, now, context) { nav.navigate(ReviewRoute) }
                        }
                    }
                }
            }
        }
    }
}

/** The root library's SavedStateHandle key for a search to apply when it shows. */
private const val SEARCH_KEY = "search"

/**
 * Back to the root library (the unfiltered one at the bottom of the stack: a location's library has another
 * route), optionally searching for [search]. Whatever was open above it is closed.
 */
private fun NavHostController.libraryRoot(search: String? = null) {
    val root = runCatching { getBackStackEntry(LibraryRoute()) }.getOrNull()
    root?.savedStateHandle?.set(SEARCH_KEY, search)
    navigate(LibraryRoute()) {
        // After the first connection the graph's start (setup) is gone: then the library is the whole stack.
        if (root != null) popUpTo(LibraryRoute()) { saveState = false } else popUpTo(0)
        launchSingleTop = true
    }
    if (root == null && search != null) currentBackStackEntry?.savedStateHandle?.set(SEARCH_KEY, search)
}

/** The app bars' padding, applied per destination by [screen]. */
private val LocalBarsPadding = compositionLocalOf { PaddingValues() }

/**
 * A destination on an opaque page background: during a transition (or the back gesture) both
 * screens are composed at once, and most of them have no background of their own.
 */
private inline fun <reified T : Any> NavGraphBuilder.screen(
    /** Camera and cover viewer use the whole screen, without app bars. */
    fullScreen: Boolean = false,
    /** It has its own top app bar, which sits behind the status bar and pads itself (ui/components/AppBars.kt). */
    topBar: Boolean = false,
    noinline content: @Composable AnimatedContentScope.(NavBackStackEntry) -> Unit,
) {
    composable<T> { entry ->
        val padding = LocalBarsPadding.current
        val direction = LocalLayoutDirection.current
        val applied = when {
            fullScreen -> PaddingValues()
            topBar -> PaddingValues(
                start = padding.calculateStartPadding(direction),
                end = padding.calculateEndPadding(direction),
                bottom = padding.calculateBottomPadding(),
            )
            else -> padding
        }
        // Consumed as well as applied: a screen's own imePadding() then adds only what the bars do not cover.
        val bars = Modifier.padding(applied).consumeWindowInsets(applied)
        Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).then(bars)) {
            content(this@composable, entry)
        }
    }
}

/*
 * Material shared axis X: the incoming screen comes from the right, the outgoing one drifts a quarter of the
 * way left (and the other way round on pop), both with a cross-fade. Pages move with the *standard* motion
 * scheme: the expressive one (the app's theme, for components) overshoots, which on a whole page would show a
 * sliver of the screen behind at the edge. Springs from the scheme also follow the back gesture.
 */
private val PageMotion = MotionScheme.standard()

private fun AnimatedContentTransitionScope<NavBackStackEntry>.sharedAxisEnter(m: MotionScheme): EnterTransition =
    slideInHorizontally(m.defaultSpatialSpec()) { it } + fadeIn(m.defaultEffectsSpec())

private fun AnimatedContentTransitionScope<NavBackStackEntry>.sharedAxisExit(m: MotionScheme): ExitTransition =
    slideOutHorizontally(m.defaultSpatialSpec()) { -it / 4 } + fadeOut(m.fastEffectsSpec())

private fun AnimatedContentTransitionScope<NavBackStackEntry>.sharedAxisPopEnter(m: MotionScheme): EnterTransition =
    slideInHorizontally(m.defaultSpatialSpec()) { -it / 4 } + fadeIn(m.defaultEffectsSpec())

private fun AnimatedContentTransitionScope<NavBackStackEntry>.sharedAxisPopExit(m: MotionScheme): ExitTransition =
    slideOutHorizontally(m.defaultSpatialSpec()) { it } + fadeOut(m.fastEffectsSpec())

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
        onGallery = { nav.navigate(CaptureRoute("cover", tabs = false, gallery = true)) },
        onOpenWork = { workId -> nav.navigate(DetailRoute(workId)) },
        onSaved = onSaved,
        onWishAdded = onWishAdded,
        onIdentify = { nav.navigate(CaptureRoute("identify", tabs = !vm.editing)) },
        onClose = { nav.popBackStack() },
    )
}

/** The five tabs, as a bottom bar or (wide windows) a rail; favorites are a filter of the library. */
@Composable
private fun Tabs(nav: NavHostController, rail: Boolean) {
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route.orEmpty()
    val tabs = listOf(
        Triple(LibraryRoute(), R.string.nav_library, Icons.AutoMirrored.Filled.LibraryBooks) to "LibraryRoute",
        Triple(LocationsRoute, R.string.nav_locations, Icons.Default.Place) to "LocationsRoute",
        Triple(WishlistRoute, R.string.nav_wishlistShort, Icons.Default.BookmarkBorder) to "WishlistRoute",
        Triple(StatsRoute, R.string.nav_stats, Icons.Default.BarChart) to "StatsRoute",
        Triple(SettingsRoute, R.string.nav_settings, Icons.Default.Settings) to "SettingsRoute",
    )
    val go = { target: Any ->
        if (target is LibraryRoute) {
            // The library tab always lands on the library itself, not on what was open above it.
            nav.libraryRoot()
        } else {
            nav.navigate(target) {
                // Up to the root library (the bottom of the stack), keeping the tab being left to come back to.
                popUpTo(LibraryRoute()) { saveState = true }
                launchSingleTop = true
                restoreState = true
            }
        }
    }
    // The web's selected menu item: accent text on the accent's soft tint.
    val primary = MaterialTheme.colorScheme.primary
    val indicator = MaterialTheme.colorScheme.primaryContainer
    if (rail) {
        NavigationRail(
            containerColor = MaterialTheme.colorScheme.background,
            // It sits at the window's edge: clear of the side system bar and of a camera cutout.
            windowInsets = WindowInsets.systemBars.union(WindowInsets.displayCutout).only(WindowInsetsSides.Vertical + WindowInsetsSides.Start),
        ) {
            Spacer(Modifier.weight(1f))
            tabs.forEach { (item, name) ->
                val (target, label, icon) = item
                NavigationRailItem(
                    selected = route.contains(name),
                    onClick = { go(target) },
                    icon = { Icon(icon, contentDescription = null) },
                    label = { Text(stringResource(label)) },
                    colors = NavigationRailItemDefaults.colors(selectedIconColor = primary, selectedTextColor = primary, indicatorColor = indicator),
                )
            }
            Spacer(Modifier.weight(1f))
        }
        return
    }
    NavigationBar(containerColor = MaterialTheme.colorScheme.background, tonalElevation = 0.dp) {
        tabs.forEach { (item, name) ->
            val (target, label, icon) = item
            NavigationBarItem(
                selected = route.contains(name),
                onClick = { go(target) },
                icon = { Icon(icon, contentDescription = null) },
                // Never broken in the middle of a word: five labels fit a phone, a longer one is cut.
                label = { Text(stringResource(label), maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis) },
                colors = NavigationBarItemDefaults.colors(selectedIconColor = primary, selectedTextColor = primary, indicatorColor = indicator),
            )
        }
    }
}
