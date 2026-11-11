# kotlinx.serialization keeps its generated serializers via its own consumer rules.
# SQLCipher calls back into its Java classes from native code.
-keep class net.zetetic.database.** { *; }

# ML Kit (barcode and text recognition) finds its components through firebase-components, which
# creates every ComponentRegistrar listed in the manifest by reflection, with its no-argument
# constructor. Their own consumer rule keeps those classes but not the constructor, and R8's full
# mode then removes it: ComponentDiscovery fails with NoSuchMethodException and
# BarcodeScanning/TextRecognition.getClient() crash with a NullPointerException (release only).
-keep class * implements com.google.firebase.components.ComponentRegistrar { <init>(); }
