# kotlinx.serialization keeps its generated serializers via its own consumer rules.
# SQLCipher calls back into its Java classes from native code.
-keep class net.zetetic.database.** { *; }
