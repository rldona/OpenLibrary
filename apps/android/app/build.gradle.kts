import java.net.URI
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

/**
 * Server address the setup screen uses without asking (the owner's own server). Not committed:
 * `-Popenlibrary.defaultServerUrl=…`, `openlibrary.defaultServerUrl=…` in local.properties, or the
 * OPENLIBRARY_DEFAULT_SERVER_URL environment variable (CI secret). Without it the setup asks, as before.
 * An invalid value fails the build, never the app.
 */
fun defaultServerUrl(): String {
    val local = Properties().apply {
        rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) }
    }
    val raw =
        (findProperty("openlibrary.defaultServerUrl") as String?)
            ?: local.getProperty("openlibrary.defaultServerUrl")
            ?: System.getenv("OPENLIBRARY_DEFAULT_SERVER_URL")
            ?: ""
    val value = raw.trim().trimEnd('/')
    if (value.isEmpty()) return ""
    val uri = runCatching { URI(value) }.getOrNull()
    val valid =
        uri != null && uri.scheme == "https" && !uri.host.isNullOrBlank() &&
            uri.userInfo == null && uri.query == null && uri.fragment == null && uri.path.isNullOrEmpty()
    if (!valid) {
        throw GradleException("openlibrary.defaultServerUrl must be an https:// address with no path, e.g. https://library.example.com (got \"$raw\")")
    }
    return value
}

android {
    namespace = "io.github.rldona.openlibrary"
    compileSdk = 37

    defaultConfig {
        applicationId = "io.github.rldona.openlibrary"
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "0.2.0"
        buildConfigField("String", "DEFAULT_SERVER_URL", "\"${defaultServerUrl()}\"")
    }

    // Stable release key (passkeys are bound to its certificate, published in assetlinks.json). It lives
    // outside the repository: ~/.gradle/gradle.properties holds openlibrary.signing.* (see the runbook).
    // Without those properties the release APK is unsigned, as before.
    val signing = listOf("storeFile", "storePassword", "keyAlias", "keyPassword")
        .associateWith { findProperty("openlibrary.signing.$it") as String? }
    if (signing.values.all { it != null }) {
        signingConfigs.create("release") {
            storeFile = file(signing.getValue("storeFile")!!)
            storePassword = signing.getValue("storePassword")
            keyAlias = signing.getValue("keyAlias")
            keyPassword = signing.getValue("keyPassword")
        }
    }

    buildTypes {
        release {
            signingConfigs.findByName("release")?.let { signingConfig = it }
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    testOptions {
        unitTests.isIncludeAndroidResources = true
        // Robolectric reaches into FileDescriptor internals, closed by default on recent JDKs.
        unitTests.all {
            it.jvmArgs("--add-opens=java.base/java.io=ALL-UNNAMED", "--add-exports=java.base/jdk.internal.access=ALL-UNNAMED")
        }
    }
    // English is the default; Spanish is the only translation.
    androidResources { localeFilters += listOf("en", "es") }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)
    implementation(libs.work.runtime)
    implementation(libs.datastore.preferences)
    implementation(libs.coroutines.android)
    implementation(libs.serialization.json)
    implementation(libs.okhttp)
    implementation(libs.coil.compose)
    implementation(libs.camera.camera2)
    implementation(libs.camera.lifecycle)
    implementation(libs.camera.view)
    implementation(libs.camera.mlkit)
    // Bundled model: scanning works offline and without Google Play services.
    implementation(libs.mlkit.barcode)
    // Bundled Latin model: cover text recognition works offline and without Google Play services.
    implementation(libs.mlkit.text)
    // Local database encrypted at rest (design A10); the key lives in the Android Keystore.
    implementation(libs.sqlcipher)
    implementation(libs.biometric)
    // Passkey sign-in at setup (Credential Manager).
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services)

    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.androidx.test.junit)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.work.testing)
}
