package io.github.rldona.openlibrary.ui.library

import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.input.clearText
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.LibraryBooks
import androidx.compose.material.icons.automirrored.filled.ViewList
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SearchOff
import androidx.compose.material3.AppBarWithSearch
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExpandedFullScreenSearchBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SearchBarDefaults
import androidx.compose.material3.SearchBarValue
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberSearchBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import io.github.rldona.openlibrary.AppContainer
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.core.fold
import io.github.rldona.openlibrary.core.ftsQuery
import io.github.rldona.openlibrary.core.plural
import io.github.rldona.openlibrary.core.str
import io.github.rldona.openlibrary.data.LibraryRow
import io.github.rldona.openlibrary.data.LibrarySort
import io.github.rldona.openlibrary.data.LocationEntity
import io.github.rldona.openlibrary.sync.CoverStore
import io.github.rldona.openlibrary.sync.SyncStatus
import io.github.rldona.openlibrary.sync.pathOf
import io.github.rldona.openlibrary.ui.components.AddFab
import io.github.rldona.openlibrary.ui.book.AddBookSheet
import io.github.rldona.openlibrary.ui.book.AddWay
import io.github.rldona.openlibrary.ui.components.BookTitle
import io.github.rldona.openlibrary.ui.components.Cover
import io.github.rldona.openlibrary.ui.components.Spacing
import io.github.rldona.openlibrary.ui.components.animateGridItem
import io.github.rldona.openlibrary.ui.components.animateListItem
import io.github.rldona.openlibrary.ui.components.pageListItemColors
import io.github.rldona.openlibrary.ui.components.EmptyState
import io.github.rldona.openlibrary.ui.components.FillCover
import io.github.rldona.openlibrary.ui.components.LoadingState
import io.github.rldona.openlibrary.ui.components.LocalSnackbar
import io.github.rldona.openlibrary.ui.components.SyncBar
import io.github.rldona.openlibrary.ui.components.TopBarInsets
import io.github.rldona.openlibrary.ui.components.rememberFabVisibility
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import io.github.rldona.openlibrary.ui.detail.readingStatusLabel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.material3.Button
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.InputChip
import io.github.rldona.openlibrary.core.subjectLabel

data class LibraryItem(val row: LibraryRow, val place: List<String>)

/** The reading statuses the library can be filtered by, as [workReadingStatus][io.github.rldona.openlibrary.data.workReadingStatus] derives them. */
val READING_FILTERS = listOf("pending", "reading", "read")

data class LibraryState(
    val items: List<LibraryItem> = emptyList(),
    val loaded: Boolean = false,
    val location: LocationEntity? = null,
    /** Every location, for the location filter. */
    val locations: List<LocationEntity> = emptyList(),
    /** Books saved without data (scanned offline or unknown to the providers). */
    val provisional: Int = 0,
    val onlyProvisional: Boolean = false,
    /** "pending", "reading" or "read"; null shows every book. */
    val reading: String? = null,
    val sort: LibrarySort = LibrarySort.Title,
    val favoritesOnly: Boolean = false,
    /** Books not read yet among those searched/filtered (the reading filter aside). */
    val unread: Int = 0,
    /** How many books each reading status has (the reading filter aside), for its menu. */
    val readingCounts: Map<String, Int> = emptyMap(),
    /** Books with a copy not placed anywhere, in the whole library. */
    val unplaced: Int = 0,
    /** "author" or "language": only the books without one. */
    val missing: String? = null,
    /** The genre shown (in the phone's language), or null for every genre. */
    val genre: String? = null,
    /** The genres of the books searched/filtered (the genre filter aside), shown names with their counts. */
    val genres: List<Pair<String, Int>> = emptyList(),
) {
    val filtered get() = location != null || onlyProvisional || reading != null || favoritesOnly || missing != null || genre != null
    /** Only the favorites chip is on: an empty list then means there are no favorites, not a search without matches. */
    val onlyFavorites get() = favoritesOnly && location == null && !onlyProvisional && reading == null
}

/** Library list over the local copy: works with the server off. */
@OptIn(FlowPreview::class, ExperimentalCoroutinesApi::class)
class LibraryViewModel(
    private val c: AppContainer,
    locationId: String?,
    missingFilter: String? = null,
) : ViewModel() {
    /** The statistics' "To fix" lists: books without an author or a language. */
    val missing = MutableStateFlow(missingFilter)
    /** A genre as shown ("Filosofía"): books stored as "Philosophy" or "Filosofía" both match. */
    val genre = MutableStateFlow<String?>(null)
    val query = MutableStateFlow("")
    /** A search to put in the search field (handed over by another screen); the screen clears it once applied. */
    val searchRequest = MutableStateFlow<String?>(null)

    fun requestSearch(q: String) {
        searchRequest.value = q
    }
    private val locationFilter = MutableStateFlow(locationId)
    val onlyProvisional = MutableStateFlow(false)
    val favoritesOnly = MutableStateFlow(false)
    private val readingFilter = MutableStateFlow<String?>(null)
    private val locations = c.db.catalog().locations()
    private val prefs = c.libraryPrefs
    /** Every location, for "where it goes" in the add sheet. */
    val places = locations
    val lastLocation = prefs.lastLocation

    fun setLastLocation(id: String?) = viewModelScope.launch { prefs.setLastLocation(id) }
    val recentSearches = prefs.recentSearches

    val state: StateFlow<LibraryState> =
        combine(query.debounce(150), locationFilter, locations, onlyProvisional, readingFilter) { q, loc, all, prov, reading ->
            Filter(q, loc, all, prov, reading)
        }
            .flatMapLatest { f ->
                val byId = f.all.associateBy { it.id }
                val ids = f.loc?.let { subtree(f.all, it) } ?: emptyList()
                combine(
                    c.db.catalog().library(ftsQuery(f.q), f.loc == null, ids),
                    c.db.catalog().placements(),
                    // Reading statuses: for the reading filter and the "Unread" chip's count.
                    c.db.catalog().readingStatuses(),
                    prefs.sort,
                    combine(favoritesOnly, missing, genre) { fav, miss, gen -> Triple(fav, miss, gen) },
                ) { allRows, places, statuses, sort, (favorites, miss, gen) ->
                    val notMissing = allRows.filter { r ->
                        when (miss) {
                            "author" -> r.authors.isEmpty()
                            "language" -> r.language.isNullOrBlank()
                            else -> true
                        }
                    }
                    val rows = filterByGenre(notMissing, gen)
                    val firstPlace = places.groupBy({ it.editionId }, { it.locationId })
                    val byWork = statuses.associate { it.workId to it.status }
                    val shown = shapeLibrary(rows, byWork, f.reading, f.prov, sort, favorites)
                    LibraryState(
                        unread = shapeLibrary(rows, byWork, "pending", f.prov, sort, favorites).size,
                        readingCounts = READING_FILTERS.associateWith { shapeLibrary(rows, byWork, it, f.prov, sort, favorites).size },
                        provisional = rows.count { it.metadataStatus == "provisional" },
                        onlyProvisional = f.prov,
                        reading = f.reading,
                        sort = sort,
                        favoritesOnly = favorites,
                        missing = miss,
                        genre = gen,
                        genres = genreCounts(notMissing),
                        items = shown.map { r ->
                            val inFilter = firstPlace[r.editionId].orEmpty().firstOrNull { f.loc == null || it in ids }
                            LibraryItem(r, pathOf(byId, inFilter))
                        },
                        loaded = true,
                        location = f.loc?.let(byId::get),
                        locations = f.all,
                    )
                }
            }
            .combine(c.db.catalog().unplacedCopies()) { st, copies -> st.copy(unplaced = copies.distinctBy { it.editionId }.size) }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), LibraryState())

    val status = c.sync.status
    val covers = c.covers
    val pending = c.db.outbox().pendingCount()
    val problems = c.db.outbox().problemCount()
    val syncState = c.db.sync().stateFlow()

    fun setLocation(id: String?) {
        locationFilter.value = id
    }

    fun setReading(status: String?) {
        readingFilter.value = status
    }

    fun setSort(sort: LibrarySort) = viewModelScope.launch { prefs.setSort(sort) }

    /** The heart on a card or row: a normal work update, so it syncs with the web. */
    fun toggleFavorite(row: LibraryRow) = viewModelScope.launch {
        val work = c.db.catalog().workById(row.workId) ?: return@launch
        c.writes.editWork(work, JsonObject(mapOf("favorite" to JsonPrimitive(!work.favorite))))
    }

    fun rememberSearch(q: String) = viewModelScope.launch { prefs.addRecentSearch(q) }

    fun forgetSearch(q: String) = viewModelScope.launch { prefs.removeRecentSearch(q) }

    fun clearSearches() = viewModelScope.launch { prefs.clearRecentSearches() }

    fun refresh() {
        viewModelScope.launch { c.sync.sync() }
    }
}

private data class Filter(val q: String, val loc: String?, val all: List<LocationEntity>, val prov: Boolean, val reading: String?)

/**
 * The rows the library shows: only provisional ones and/or one reading status ([statuses] by work; works
 * without readings are "pending"), in the chosen order. [rows] come ordered by title.
 */
fun shapeLibrary(
    rows: List<LibraryRow>,
    statuses: Map<String, String>,
    reading: String?,
    onlyProvisional: Boolean,
    sort: LibrarySort,
    favoritesOnly: Boolean = false,
): List<LibraryRow> {
    val kept = rows.filter { r ->
        (!favoritesOnly || r.favorite) &&
            (!onlyProvisional || r.metadataStatus == "provisional") &&
            (reading == null || (statuses[r.workId] ?: "pending") == reading)
    }
    return when (sort) {
        LibrarySort.Title -> kept
        // Books without an author go last; the title order stays within each author.
        LibrarySort.Author -> kept.sortedWith(compareBy({ it.authors.isEmpty() }, { fold(it.authors.firstOrNull().orEmpty()) }))
        LibrarySort.Added -> kept.sortedByDescending { it.addedAt }
    }
}

/** The rows with a genre shown as [genre] (null: all), whatever language it is stored in. */
fun filterByGenre(rows: List<LibraryRow>, genre: String?): List<LibraryRow> =
    if (genre == null) rows else rows.filter { r -> r.subjects.any { subjectLabel(it) == genre } }

/** Genres as shown, each with how many of [rows] have it, alphabetically (accents and case aside). */
fun genreCounts(rows: List<LibraryRow>): List<Pair<String, Int>> =
    rows.flatMap { r -> r.subjects.map(::subjectLabel).distinct() }
        .groupingBy { it }.eachCount()
        .toList()
        .sortedBy { fold(it.first) }

/** A location and everything inside it. */
fun subtree(all: List<LocationEntity>, root: String): List<String> {
    val children = all.groupBy { it.parentId }
    val out = mutableListOf<String>()
    val stack = ArrayDeque(listOf(root))
    while (stack.isNotEmpty()) {
        val cur = stack.removeLast()
        out += cur
        children[cur]?.forEach { stack.addLast(it.id) }
    }
    return out
}

/**
 * The library: a search bar on top (it opens into recent searches and live results, back closes it),
 * filters below it, the books as covers or a list, and one "+" button that opens into the ways of adding.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalSharedTransitionApi::class)
@Composable
fun LibraryScreen(
    vm: LibraryViewModel,
    now: Long,
    sharedTransitionScope: SharedTransitionScope,
    animatedVisibilityScope: AnimatedVisibilityScope,
    onOpen: (workId: String, editionId: String) -> Unit,
    onAdd: (AddWay) -> Unit,
    onReview: () -> Unit,
    /** "Place" on the not-placed notice: the books without a place, to give them one. */
    onPlace: () -> Unit = {},
) {
    var adding by rememberSaveable { mutableStateOf(false) }
    if (adding) {
        val places by vm.places.collectAsStateWithLifecycle(emptyList())
        val lastPlace by vm.lastLocation.collectAsStateWithLifecycle(null)
        AddBookSheet(
            places,
            locationId = lastPlace?.takeIf { id -> places.any { it.id == id } },
            onLocation = vm::setLastLocation,
            onChoose = { adding = false; onAdd(it) },
            onDismiss = { adding = false },
        )
    }
    val state by vm.state.collectAsStateWithLifecycle()
    val status by vm.status.collectAsStateWithLifecycle()
    val sync by vm.syncState.collectAsStateWithLifecycle(null)
    val pending by vm.pending.collectAsStateWithLifecycle(0)
    val problems by vm.problems.collectAsStateWithLifecycle(0)
    val recents by vm.recentSearches.collectAsStateWithLifecycle(emptyList())
    val covers = vm.covers
    val snackbar = LocalSnackbar.current
    // Covers, like the web; the compact list is one tap away.
    var grid by rememberSaveable { mutableStateOf(true) }

    val searchState = rememberSearchBarState()
    val text = rememberTextFieldState(vm.query.value)
    LaunchedEffect(text) { snapshotFlow { text.text.toString() }.collect { vm.query.value = it } }
    val searchRequest by vm.searchRequest.collectAsStateWithLifecycle()
    LaunchedEffect(searchRequest) {
        searchRequest?.let {
            text.setTextAndPlaceCursorAtEnd(it)
            vm.searchRequest.value = null
        }
    }
    val scope = rememberCoroutineScope()
    val expanded = searchState.currentValue == SearchBarValue.Expanded
    val collapse: () -> Unit = { scope.launch { searchState.animateToCollapsed() } }
    val openBook = { workId: String, editionId: String ->
        // A search that led to a book is worth remembering.
        if (text.text.isNotBlank()) vm.rememberSearch(text.text.toString())
        onOpen(workId, editionId)
    }
    val searchScroll = SearchBarDefaults.enterAlwaysSearchBarScrollBehavior()
    val fab = rememberFabVisibility()

    val inputField = @Composable {
        SearchBarDefaults.InputField(
            textFieldState = text,
            searchBarState = searchState,
            onSearch = { q ->
                vm.rememberSearch(q)
                collapse()
            },
            placeholder = { Text(stringResource(R.string.library_searchShort), maxLines = 1, overflow = TextOverflow.Ellipsis) },
            leadingIcon = {
                if (expanded) {
                    IconButton(onClick = collapse) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.detail_back))
                    }
                } else {
                    Icon(Icons.Default.Search, contentDescription = null)
                }
            },
            trailingIcon = {
                if (text.text.isNotEmpty()) {
                    IconButton(onClick = { text.clearText() }) {
                        Icon(Icons.Default.Close, contentDescription = stringResource(R.string.common_close))
                    }
                }
            },
            modifier = Modifier.testTag("search"),
        )
    }

    Scaffold(
        Modifier.nestedScroll(searchScroll.nestedScrollConnection).nestedScroll(fab.connection),
        topBar = {
            Column(Modifier.background(MaterialTheme.colorScheme.background)) {
                AppBarWithSearch(
                    state = searchState,
                    inputField = inputField,
                    actions = { ViewSortMenu(grid, { grid = it }, state.sort, vm::setSort) },
                    colors = SearchBarDefaults.appBarWithSearchColors(
                        appBarContainerColor = MaterialTheme.colorScheme.background,
                        scrolledAppBarContainerColor = MaterialTheme.colorScheme.background,
                    ),
                    windowInsets = TopBarInsets,
                    scrollBehavior = searchScroll,
                )
                Filters(state, vm)
                SyncBar(status, sync?.lastSyncAt, now, pending = pending, problems = problems, onReview = onReview, onlyProblems = true)
            }
        },
        floatingActionButton = {
            AddFab(visible = fab.visible) { adding = true }
        },
        snackbarHost = { snackbar.ScreenHost() },
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets(0),
    ) { inner ->
        PullToRefreshBox(
            isRefreshing = status is SyncStatus.Running,
            onRefresh = vm::refresh,
            modifier = Modifier.fillMaxSize().padding(inner),
        ) {
            when {
                !state.loaded -> LoadingState()
                state.items.isEmpty() && state.onlyFavorites && text.text.isEmpty() ->
                    EmptyState(
                        Icons.Default.FavoriteBorder,
                        stringResource(R.string.favorites_emptyTitle),
                        text = stringResource(R.string.favorites_emptyText),
                    )
                state.items.isEmpty() && (text.text.isNotEmpty() || state.filtered) ->
                    EmptyState(
                        Icons.Default.SearchOff,
                        stringResource(R.string.library_noMatchesTitle),
                        text = stringResource(R.string.library_noMatchesText),
                    )
                state.items.isEmpty() ->
                    EmptyState(
                        Icons.AutoMirrored.Filled.LibraryBooks,
                        stringResource(R.string.library_emptyTitle),
                        text = stringResource(R.string.library_emptyText),
                        action = stringResource(R.string.book_add) to { adding = true },
                    )
                else -> Books(
                    state.items,
                    covers,
                    grid,
                    sharedTransitionScope,
                    animatedVisibilityScope,
                    onOpen = openBook,
                    onFavorite = vm::toggleFavorite,
                    sort = state.sort,
                    // The notice is for the whole library: not while searching or filtering.
                    unplaced = if (text.text.isEmpty() && !state.filtered) state.unplaced else 0,
                    onPlace = onPlace,
                )
            }
        }
    }

    ExpandedFullScreenSearchBar(state = searchState, inputField = inputField) {
        // The search keeps the library's filters: they are shown (and can be changed) here too, so the
        // results never look short for no visible reason.
        if (state.filtered) Filters(state, vm)
        if (text.text.isEmpty()) {
            RecentSearches(
                recents,
                onPick = { text.setTextAndPlaceCursorAtEnd(it) },
                onRemove = { vm.forgetSearch(it) },
                onClear = { vm.clearSearches() },
            )
        } else {
            SearchResults(state.items, covers) { workId, editionId ->
                // Closed at once: the detail slides in over the library, not over the search.
                scope.launch { searchState.snapTo(0f) }
                openBook(workId, editionId)
            }
        }
    }
}

/** The sort labels, shared with the web ("Title A→Z"…). */
private val SORT_LABELS = listOf(
    LibrarySort.Title to R.string.library_sort_title,
    LibrarySort.Author to R.string.library_sort_author,
    LibrarySort.Added to R.string.library_sort_added,
)

/** One button for how the books look (covers or list) and their order; the order is remembered on this phone. */
@Composable
private fun ViewSortMenu(grid: Boolean, onGrid: (Boolean) -> Unit, sort: LibrarySort, onSort: (LibrarySort) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }) {
            Icon(Icons.Default.Tune, contentDescription = stringResource(R.string.library_viewSort))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            MenuHeading(stringResource(R.string.library_view))
            listOf(true to R.string.library_viewCovers, false to R.string.library_viewList).forEach { (value, label) ->
                DropdownMenuItem(
                    text = { Text(stringResource(label)) },
                    onClick = { onGrid(value); open = false },
                    leadingIcon = { Icon(if (value) Icons.Default.GridView else Icons.AutoMirrored.Filled.ViewList, contentDescription = null) },
                    trailingIcon = { if (value == grid) Icon(Icons.Default.Check, contentDescription = null) },
                )
            }
            HorizontalDivider()
            MenuHeading(stringResource(R.string.library_order))
            SORT_LABELS.forEach { (value, label) ->
                DropdownMenuItem(
                    text = { Text(stringResource(label)) },
                    onClick = { onSort(value); open = false },
                    trailingIcon = { if (value == sort) Icon(Icons.Default.Check, contentDescription = null) },
                )
            }
        }
    }
}

@Composable
private fun MenuHeading(text: String) {
    Text(
        text,
        Modifier.padding(horizontal = 16.dp, vertical = 8.dp).semantics { heading() },
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/**
 * Favorites, genre, location and reading, as chips under the search bar; "to complete" and the statistics'
 * "without author/language" follow only when they apply.
 */
@Composable
private fun Filters(state: LibraryState, vm: LibraryViewModel) {
    // One row that always fits the screen (no sideways scrolling): see FitRow. The occasional chips go on
    // a line below.
    Column(Modifier.padding(horizontal = 12.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        FitRow(gap = 8.dp) {
            // Just the heart; TalkBack reads "Favorites".
            val favorites = stringResource(R.string.nav_favorites)
            FilterChip(
                selected = state.favoritesOnly,
                onClick = { vm.favoritesOnly.value = !state.favoritesOnly },
                label = {
                    Icon(
                        if (state.favoritesOnly) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                        contentDescription = favorites,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(20.dp),
                    )
                },
            )
            if (state.genres.isNotEmpty() || state.genre != null) GenreFilter(state) { vm.genre.value = it }
            ReadingFilter(state, onSelect = vm::setReading)
            LocationFilter(state, onSelect = vm::setLocation)
        }
        val toComplete = state.provisional > 0 || state.onlyProvisional
        if (toComplete || state.missing != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (toComplete) {
                    FilterChip(
                        selected = state.onlyProvisional,
                        onClick = { vm.onlyProvisional.value = !state.onlyProvisional },
                        label = { Text(plural(R.string.library_toComplete_one, R.string.library_toComplete_other, state.provisional)) },
                        leadingIcon = { Icon(Icons.Default.EditNote, contentDescription = null) },
                    )
                }
                state.missing?.let { m ->
                    InputChip(
                        selected = true,
                        onClick = { vm.missing.value = null },
                        label = { Text(stringResource(if (m == "author") R.string.library_noAuthor else R.string.library_noLanguage)) },
                        trailingIcon = { Icon(Icons.Default.Close, contentDescription = stringResource(R.string.common_remove)) },
                    )
                }
            }
        }
    }
}

/**
 * Lays its children out in one row as wide as the screen, never wider. Each child asks for its natural
 * width; when they all fit, the space left over is shared by every child but the first (the heart), and
 * when they do not, only the widest ones shrink, to the same width, so short labels stay whole.
 */
@Composable
private fun FitRow(gap: Dp, content: @Composable () -> Unit) {
    Layout(content, Modifier.fillMaxWidth()) { measurables, constraints ->
        val space = gap.roundToPx()
        val total = constraints.maxWidth
        val available = (total - space * (measurables.size - 1)).coerceAtLeast(0)
        val natural = measurables.map { it.maxIntrinsicWidth(constraints.maxHeight) }
        val widths = if (natural.sum() <= available) {
            val growing = (measurables.size - 1).coerceAtLeast(1)
            val extra = (available - natural.sum()) / growing
            natural.mapIndexed { i, w -> if (i == 0 && measurables.size > 1) w else w + extra }
        } else {
            // The largest cap c with sum(min(w, c)) <= available.
            val sorted = natural.sorted()
            var left = available
            var cap = 0
            for ((i, w) in sorted.withIndex()) {
                val share = left / (sorted.size - i)
                if (w <= share) left -= w else { cap = share; break }
                cap = w
            }
            natural.map { minOf(it, cap) }
        }
        val placeables = measurables.mapIndexed { i, m -> m.measure(Constraints.fixedWidth(widths[i])) }
        val height = placeables.maxOfOrNull { it.height } ?: 0
        layout(total, height) {
            var x = 0
            placeables.forEach { p ->
                p.placeRelative(x, (height - p.height) / 2)
                x += p.width + space
            }
        }
    }
}

/** A dropdown chip's label: the text, cut with "…" when the chip is narrow, and the arrow at the end. */
@Composable
private fun DropdownLabel(text: String) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(text, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        Icon(Icons.Default.ArrowDropDown, contentDescription = null, modifier = Modifier.size(20.dp))
    }
}

/** Unread, reading or read in one dropdown chip, each with how many books it has. */
@Composable
private fun ReadingFilter(state: LibraryState, modifier: Modifier = Modifier, onSelect: (String?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        FilterChip(
            modifier = Modifier.fillMaxWidth(),
            selected = state.reading != null,
            onClick = { open = true },
            label = { DropdownLabel(stringResource(state.reading?.let(::readingStatusLabel) ?: R.string.library_readingFilter)) },
        )
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.library_anyReading)) },
                onClick = { onSelect(null); open = false },
                leadingIcon = { if (state.reading == null) Icon(Icons.Default.Check, contentDescription = null) },
            )
            READING_FILTERS.forEach { status ->
                DropdownMenuItem(
                    text = { Text(stringResource(readingStatusLabel(status))) },
                    trailingIcon = { Text((state.readingCounts[status] ?: 0).toString(), color = MaterialTheme.colorScheme.onSurfaceVariant) },
                    onClick = { onSelect(status); open = false },
                    leadingIcon = { if (state.reading == status) Icon(Icons.Default.Check, contentDescription = null) },
                )
            }
        }
    }
}

@Composable
private fun LocationFilter(state: LibraryState, modifier: Modifier = Modifier, onSelect: (String?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val byId = remember(state.locations) { state.locations.associateBy { it.id } }
    Box(modifier) {
        FilterChip(
            modifier = Modifier.fillMaxWidth(),
            selected = state.location != null,
            onClick = { open = true },
            // Short when nothing is chosen, so the chip stays whole on a phone; the menu says "All locations".
            label = { DropdownLabel(state.location?.name ?: stringResource(R.string.library_locationFilter)) },
        )
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.library_allLocations)) },
                onClick = { onSelect(null); open = false },
                leadingIcon = { if (state.location == null) Icon(Icons.Default.Check, contentDescription = null) },
            )
            state.locations.map { it.id to pathOf(byId, it.id).joinToString(" › ") }.sortedBy { it.second }.forEach { (id, path) ->
                DropdownMenuItem(
                    text = { Text(path) },
                    onClick = { onSelect(id); open = false },
                    leadingIcon = { if (state.location?.id == id) Icon(Icons.Default.Check, contentDescription = null) },
                )
            }
        }
    }
}

/** A dropdown chip like the location's: every genre of the books on show, with its count. */
@Composable
private fun GenreFilter(state: LibraryState, modifier: Modifier = Modifier, onSelect: (String?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        FilterChip(
            modifier = Modifier.fillMaxWidth(),
            selected = state.genre != null,
            onClick = { open = true },
            label = { DropdownLabel(state.genre ?: stringResource(R.string.library_genreFilter)) },
        )
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.library_allGenres)) },
                onClick = { onSelect(null); open = false },
                leadingIcon = { if (state.genre == null) Icon(Icons.Default.Check, contentDescription = null) },
            )
            state.genres.forEach { (name, n) ->
                DropdownMenuItem(
                    text = { Text(name) },
                    trailingIcon = { Text(n.toString(), color = MaterialTheme.colorScheme.onSurfaceVariant) },
                    onClick = { onSelect(name); open = false },
                    leadingIcon = { if (state.genre == name) Icon(Icons.Default.Check, contentDescription = null) },
                )
            }
        }
    }
}

/** What the expanded search shows before anything is typed. */
@Composable
private fun RecentSearches(recents: List<String>, onPick: (String) -> Unit, onRemove: (String) -> Unit, onClear: () -> Unit) {
    if (recents.isEmpty()) return
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    stringResource(R.string.search_recent),
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.weight(1f).semantics { heading() },
                )
                TextButton(onClick = onClear) { Text(stringResource(R.string.search_clearRecent)) }
            }
        }
        items(recents, key = { it }) { q ->
            ListItem(
                onClick = { onPick(q) },
                leadingContent = { Icon(Icons.Default.History, contentDescription = null) },
                trailingContent = {
                    IconButton(onClick = { onRemove(q) }) {
                        Icon(Icons.Default.Close, contentDescription = str(R.string.search_removeRecent, "q" to q))
                    }
                },
                colors = pageListItemColors(),
            ) { Text(q, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
    }
}

/** Live results while typing in the expanded search: the same books the library is filtered to. */
@Composable
private fun SearchResults(items: List<LibraryItem>, covers: CoverStore, onOpen: (workId: String, editionId: String) -> Unit) {
    if (items.isEmpty()) {
        Text(stringResource(R.string.library_noMatchesText), Modifier.padding(16.dp), style = MaterialTheme.typography.bodyMedium)
        return
    }
    LazyColumn(Modifier.fillMaxSize().testTag("searchResults")) {
        items(items, key = { it.row.editionId }) { item ->
            ListItem(
                onClick = { onOpen(item.row.workId, item.row.editionId) },
                supportingContent = {
                    Text(
                        item.row.authors.joinToString(", ").ifEmpty { stringResource(R.string.book_unknownAuthor) },
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                },
                leadingContent = {
                    Cover(
                        covers,
                        item.row.coverAssetId,
                        item.row.title,
                        40.dp,
                        authors = item.row.authors,
                        provisional = item.row.metadataStatus == "provisional",
                    )
                },
                colors = pageListItemColors(),
            ) { Text(item.row.title, style = BookTitle.compact, maxLines = 2, overflow = TextOverflow.Ellipsis) }
        }
    }
}

@Composable
private fun RatingFlap(value: Double, modifier: Modifier = Modifier) {
    Surface(modifier = modifier, shape = RoundedCornerShape(99.dp), color = MaterialTheme.colorScheme.primary) {
        Text(
            "★ $value",
            Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onPrimary,
        )
    }
}

@Composable
private fun FavoriteBadge(modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
        tonalElevation = 2.dp,
    ) {
        Icon(
            Icons.Default.Favorite,
            contentDescription = stringResource(R.string.favorites_badge),
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.padding(7.dp).size(18.dp),
        )
    }
}

/** The heart of a list row: a toggle, quiet until it is on. */
@Composable
private fun FavoriteButton(favorite: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    IconButton(onClick = onClick, modifier = modifier.size(32.dp)) {
        Icon(
            if (favorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
            contentDescription = stringResource(if (favorite) R.string.favorites_remove else R.string.favorites_add),
            tint = if (favorite) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(20.dp),
        )
    }
}

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
private fun Books(
    items: List<LibraryItem>,
    covers: CoverStore,
    grid: Boolean,
    sharedTransitionScope: SharedTransitionScope,
    animatedVisibilityScope: AnimatedVisibilityScope,
    onOpen: (workId: String, editionId: String) -> Unit,
    onFavorite: (LibraryRow) -> Unit,
    sort: LibrarySort,
    unplaced: Int,
    onPlace: () -> Unit,
) {
    // The grid already pads its content by 16 dp; the list does not.
    val header: @Composable (inset: Dp) -> Unit = { inset ->
        Column(Modifier.padding(start = inset, end = inset, top = 4.dp, bottom = 4.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (unplaced > 0) UnplacedNotice(unplaced, onPlace)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    plural(R.string.library_books_one, R.string.library_books_other, items.size),
                    Modifier.weight(1f),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    stringResource(SORT_LABELS.first { it.first == sort }.second),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
    if (grid) {
        LazyVerticalGrid(
            GridCells.Adaptive(104.dp),
            Modifier.fillMaxSize().testTag("library"),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 96.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            item(span = { GridItemSpan(maxLineSpan) }) { header(0.dp) }
            items(items, key = { it.row.editionId }) { item ->
                val coverModifier = with(sharedTransitionScope) {
                    Modifier.sharedElement(
                        rememberSharedContentState(key = "cover-${item.row.editionId}"),
                        animatedVisibilityScope = animatedVisibilityScope,
                    )
                }
                Column(
                    animateGridItem().clip(MaterialTheme.shapes.small).clickable { onOpen(item.row.workId, item.row.editionId) }.padding(2.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Box(Modifier.fillMaxWidth()) {
                        FillCover(
                            covers,
                            item.row.coverAssetId,
                            item.row.title,
                            item.row.authors,
                            item.row.metadataStatus == "provisional",
                            modifier = coverModifier,
                        )
                        item.row.rating?.let {
                            RatingFlap(it, Modifier.align(Alignment.TopEnd).padding(6.dp))
                        }
                        // Only favorites wear the heart (the detail toggles it): an empty heart on every cover is noise.
                        if (item.row.favorite) FavoriteBadge(Modifier.align(Alignment.BottomEnd).padding(6.dp))
                    }
                    Text(item.row.title, style = BookTitle.grid, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(
                        item.row.authors.joinToString(", ").ifEmpty { stringResource(R.string.book_unknownAuthor) },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (item.row.activeCopies > 1) {
                        Text("×${item.row.activeCopies}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                    }
                }
            }
        }
    } else {
        LazyColumn(Modifier.fillMaxSize().testTag("library"), contentPadding = PaddingValues(bottom = 96.dp)) {
            item { header(16.dp) }
            items(items, key = { it.row.editionId }) { item ->
                val coverModifier = with(sharedTransitionScope) {
                    Modifier.sharedElement(
                        rememberSharedContentState(key = "cover-${item.row.editionId}"),
                        animatedVisibilityScope = animatedVisibilityScope,
                    )
                }
                // Filters and sort orders move the rows instead of swapping them at once.
                Column(animateListItem()) {
                    ListItem(
                        onClick = { onOpen(item.row.workId, item.row.editionId) },
                        verticalAlignment = Alignment.Top,
                        leadingContent = {
                            Cover(
                                covers,
                                item.row.coverAssetId,
                                item.row.title,
                                Spacing.rowCover,
                                modifier = coverModifier,
                                authors = item.row.authors,
                                provisional = item.row.metadataStatus == "provisional",
                            )
                        },
                        trailingContent = {
                            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                item.row.rating?.let { RatingFlap(it) }
                                FavoriteButton(item.row.favorite, onClick = { onFavorite(item.row) })
                            }
                        },
                        supportingContent = {
                            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text(
                                    item.row.authors.joinToString(", ").ifEmpty { stringResource(R.string.book_unknownAuthor) },
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurface,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                val imprint = listOfNotNull(item.row.publisher, item.row.publishedYear?.toString()).joinToString(" · ")
                                if (imprint.isNotEmpty()) Text(imprint, style = MaterialTheme.typography.bodySmall)
                                Text(
                                    item.place.joinToString(" › ").ifEmpty { stringResource(R.string.copy_noLocation) } +
                                        if (item.row.activeCopies > 1) " · " + plural(R.string.library_copies_one, R.string.library_copies_other, item.row.activeCopies) else "",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.primary,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        },
                        colors = pageListItemColors(),
                    ) { Text(item.row.title, style = BookTitle.list, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                    HorizontalDivider(Modifier.padding(start = 82.dp), color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
        }
    }
}

/** "11 books not placed · Give them a shelf in one go · Place". */
@Composable
private fun UnplacedNotice(count: Int, onPlace: () -> Unit) {
    Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.secondaryContainer, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(start = 20.dp, end = 12.dp, top = 12.dp, bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Place, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Column(Modifier.weight(1f).padding(horizontal = 16.dp)) {
                Text(
                    plural(R.string.library_unplaced_one, R.string.library_unplaced_other, count),
                    style = MaterialTheme.typography.titleSmall.copy(fontSize = MaterialTheme.typography.bodyLarge.fontSize),
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                )
                Text(stringResource(R.string.library_unplacedText), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSecondaryContainer)
            }
            Button(onClick = onPlace, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.library_place)) }
        }
    }
}
