package io.github.rldona.openlibrary.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import io.github.rldona.openlibrary.core.fold
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/** How the library list is ordered; [key] is what is stored. Same choices as the web's sort menu. */
enum class LibrarySort(val key: String) {
    Title("title"),
    Author("author"),
    Added("added"),
    ;

    companion object {
        fun of(key: String?): LibrarySort = entries.firstOrNull { it.key == key } ?: Title
    }
}

/** Library choices remembered on this phone: recent searches and the sort order. */
class LibraryPrefs(private val context: Context) {
    private val recentKey = stringPreferencesKey("library_recent_searches")
    private val sortKey = stringPreferencesKey("library_sort")

    val recentSearches: Flow<List<String>> =
        context.prefs.data.map { p -> p[recentKey]?.split('\n')?.filter { it.isNotBlank() }.orEmpty() }

    val sort: Flow<LibrarySort> = context.prefs.data.map { LibrarySort.of(it[sortKey]) }

    suspend fun addRecentSearch(query: String) {
        context.prefs.edit { p ->
            val current = p[recentKey]?.split('\n')?.filter { it.isNotBlank() }.orEmpty()
            p[recentKey] = withRecent(current, query).joinToString("\n")
        }
    }

    suspend fun removeRecentSearch(query: String) {
        context.prefs.edit { p ->
            val current = p[recentKey]?.split('\n')?.filter { it.isNotBlank() }.orEmpty()
            p[recentKey] = current.filterNot { it == query }.joinToString("\n")
        }
    }

    suspend fun clearRecentSearches() {
        context.prefs.edit { it.remove(recentKey) }
    }

    suspend fun setSort(sort: LibrarySort) {
        context.prefs.edit { it[sortKey] = sort.key }
    }
}

/**
 * [query] first in the recent searches, without repeating one that only differs in case or accents, and
 * keeping at most [max]. Blank queries change nothing.
 */
fun withRecent(recent: List<String>, query: String, max: Int = 8): List<String> {
    val q = query.trim().replace('\n', ' ')
    if (q.isEmpty()) return recent
    return (listOf(q) + recent.filterNot { fold(it.trim()) == fold(q) }).take(max)
}
