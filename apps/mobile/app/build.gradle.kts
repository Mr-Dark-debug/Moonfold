plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The release key stays outside the repository; see README.md.
val releaseStoreFile: String? = System.getenv("MOONFOLD_ANDROID_KEYSTORE")

android {
    namespace = "dev.moonfold.mobile"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.moonfold.mobile"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0-beta.1"
    }

    signingConfigs {
        if (releaseStoreFile != null) {
            create("release") {
                storeFile = file(releaseStoreFile)
                storePassword = System.getenv("MOONFOLD_ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("MOONFOLD_ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("MOONFOLD_ANDROID_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            signingConfig = signingConfigs.findByName("release")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    dependenciesInfo {
        // Keeps a Google-encrypted dependency blob out of an APK people install by hand.
        includeInApk = false
        includeInBundle = false
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.11.0")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.core:core-splashscreen:1.2.0")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0") { isTransitive = false }
    implementation("com.google.zxing:core:3.5.3")
    // WebSockets for Reach from anywhere (D-69). Apache-2.0.
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    testImplementation("junit:junit:4.13.2")
}
